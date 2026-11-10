# FastAPI APIs that receive access tokens

Read this page when the FastAPI app is an API: a separate frontend, a mobile app, another service or an agent sends `Authorization: Bearer <token>` (or `DPoP <token>`), and there is no session cookie. `lumoauth.fastapi.require_access_token()` verifies the token on each request without a call to LumoAuth. Checked against `lumoauth` 1.4.0 (`lumoauth/fastapi/resource.py` and `lumoauth/verify.py`).

## Install

```bash
pip install "lumoauth[fastapi,verify]"
```

The `verify` extra adds `cryptography`. Without it, the first verification raises `LumoAuthConfigError`.

## Minimal API

```python
# api.py
import os

from fastapi import Depends, FastAPI

from lumoauth.fastapi import AccessTokenClaims, require_access_token

app = FastAPI()

ISSUER = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"
AUDIENCE = os.environ["API_AUDIENCE"]

# Build each dependency once, at import time. It holds the JWKS cache.
any_token = require_access_token(issuer=ISSUER, resource=AUDIENCE)
write_access = require_access_token(issuer=ISSUER, resource=AUDIENCE, scopes=["documents:write"])


@app.get("/api/me")
def me(claims: AccessTokenClaims = Depends(any_token)):
    return {"sub": claims.sub, "scopes": list(claims.scopes)}


@app.post("/api/documents")
def create_document(claims: AccessTokenClaims = Depends(write_access)):
    return {"created_by": claims.sub}
```

## What is verified

1. The `Authorization` header has the scheme `Bearer` or `DPoP` and a token.
2. The token is a JWT with the header `typ` `at+jwt` (or `application/at+jwt`). An ID token is refused.
3. The algorithm is RS256/384/512, PS256/384/512 or ES256/384/512. `none` and HMAC are refused.
4. The signature matches a key of the organization. The keys come from `{issuer}/.well-known/openid-configuration` → `jwks_uri` and are cached for one hour. An unknown `kid` causes one new fetch, at most every 30 seconds.
5. `iss` equals `issuer`.
6. `aud` contains `resource`.
7. `exp` and `nbf`, with `clock_skew` seconds of leeway (default 60).
8. `sub` is present.
9. The token is not a test token (`token_use` is not `test`).
10. When the token carries `cnf.jkt`: the DPoP proof of the request (see [DPoP](#dpop-bound-tokens)).
11. When `scopes` is given: every listed scope is in the token's `scope` claim.

Not verified: revocation, and whether the user is still active. A locally valid token stays accepted until `exp`. Keep access-token lifetimes short on the OAuth application, or use introspection for routes that need immediate revocation (`lumoauth-api-protection`).

## Which issuer

`{base_url}/orgs/{org}/api/v1`, for example `https://app.lumoauth.dev/orgs/acme-corp/api/v1`. An organization that serves sign-in on its own verified custom domain uses that bare domain as the issuer. Read the `issuer` field of `{base_url}/orgs/{org}/api/v1/.well-known/openid-configuration` and use that value. When the discovery document names a different issuer than the one you passed, verification fails with `LumoAuthConfigError`.

## Which audience

`resource` must equal one entry of the token's `aud` claim. LumoAuth sets `aud` like this:

- The client requested a resource (`resource=https://api.example.com` on the authorization or token request): `aud` is that URI. The URI must be allowed on the OAuth application; otherwise LumoAuth answers `invalid_target`.
- The client requested no resource: `aud` is the client ID of the OAuth application that obtained the token.

Ask the user which case applies, and which frontend or client calls the API. Do not guess. A dedicated audience URI such as `https://api.example.com` is the better design: a token that was issued for another API is then refused.

## `require_access_token(...)`

All arguments are keyword-only. The function returns an async dependency that returns `AccessTokenClaims`.

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `issuer` | `str` | required | The organization issuer |
| `resource` | `str` | required | The audience that the token must carry |
| `scopes` | `Optional[list[str]]` | `None` | Scopes that the route needs. A token that lacks one gets `403` |
| `require_dpop` | `bool` | `False` | Refuse tokens that are not DPoP-bound |
| `verifier` | `Optional[AccessTokenVerifier]` | `None` | A verifier to share between dependencies. With it, `jwks`, `fetch`, `clock_skew` and `replay_cache` are ignored |
| `jwks` | `Optional[Mapping]` | `None` | A JWKS document to use instead of fetching. For tests or pinned keys |
| `fetch` | `Optional[Callable[[str], Any]]` | `None` | `fetch(url) -> dict` for discovery and the JWKS. Default: the SDK's HTTP client |
| `clock_skew` | `float` | `60` | Leeway in seconds for `exp` and `nbf` |
| `replay_cache` | `Optional[ReplayCache]` | `None` | Where DPoP proof IDs are remembered. Default: in memory, per process |
| `request_url` | `Optional[Callable[[Request], str]]` | `None` | Builds the public URL of the request for the DPoP check. Default: `str(request.url)` |

Each call builds its own verifier with its own key cache. To share one cache between several dependencies, pass a verifier:

```python
import os

from lumoauth import AccessTokenVerifier
from lumoauth.fastapi import require_access_token

ISSUER = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"
AUDIENCE = os.environ["API_AUDIENCE"]

verifier = AccessTokenVerifier(ISSUER, AUDIENCE)

read_access = require_access_token(issuer=ISSUER, resource=AUDIENCE, verifier=verifier, scopes=["documents:read"])
write_access = require_access_token(issuer=ISSUER, resource=AUDIENCE, verifier=verifier, scopes=["documents:write"])
```

The dependency also stores the claims in `request.state.lumoauth_claims`, for middleware and logging code that runs later. Log `claims.sub` and `claims.jti`, never the token.

## `AccessTokenClaims`

| Member | Content |
|---|---|
| `sub` | The subject. A user ID for a user token; `agent_agt_...` for an agent token |
| `iss`, `aud` (tuple), `exp`, `nbf`, `iat`, `jti`, `client_id` | Standard claims |
| `scopes` (tuple), `scope` (string) | The granted scopes |
| `has_scope(scope)`, `has_scopes(*scopes)`, `missing_scopes(scopes)` | Exact scope comparison |
| `is_agent`, `agent_id`, `capabilities`, `has_capability(name)` | Agent tokens |
| `act`, `act_chain`, `actor`, `is_delegated` | Delegation: who acts for the subject |
| `cnf`, `dpop_thumbprint`, `is_dpop_bound` | DPoP binding |
| `token_use` | The `token_use` claim, when present |
| `claims`, `header` | The raw payload and header as dicts |

Decide per route whether an agent may call it. To accept users only:

```python
import os

from fastapi import Depends, HTTPException

from lumoauth.fastapi import AccessTokenClaims, require_access_token

ISSUER = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"
any_token = require_access_token(issuer=ISSUER, resource=os.environ["API_AUDIENCE"])


def user_only(claims: AccessTokenClaims = Depends(any_token)) -> AccessTokenClaims:
    if claims.is_agent or claims.is_delegated:
        raise HTTPException(status_code=403, detail={"error": "users_only"})
    return claims
```

For delegated and agent tokens use `lumoauth-agent-delegation` and `lumoauth-agent-identity`.

## Error responses

| Status | `detail` | `WWW-Authenticate` | Cause |
|---|---|---|---|
| `401` | `{"error": "invalid_request", "error_description": "Missing access token"}` | `Bearer resource="..."` (or `DPoP resource="..."` with `require_dpop=True`) | No usable `Authorization` header |
| `401` | `{"error": "invalid_token", "error_description": "...", "code": "TOKEN_..."}` | `Bearer error="invalid_token", error_description="..."` | The token failed a check |
| `401` | `{"error": "invalid_token", "error_description": "...", "code": "DPOP_REQUIRED"}` (also `DPOP_WRONG_SCHEME`, `DPOP_NOT_BOUND`) | `DPoP error="invalid_token", ...` | The token and the way it was presented do not match: a bound token without a proof or with the `Bearer` scheme, or an unbound token with the `DPoP` scheme |
| `401` | `{"error": "invalid_dpop_proof", "error_description": "...", "code": "DPOP_..."}` | `DPoP error="invalid_dpop_proof", ...` | The DPoP proof itself failed a check |
| `403` | `{"error": "insufficient_scope", "error_description": "Missing: ..."}` | `Bearer error="insufficient_scope", scope="..."` | A required scope is missing |

Stable values of `code` include `TOKEN_MALFORMED`, `TOKEN_WRONG_TYPE`, `TOKEN_BAD_ALG`, `TOKEN_UNKNOWN_KEY`, `TOKEN_KEYS_UNAVAILABLE`, `TOKEN_BAD_SIGNATURE`, `TOKEN_WRONG_ISSUER`, `TOKEN_WRONG_AUDIENCE`, `TOKEN_EXPIRED`, `TOKEN_NOT_YET_VALID`, `TOKEN_MISSING_CLAIM`, `TOKEN_TEST_TOKEN`, `DPOP_REQUIRED`, `DPOP_WRONG_SCHEME`, `DPOP_NOT_BOUND`, `DPOP_KEY_MISMATCH`, `DPOP_REPLAYED` and `DPOP_USE_NONCE`.

`TOKEN_KEYS_UNAVAILABLE` means that the app could not load the organization's signing keys: check the issuer value and outbound network access.

## DPoP-bound tokens

A token that was obtained with a DPoP proof carries `cnf.jkt`. It must arrive as `Authorization: DPoP <token>` with a `DPoP` header. The dependency then checks the proof: its key matches `cnf.jkt`, its method and URL match the request, its token hash matches the token, it is recent, and its ID was not used before.

- `require_dpop=True` refuses every token that is not bound.
- Behind a reverse proxy, `str(request.url)` can differ from the URL that the client called. Pass `request_url` to rebuild the public URL:

  ```python
  import os

  from fastapi import Request

  from lumoauth.fastapi import require_access_token

  PUBLIC_ORIGIN = "https://api.example.com"
  ISSUER = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"


  def public_url(request: Request) -> str:
      return f"{PUBLIC_ORIGIN}{request.url.path}"


  bound_access = require_access_token(
      issuer=ISSUER,
      resource=PUBLIC_ORIGIN,
      require_dpop=True,
      request_url=public_url,
  )
  ```

- The default replay cache is in the memory of one process. With several workers, pass `replay_cache`: an object with `check_and_add(key, ttl) -> bool` that returns `True` when the key is new, backed by a store that all workers share.

For the client side of DPoP use `lumoauth-oauth-advanced`.

## Permission checks after token verification

The token proves who calls. For a role-based decision, ask LumoAuth with the verified user ID:

```python
import os

from fastapi import Depends, HTTPException

from lumoauth import LumoAuth, LumoAuthError
from lumoauth.fastapi import AccessTokenClaims, require_access_token

ISSUER = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"
any_token = require_access_token(issuer=ISSUER, resource=os.environ["API_AUDIENCE"])

lumo = LumoAuth(
    api_key=os.environ["LUMOAUTH_API_KEY"],  # lmk_..., with the authz:check scope
    org_id=os.environ["LUMO_ORG_ID"],
    base_url=os.environ["LUMO_BASE_URL"],
)


def require_permission(permission: str):
    def dependency(claims: AccessTokenClaims = Depends(any_token)) -> AccessTokenClaims:
        subject = {"agent_id": claims.agent_id} if claims.is_agent else {"user_id": claims.sub}
        try:
            allowed = lumo.permissions.check(permission, **subject)
        except LumoAuthError as exc:
            raise HTTPException(status_code=503, detail={"error": "authorization_unavailable"}) from exc
        if not allowed:
            raise HTTPException(status_code=403, detail={"error": "forbidden"})
        return claims

    return dependency
```

## One app with sessions and tokens

Browser pages can use the session (`require_auth`) while `/api/...` routes accept tokens (`require_access_token`). Keep them on separate routers, and do not accept both on the same route unless the user asks for it: a cookie-authenticated route needs CSRF protection for state-changing requests, a token-authenticated route does not.
