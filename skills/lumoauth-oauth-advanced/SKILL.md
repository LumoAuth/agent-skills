---
name: lumoauth-oauth-advanced
description: >-
  Implements LumoAuth's hardened and special-purpose OAuth 2.0 flows with exact requests and
  responses: pushed authorization requests (PAR, RFC 9126), signed request objects (JAR) and signed
  responses (JARM), sender-constrained tokens with DPoP (RFC 9449), the FAPI 2.0 security profile,
  private_key_jwt client authentication, attestation-based client authentication, resource
  indicators and audience-restricted tokens (RFC 8707), the device authorization grant for CLIs and
  TVs (RFC 8628), CIBA backchannel authentication, token introspection (RFC 7662) and token
  revocation (RFC 7009). Use when the user asks for PAR, DPoP, a DPoP proof, use_dpop_nonce, FAPI,
  private_key_jwt, client assertion, the resource parameter, invalid_target, device code or device
  flow login for a CLI, CIBA or bc-authorize, authorization_pending or slow_down handling, token
  introspection, token revocation, or rich authorization requests (authorization_details).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# Hardened and special-purpose OAuth flows

With this skill you can add the stronger OAuth mechanisms that LumoAuth supports to an existing
integration: requests that the browser cannot alter (PAR), tokens that are useless when stolen
(DPoP), client authentication without a shared secret (`private_key_jwt`), tokens for exactly one
API (resource indicators), sign-in for devices without a browser (device flow), approval on the
user's own device (CIBA), and the introspection and revocation endpoints.

## When to use

- The standard authorization code flow already works and the user asks for one of the mechanisms
  in the decision table.
- A security review, a regulator or a partner requires FAPI 2.0, sender-constrained tokens or
  key-based client authentication.
- A CLI, TV or kiosk app needs sign-in without a local browser redirect.

Do not use it for the basic flow: use `lumoauth-oauth-oidc`. To validate tokens in an API use
`lumoauth-api-protection`. For AI agents use `lumoauth-agent-identity`, `lumoauth-agent-delegation`
(token exchange) and `lumoauth-agent-approvals` (agent CIBA, rich authorization requests). For
MCP use `lumoauth-mcp-server` and `lumoauth-mcp-client`.

## Decision table

| Need | Flow | Open |
|---|---|---|
| Keep authorization parameters out of the browser and tamper-proof | Pushed authorization requests (PAR) | `references/par.md` |
| Sign the authorization request or get a signed response | Request objects (JAR), signed responses (JARM) | `references/par.md` |
| Make a stolen access or refresh token useless | DPoP | `references/dpop.md` |
| Meet a financial-grade profile | FAPI 2.0: PAR + PKCE + DPoP + key-based client authentication | `references/fapi.md` |
| No shared client secret | `private_key_jwt` | `references/private-key-jwt.md` |
| A credential per app instance, vouched for by your own backend | Attestation-based client authentication | `references/client-attestation.md` |
| A token that only one API accepts | Resource indicators (`resource`) | `references/resource-indicators.md` |
| Sign-in on a CLI, TV or device without a browser | Device authorization grant | `references/device-authorization.md` |
| A backend asks a known user to approve on the user's own device | CIBA | `references/ciba.md` |
| An API asks whether a token is still active; an app ends a token | Introspection, revocation | `references/introspection-revocation.md` |
| Fine-grained, structured consent (`authorization_details`) | Rich authorization requests: agents only | See "Rich authorization requests" below |

Not offered, so do not design for them: mutual TLS client authentication (`tls_client_auth`),
certificate-bound access tokens, `client_secret_jwt`, the implicit and password grants, encrypted
request objects, and CIBA ping or push delivery. DPoP is the sender constraint.

## Before you start

Ask the user for a value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Issuer, for example `https://app.lumoauth.dev/orgs/acme-corp/api/v1` (EU: `https://eu.app.lumoauth.dev/...`) | `{base}/orgs/{orgId}/api/v1`; confirm in `{issuer}/.well-known/openid-configuration` |
| Endpoint URLs | The discovery document. Field names are in each reference file |
| Client ID, client secret or private key | Portal: **Applications → your app → Credentials** and **Security** |
| Redirect URI | Registered on the application |

Settings for these flows are on the application in the portal:

| Setting | Where |
|---|---|
| Grant types (device flow, backchannel auth, token exchange) | **Configuration → Grant types** |
| Resource indicators (allowed API identifiers) | **Configuration → Resource indicators** |
| Security profile, client authentication method, client public keys (JWKS), attestation, **Require PAR**, **Require DPoP** | **Security → FAPI 2.0 and client authentication**, saved with **Save FAPI settings** |

Availability of the FAPI 2.0 profiles, **Require DPoP** and CIBA depends on the organization's
plan (see https://docs.lumoauth.dev/pricing-matrix).

Rules for every flow: private keys and client secrets stay on the server or in the platform key
store; never log tokens, proofs or assertions; show the user any command that changes an
application before you run it.

## The short version of each flow

### PAR

1. `POST {issuer}/oauth/par` with client authentication and the authorization parameters as a
   form body (`response_type=code`, `redirect_uri`, `scope`, `state`, `nonce`, `code_challenge`,
   `code_challenge_method=S256`, optional `resource`, `response_mode`, `prompt`).
2. The `201` response is `{"request_uri": "urn:ietf:params:oauth:request_uri:...", "expires_in": 600}`.
3. Redirect the browser to `{issuer}/oauth/authorize?client_id=...&request_uri=...`.
4. Continue with the normal callback and code exchange. The `request_uri` is single-use.

An application with **Require PAR** refuses an authorization request without a `request_uri`.

### DPoP

1. Create one asymmetric key pair per client instance (for example ES256). Keep the private key
   non-exportable where the platform allows it.
2. For every request, sign a proof JWT: header `typ: dpop+jwt`, `alg`, `jwk` (public key);
   claims `htm` (HTTP method), `htu` (URL without query), `iat`, `jti` (unique, at least 16
   characters), plus `ath` (hash of the access token) on API calls.
3. Send the proof in the `DPoP` header of the token request. The response has
   `token_type: "DPoP"` and the token carries `cnf.jkt`.
4. Call APIs with `Authorization: DPoP <token>` and a fresh proof.
5. On `use_dpop_nonce`, read the `DPoP-Nonce` response header, add it as the `nonce` claim of a
   new proof, and repeat once.

Any client may send a proof. An application with **Require DPoP** must send one.

### FAPI 2.0

Set **Security profile** to **FAPI 2.0 Baseline** or **FAPI 2.0 Advanced**. The profile itself
makes PKCE with `S256` mandatory, shortens the authorization code lifetime to 60 seconds and
applies strict timing rules to request objects. Complete it on the same form: choose
`private_key_jwt`, turn on **Require PAR** and **Require DPoP**.

### `private_key_jwt`

1. Create a key pair. Register the public key on the application as a JWKS URI (preferred) or an
   inline JWKS.
2. For each token request sign an assertion: `iss` = `sub` = client ID, `aud` = the discovery
   `issuer` (not the token endpoint URL), `exp` at most a few minutes ahead, unique `jti`.
3. Send `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and
   `client_assertion=<JWT>` in place of the client secret.

### Resource indicators

1. Add the API identifier (an absolute `https` URI) to the application's resource indicators.
2. Send `resource=https://api.example.com` on the authorization request (or PAR) and on the
   token request.
3. The access token's `aud` is that URI. Without `resource`, `aud` is the client ID.
4. `invalid_target` means that the URI is malformed, not allowed for the application, or outside
   what was granted.

### Device authorization

1. `POST {issuer}/oauth/device_authorization` with `client_id` and `scope`.
2. Show `verification_uri` and `user_code` to the user (or `verification_uri_complete` as a QR
   code).
3. Poll `POST {issuer}/oauth/token` with
   `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code` and `client_id`,
   waiting `interval` seconds between calls.
4. `authorization_pending`: keep polling. `slow_down`: add 5 seconds to the interval.
   `access_denied` or `expired_token`: stop.

The application needs the device grant type (**Configuration → Grant types → Device flow**).

### CIBA

1. `POST {issuer}/oauth/bc-authorize` with client authentication, `scope` and exactly one hint
   (`login_hint`, `id_token_hint` or `login_hint_token`), optionally `binding_message`.
2. The response has `auth_req_id`, `expires_in` and `interval`.
3. Poll the token endpoint with `grant_type=urn:openid:params:grant-type:ciba` and `auth_req_id`.
4. Handle `authorization_pending`, `slow_down`, `access_denied` and `expired_token` as in the
   device flow.

Delivery is poll only. `user_code` is not supported. If `bc-authorize` answers
`unauthorized_client`, backchannel authentication is not enabled for the application or is not
part of the organization's plan: stop and tell the user.

### Introspection and revocation

- Introspection: `POST {issuer}/oauth/introspect` with client authentication and `token`. The
  answer is `{"active": false}` or the token's metadata. Only the application that the token was
  issued to, or a client named in its `aud`, gets `active: true`.
- Revocation: `POST {issuer}/oauth/revoke` with client authentication and `token`. Always `200`
  with an empty JSON body. Revoking a refresh token ends every access token of that sign-in.

### Rich authorization requests

LumoAuth accepts `authorization_details` only where an AI agent asks a person to approve one
specific action: the just-in-time permission API and agent-initiated CIBA. The authorization
endpoint and PAR do not process `authorization_details` for ordinary applications, and discovery
does not list `authorization_details_types_supported`. For ordinary applications express access
with scopes and `resource`. For agents use `lumoauth-agent-approvals`.

## Verify

| Flow | Proof that it works |
|---|---|
| PAR | The PAR call returns `201` with a `request_uri`; `/authorize` with only `client_id` and `request_uri` reaches the login page; a second use of the same `request_uri` fails |
| DPoP | The token response has `token_type: "DPoP"`; the decoded access token has `cnf.jkt`; UserInfo with `Authorization: Bearer` and the same token answers `401` |
| `private_key_jwt` | A token request without a client secret succeeds; the same assertion sent twice fails with `invalid_client` |
| Resource indicators | The decoded access token has `aud` equal to the API identifier |
| Device flow | Approving the code in a browser makes the next poll return tokens |
| CIBA | Approving on the user's device makes the next poll return tokens |
| Introspection | An active token returns `active: true`; after revocation it returns `active: false` |

Decode tokens locally. Do not paste real tokens into web tools.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `invalid_request` at `/authorize` for an application with **Require PAR** | The request was not pushed first | Call the PAR endpoint and redirect with `request_uri` |
| "The authorization request has expired" | The `request_uri` was used twice or is older than `expires_in` | Push a new request for every sign-in |
| `invalid_dpop_proof` | Wrong `typ`, `htm` or `htu`; `iat` too old or in the future; `jti` reused or shorter than 16 characters; private key in the `jwk` header | Build a new proof for each request; `htu` is the exact URL without query string |
| `invalid_dpop_proof` on the code exchange | The proof key differs from the key that was bound at PAR | Use the same key for PAR and the token request |
| `use_dpop_nonce` in a loop | The retry reuses the old `jti` or omits the nonce | New `jti`, fresh `iat`, `nonce` from the latest `DPoP-Nonce` header |
| API answers `401` to a DPoP token | Sent as `Bearer`, or the proof lacks `ath` | Use the `DPoP` scheme and add `ath` |
| `invalid_client` with `private_key_jwt` | `aud` is the token endpoint URL, the assertion was reused, `exp` is more than 10 minutes ahead, or the public key is not registered | `aud` = discovery `issuer`; new `jti` per request; short `exp`; publish the JWKS |
| `invalid_target` | The resource is not in the application's resource indicators, has a fragment, or widens the grant | Register the URI; request a subset at the token endpoint |
| `aud` is the client ID | No `resource` was sent | Send `resource` |
| `unauthorized_client` at `/oauth/device_authorization` | The application lacks the device grant type | Tick **Device flow** under **Configuration → Grant types** |
| `slow_down` keeps coming | The client polls faster than `interval` | Wait `interval` seconds; add 5 seconds after each `slow_down` |
| Introspection says `active: false` for a fresh token | The caller is not the application that the token was issued to | Introspect with that application's credentials, or validate the JWT offline |

## Related skills

- `lumoauth-oauth-oidc`: the basic flow that these mechanisms extend.
- `lumoauth-api-protection`: validating tokens, audiences and scopes in an API.
- `lumoauth-agent-delegation`: token exchange and delegated (`act`) tokens.
- `lumoauth-agent-approvals`: agent CIBA and rich authorization requests.
- `lumoauth-mfa-passkeys`: push approval and `acr_values`.
- `lumoauth-cli`: the `lumo` CLI, which itself signs in with the device flow.

## References

- [PAR, request objects and signed responses](references/par.md)
- [DPoP](references/dpop.md): proofs, nonces, verification at a resource server
- [FAPI 2.0](references/fapi.md)
- [private_key_jwt](references/private-key-jwt.md)
- [Attestation-based client authentication](references/client-attestation.md)
- [Resource indicators](references/resource-indicators.md)
- [Device authorization](references/device-authorization.md)
- [CIBA](references/ciba.md)
- [Introspection and revocation](references/introspection-revocation.md)
- https://docs.lumoauth.dev/oauth/par
- https://docs.lumoauth.dev/oauth/fapi
- https://docs.lumoauth.dev/oauth/resource-indicators
- https://docs.lumoauth.dev/oauth/device
- https://docs.lumoauth.dev/oauth/ciba
- https://docs.lumoauth.dev/oauth/client-attestation
- https://docs.lumoauth.dev/oauth/introspect
- https://docs.lumoauth.dev/reference/standards
