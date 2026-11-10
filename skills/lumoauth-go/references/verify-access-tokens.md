# Verify access tokens in a Go API

`lumoauth.RequireAccessToken` and `lumoauth.VerifyAccessToken` verify LumoAuth JWT access tokens
(`typ: at+jwt`) locally. They fetch the organization's public keys and make no call to LumoAuth for
each request.

## Options

`lumoauth.AccessTokenVerifyOptions`:

| Field | Required | Meaning |
|---|---|---|
| `Issuer` | yes | The organization's issuer: `https://app.lumoauth.dev/orgs/acme-corp/api/v1`. Build it with `lumoauth.IssuerFor(baseURL, orgID)`. |
| `Resource` | yes | The URI of this API. The token's `aud` must contain it. |
| `JWKS` | no | Keys that you supply yourself (`*lumoauth.JWKS`). When nil, the SDK reads `jwks_uri` from `{Issuer}/.well-known/openid-configuration`. |
| `KeyCache` | no | A cache from `lumoauth.NewAccessTokenKeyCache(issuer, ttl, httpClient)`. A `ttl` of 0 means one hour. |
| `HTTPClient` | no | Client for discovery and keys. Default: 30 s timeout. |
| `ClockSkew` | no | Tolerance on `exp` and `nbf`. 0 means 60 seconds; a negative value means none. |
| `RequireDPoP` | no | Refuse tokens that are not bound to a DPoP key. |
| `DPoP` | no | The request details for a DPoP-bound token. `RequireAccessToken` fills it in. |
| `ReplayCache` | no | Store for DPoP proof identifiers. Default: in-memory, per process. |

On a custom domain the issuer is not `{base}/orgs/{org}/api/v1`. Read the `issuer` value from the
organization's discovery document and pass it as `Issuer`.

## Which audience a token has

- A token that was requested with `resource=https://api.example.com` has that URI as `aud`.
- Without `resource`, `aud` is the audience URI that is registered on the application (portal:
  **Applications → your app → Configuration → Resource indicators**), or the `client_id` when none
  is registered.

Choose one URI for the API, register it on each client application, and set it as `Resource`.
`lumoauth-oauth-advanced` covers resource indicators.

## Middleware

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	protect := lumoauth.RequireAccessToken(lumoauth.AccessTokenVerifyOptions{
		Issuer:   lumoauth.IssuerFor("https://app.lumoauth.dev", "acme-corp"),
		Resource: "https://api.example.com",
	})

	mux := http.NewServeMux()
	mux.Handle("/orders", protect(requireScope("read:orders", http.HandlerFunc(orders))))
	log.Fatal(http.ListenAndServe(":8080", mux))
}

// requireScope answers 403 when the verified token lacks a scope.
func requireScope(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := lumoauth.AccessTokenFromContext(r.Context())
		if !ok || !claims.HasScope(scope) {
			http.Error(w, "insufficient scope", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func orders(w http.ResponseWriter, r *http.Request) {
	claims, _ := lumoauth.AccessTokenFromContext(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"subject":  claims.Subject,
		"client":   claims.ClientID,
		"is_agent": claims.IsAgent,
	})
}
```

`RequireAccessToken` reads the token from `Authorization` (scheme `Bearer` or `DPoP`). On failure
it answers 401 with `WWW-Authenticate` and the JSON body
`{"error": "invalid_token", "error_description": "..."}`. It keeps one key cache for the issuer and
refetches the keys once when a token names an unknown `kid`.

## Claims

`*lumoauth.AccessTokenClaims`:

| Member | Meaning |
|---|---|
| `Issuer`, `Audience`, `Expires`, `NotBefore`, `IssuedAt`, `JTI` | Standard claims. `Audience.Contains(uri)` tests one value. |
| `Subject` | A user ID for a user token or a delegated token; `agent_agt_...` for an agent. |
| `ClientID` | The OAuth client that obtained the token. |
| `Scope`, `Scopes()`, `HasScope(scope)` | Granted scopes. `HasScope` compares exactly. |
| `IsAgent`, `Capabilities`, `HasCapability(name)` | Set on agent tokens. |
| `Act`, `ActorChain()` | The actor chain of a delegated token (`act` claim). |
| `Confirmation`, `IsDPoPBound()` | The key binding (`cnf.jkt`). |
| `Raw` | Every claim in the token. |

Authorize on `Subject`, scopes and, for delegated tokens, the actor chain. A valid signature alone
does not mean that the caller may use the endpoint.

## Verify without the middleware

```go
func verify(r *http.Request, token string) (*lumoauth.AccessTokenClaims, error) {
	claims, err := lumoauth.VerifyAccessToken(r.Context(), token, lumoauth.AccessTokenVerifyOptions{
		Issuer:   lumoauth.IssuerFor("https://app.lumoauth.dev", "acme-corp"),
		Resource: "https://api.example.com",
		DPoP:     lumoauth.DPoPRequestFromHTTP(r), // used only for DPoP-bound tokens
	})
	if err != nil {
		log.Printf("token rejected: %s", lumoauth.RejectionReason(err)) // never log the token
		return nil, err
	}
	return claims, nil
}
```

A rejection is a `*lumoauth.ValidationError`. `lumoauth.RejectionReason(err)` returns one of:

| Constant | Value | Meaning |
|---|---|---|
| `TokenRejectedMalformed` | `malformed` | Not a three-part JWT, or a required header or claim is missing |
| `TokenRejectedType` | `wrong_type` | `typ` is not `at+jwt` (for example an ID token) |
| `TokenRejectedAlgorithm` | `bad_algorithm` | Algorithm is not an RSA or EC signature, or does not match the key |
| `TokenRejectedIssuer` | `wrong_issuer` | `iss` differs from `Issuer` |
| `TokenRejectedUnknownKey` | `unknown_key` | No key with the token's `kid` |
| `TokenRejectedSignature` | `bad_signature` | Signature check failed |
| `TokenRejectedExpired` | `expired` | `exp` passed or is missing |
| `TokenRejectedNotYetValid` | `not_yet_valid` | `nbf` is in the future |
| `TokenRejectedAudience` | `wrong_audience` | `aud` does not contain `Resource` |
| `TokenRejectedTestToken` | `test_token` | A portal test token (`token_use: "test"`) |
| `TokenRejectedDPoPRequired`, `TokenRejectedDPoPScheme`, `TokenRejectedDPoPProof`, `TokenRejectedDPoPBinding`, `TokenRejectedDPoPReplay` | `dpop_required`, `dpop_scheme`, `dpop_proof`, `dpop_binding`, `dpop_replay` | DPoP checks |

A failure to fetch the keys is a `*NetworkError` or `*APIError`, not a rejection.

## Limits to know

- Local verification does not check revocation. When the API must refuse a revoked token before it
  expires, use token introspection; see `lumoauth-api-protection`.
- Only JWT access tokens can be verified this way. ID tokens are refused (`wrong_type`); never
  accept an ID token as an API credential.
- DPoP-bound tokens: the middleware checks the proof in the `DPoP` header against the request
  method and URL. It derives the URL from `r.Host` and `X-Forwarded-Proto`. Behind a proxy that
  rewrites the host, call `VerifyAccessToken` yourself and set `DPoPRequest.URL`. With several
  replicas, pass a shared `ReplayCache` (the interface has one method,
  `Seen(jti string, ttl time.Duration) bool`). `lumoauth-oauth-advanced` covers DPoP.
- AAuth tokens (`auth+jwt`) use `lumoauth.VerifyAuthToken` instead; see `lumoauth-aauth`.
