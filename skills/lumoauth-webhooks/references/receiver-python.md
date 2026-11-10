# Python receiver for LumoAuth webhooks

A receiver with the standard library only. It has the same behaviour as the TypeScript
function in `SKILL.md`: parse `X-LumoAuth-Signature`, check the timestamp, compute
HMAC-SHA256 over `<t>.<id>.<raw body>`, compare in constant time against every configured
secret, then parse the JSON. The code was run against the test vector in `test-vector.md`
and against a local HTTP request.

`lumoauth_webhook.py`:

```python
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Optional, Sequence


class WebhookVerificationError(Exception):
    pass


@dataclass
class LumoAuthDelivery:
    delivery_id: str
    signed_at: int
    event: str
    tenant: str
    data: dict[str, Any]


def verify_lumoauth_webhook(
    raw_body: bytes,
    signature_header: Optional[str],
    secrets: Sequence[str],
    tolerance_seconds: int = 300,
    now: Optional[int] = None,
) -> LumoAuthDelivery:
    """Verify the X-LumoAuth-Signature header of one delivery.

    raw_body must be the request body exactly as received.
    """
    if not secrets:
        raise WebhookVerificationError("no signing secret configured")
    if not signature_header:
        raise WebhookVerificationError("missing X-LumoAuth-Signature header")

    # Header format: kid=v1,t=<unix seconds>,id=<delivery id>,v1=<hex HMAC-SHA256>
    fields: dict[str, str] = {}
    for part in signature_header.split(","):
        key, sep, value = part.partition("=")
        if sep:
            fields[key.strip()] = value.strip()
    t = fields.get("t", "")
    delivery_id = fields.get("id", "")
    v1 = fields.get("v1", "")
    if not re.fullmatch(r"[0-9]{1,12}", t) or not delivery_id or not re.fullmatch(r"[0-9a-f]{64}", v1):
        raise WebhookVerificationError("malformed X-LumoAuth-Signature header")

    signed_at = int(t)
    current = int(time.time()) if now is None else now
    if abs(current - signed_at) > tolerance_seconds:
        raise WebhookVerificationError("timestamp outside the tolerance window")

    # Signed payload: "<t>.<id>." followed by the raw body bytes.
    signed_payload = f"{t}.{delivery_id}.".encode("utf-8") + raw_body
    valid = False
    for secret in secrets:
        expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, v1):
            valid = True
    if not valid:
        raise WebhookVerificationError("signature mismatch")

    envelope = json.loads(raw_body.decode("utf-8"))
    return LumoAuthDelivery(
        delivery_id=delivery_id,
        signed_at=signed_at,
        event=envelope["event"],
        tenant=envelope["tenant"],
        data=envelope.get("data") or {},
    )
```

`server.py`, a receiver on `http.server`:

```python
import os
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from lumoauth_webhook import LumoAuthDelivery, WebhookVerificationError, verify_lumoauth_webhook

# Current secret first. Keep the previous secret only while a rotation is in progress.
SECRETS = [
    s
    for s in (os.environ.get("LUMOAUTH_WEBHOOK_SECRET"), os.environ.get("LUMOAUTH_WEBHOOK_SECRET_PREVIOUS"))
    if s
]
MAX_BODY_BYTES = 1_048_576

# Replace both with durable storage in production.
seen_deliveries: set[str] = set()
seen_lock = threading.Lock()
events: "queue.Queue[LumoAuthDelivery]" = queue.Queue()


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/webhooks/lumoauth":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_response(400)
            self.end_headers()
            return
        raw_body = self.rfile.read(length)
        try:
            delivery = verify_lumoauth_webhook(raw_body, self.headers.get("X-LumoAuth-Signature"), SECRETS)
        except WebhookVerificationError:
            self.send_response(401)
            self.end_headers()
            return
        with seen_lock:
            if delivery.delivery_id not in seen_deliveries:
                events.put(delivery)  # hand over to a worker; do not process here
                seen_deliveries.add(delivery.delivery_id)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"received":true}')


def worker() -> None:
    while True:
        delivery = events.get()
        if delivery.event == "user.created":
            print("new user", delivery.data.get("target_id"), flush=True)


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "3000"))), WebhookHandler).serve_forever()
```

In FastAPI, read the bytes with `await request.body()` and pass
`request.headers.get("x-lumoauth-signature")`. In Flask, use `request.get_data()` and
`request.headers.get("X-LumoAuth-Signature")`. In Django, use `request.body` and
`request.headers.get("X-LumoAuth-Signature")`.

## Notes

- The secret is used as a UTF-8 string. Do not decode it.
- `v1` is lower-case hexadecimal, 64 characters.
- The comparison loop checks every configured secret and does not stop at the first match.
- Replace the in-memory or file-based deduplication with shared, durable storage before
  production, and keep delivery IDs for at least two days.
- Answer within 5 seconds. Queue the event; process it in a worker.
