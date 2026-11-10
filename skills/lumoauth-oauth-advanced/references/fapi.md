# FAPI 2.0 security profile

FAPI 2.0 is a hardening profile of OAuth 2.0 for high-value APIs. It combines four mechanisms:
pushed authorization requests, PKCE with `S256`, sender-constrained tokens (DPoP) and key-based
client authentication. In LumoAuth the profile is a per-application setting plus three switches
that you turn on next to it.

Availability of the FAPI 2.0 profiles and of **Require DPoP** depends on the organization's plan
(see https://docs.lumoauth.dev/pricing-matrix).

## What each setting enforces

All settings are under **Applications → your app → Security → FAPI 2.0 and client
authentication**. Save with **Save FAPI settings**.

| Setting | Value for FAPI 2.0 | What LumoAuth then enforces |
|---|---|---|
| **Security profile** | **FAPI 2.0 Baseline** or **FAPI 2.0 Advanced** | `code_challenge` with `S256` is mandatory at the authorization endpoint and at PAR; authorization codes expire after 60 seconds; a signed request object must carry `exp` and `nbf` (`nbf` at most 60 minutes old, `exp` at most 60 minutes after `nbf`) |
| **Client authentication method** | `private_key_jwt` (or attestation-based client authentication) | The application must authenticate with that method on every request; its `client_id` alone is not accepted |
| **Require PAR** | On | An authorization request without a `request_uri` from the PAR endpoint is refused |
| **Require DPoP** | On | A token request without a DPoP proof is refused with `invalid_dpop_proof`; tokens are bound to the proof key |

Choosing the security profile does not turn the other three on. Set all four for a complete
FAPI 2.0 client. The application must be confidential: a public client cannot use
`private_key_jwt` or client attestation.

## Setup order

1. Create the key pair for client authentication and publish the public key
   (`references/private-key-jwt.md` in this skill).
2. Implement PAR (`references/par.md`) and DPoP (`references/dpop.md`) in the client and test
   them while the switches are still off. PAR and DPoP work for any application.
3. Switch the application: **Security profile**, **Client authentication method**, **Require
   PAR**, **Require DPoP**. Save.
4. Run the full flow again. Remove the client secret from the deployment.

## The complete flow

1. Create `state`, `nonce` and a PKCE verifier. Create or load the DPoP key.
2. **PAR**, authenticated with a client assertion, with a DPoP proof:

   ```http
   POST /orgs/acme-corp/api/v1/oauth/par HTTP/1.1
   Host: app.lumoauth.dev
   Content-Type: application/x-www-form-urlencoded
   DPoP: <proof for POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/par>

   response_type=code
   &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
   &scope=openid%20profile
   &state=STATE&nonce=NONCE
   &code_challenge=CODE_CHALLENGE&code_challenge_method=S256
   &resource=https%3A%2F%2Fapi.example.com
   &client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
   &client_assertion=<signed assertion>
   ```

   Response: `201` with `request_uri` and `expires_in`.
3. **Redirect** the browser to
   `{issuer}/oauth/authorize?client_id=CLIENT_ID&request_uri=<request_uri>`.
4. **Callback**: check `iss` against the discovery `issuer` and `state` against the stored value.
5. **Token request** within 60 seconds, with a new client assertion and a new DPoP proof signed
   with the same DPoP key as in step 2:

   ```http
   POST /orgs/acme-corp/api/v1/oauth/token HTTP/1.1
   Host: app.lumoauth.dev
   Content-Type: application/x-www-form-urlencoded
   DPoP: <proof for POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token>

   grant_type=authorization_code
   &code=CODE
   &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
   &code_verifier=CODE_VERIFIER
   &client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
   &client_assertion=<new signed assertion>
   ```

   Response: `token_type` is `DPoP`.
6. **API calls** with `Authorization: DPoP <token>` and a proof that includes `ath`.
7. **Refresh** with a new assertion and a proof from the same DPoP key.

Each client assertion and each DPoP proof is used once. On `use_dpop_nonce`, retry once with the
`DPoP-Nonce` value.

## Discovery values that matter for FAPI clients

| Field | Value |
|---|---|
| `pushed_authorization_request_endpoint` | `{issuer}/oauth/par` on the organization path |
| `require_pushed_authorization_requests` | `false` for the server as a whole; the requirement is per application |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `attest_jwt_client_auth`, `none` |
| `token_endpoint_auth_signing_alg_values_supported` | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512` |
| `dpop_signing_alg_values_supported` | `ES256`, `ES384`, `ES512`, `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `EdDSA` |
| `code_challenge_methods_supported` | `["S256"]` |
| `authorization_response_iss_parameter_supported` | `true` |
| `request_object_signing_alg_values_supported` | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512` |
| `response_modes_supported` | Includes the signed modes `jwt`, `query.jwt`, `fragment.jwt`, `form_post.jwt` |

Mutual TLS is not part of LumoAuth's FAPI support: no `tls_client_auth` and no certificate-bound
tokens. Use `private_key_jwt` and DPoP.

## Errors

| Error | Cause | Fix |
|---|---|---|
| `invalid_request`, "code_challenge is required for FAPI 2.0 clients" | No PKCE | Send `code_challenge` and `code_challenge_method=S256` |
| `invalid_request`, "code_challenge_method must be S256 for FAPI 2.0 clients" | Another method | Use `S256` |
| `invalid_request` at `/authorize` | **Require PAR** is on and the request was not pushed | Use PAR |
| `invalid_grant` on the code exchange | The code is older than 60 seconds or was used | Exchange at once; do not retry with the same code |
| `invalid_dpop_proof` | Proof missing, malformed, replayed, or signed with another key than at PAR | See `references/dpop.md` |
| `invalid_client` | The assertion's `aud` is not the issuer, the `jti` was reused, the key is unknown, or the request used a secret | See `references/private-key-jwt.md` |
| `invalid_request_object` | A request object without `exp` and `nbf`, or outside the time limits | Add both claims; keep the object short-lived |

## Sources

- https://docs.lumoauth.dev/oauth/fapi
- https://docs.lumoauth.dev/oauth/par
- https://docs.lumoauth.dev/oauth/security
