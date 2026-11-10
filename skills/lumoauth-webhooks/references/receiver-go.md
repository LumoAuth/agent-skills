# Go receiver for LumoAuth webhooks

A receiver with the standard library only. It has the same behaviour as the TypeScript
function in `SKILL.md`: parse `X-LumoAuth-Signature`, check the timestamp, compute
HMAC-SHA256 over `<t>.<id>.<raw body>`, compare in constant time against every configured
secret, then parse the JSON. The code was run against the test vector in `test-vector.md`
and against a local HTTP request.

`main.go`:

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Delivery is one verified LumoAuth webhook delivery.
type Delivery struct {
	DeliveryID string
	SignedAt   int64
	Event      string                 `json:"event"`
	Tenant     string                 `json:"tenant"`
	Data       map[string]interface{} `json:"data"`
}

var ErrWebhookVerification = errors.New("lumoauth webhook verification failed")

// VerifyLumoAuthWebhook verifies the X-LumoAuth-Signature header of one delivery.
// rawBody must be the request body exactly as received.
func VerifyLumoAuthWebhook(rawBody []byte, signatureHeader string, secrets []string, tolerance time.Duration, now time.Time) (*Delivery, error) {
	if len(secrets) == 0 || signatureHeader == "" {
		return nil, ErrWebhookVerification
	}

	// Header format: kid=v1,t=<unix seconds>,id=<delivery id>,v1=<hex HMAC-SHA256>
	fields := map[string]string{}
	for _, part := range strings.Split(signatureHeader, ",") {
		key, value, ok := strings.Cut(part, "=")
		if ok {
			fields[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	t, id, v1 := fields["t"], fields["id"], fields["v1"]
	signedAt, err := strconv.ParseInt(t, 10, 64)
	if err != nil || signedAt < 0 || id == "" {
		return nil, ErrWebhookVerification
	}
	given, err := hex.DecodeString(v1)
	if err != nil || len(given) != sha256.Size {
		return nil, ErrWebhookVerification
	}

	age := now.Unix() - signedAt
	if age < 0 {
		age = -age
	}
	if age > int64(tolerance/time.Second) {
		return nil, ErrWebhookVerification
	}

	// Signed payload: "<t>.<id>." followed by the raw body bytes.
	valid := false
	for _, secret := range secrets {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(t + "." + id + "."))
		mac.Write(rawBody)
		if hmac.Equal(mac.Sum(nil), given) {
			valid = true
		}
	}
	if !valid {
		return nil, ErrWebhookVerification
	}

	delivery := &Delivery{DeliveryID: id, SignedAt: signedAt}
	if err := json.Unmarshal(rawBody, delivery); err != nil {
		return nil, ErrWebhookVerification
	}
	return delivery, nil
}

func main() {
	// Current secret first. Keep the previous secret only while a rotation is in progress.
	var secrets []string
	for _, name := range []string{"LUMOAUTH_WEBHOOK_SECRET", "LUMOAUTH_WEBHOOK_SECRET_PREVIOUS"} {
		if v := os.Getenv(name); v != "" {
			secrets = append(secrets, v)
		}
	}

	// Replace both with durable storage in production.
	var mu sync.Mutex
	seen := map[string]struct{}{}
	events := make(chan *Delivery, 1024)

	go func() {
		for delivery := range events {
			switch delivery.Event {
			case "user.created":
				log.Printf("new user %v", delivery.Data["target_id"])
			}
		}
	}()

	http.HandleFunc("/webhooks/lumoauth", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		rawBody, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		delivery, err := VerifyLumoAuthWebhook(rawBody, r.Header.Get("X-LumoAuth-Signature"), secrets, 5*time.Minute, time.Now())
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		mu.Lock()
		if _, dup := seen[delivery.DeliveryID]; !dup {
			select {
			case events <- delivery: // hand over to a worker; do not process here
				seen[delivery.DeliveryID] = struct{}{}
			default:
				mu.Unlock()
				w.WriteHeader(http.StatusServiceUnavailable) // queue full: LumoAuth retries
				return
			}
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"received":true}`))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
```

Run it with `go run .` in a module of its own, or move `VerifyLumoAuthWebhook` into the
application's package and call it from the existing router. With chi or another router, the
handler body stays the same: read the raw bytes with `io.ReadAll(http.MaxBytesReader(...))`
before any JSON decoding.

## Notes

- The secret is used as a UTF-8 string. Do not decode it.
- `v1` is lower-case hexadecimal, 64 characters.
- The comparison loop checks every configured secret and does not stop at the first match.
- Replace the in-memory or file-based deduplication with shared, durable storage before
  production, and keep delivery IDs for at least two days.
- Answer within 5 seconds. Queue the event; process it in a worker.
