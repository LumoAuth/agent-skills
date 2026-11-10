# Production settings for `lumoauth.fastapi`

Read this page before a FastAPI app with `lumo_auth_router` is deployed, when sign-in fails behind a proxy, or when the app needs the user's access token after sign-in.

## The session cookie holds the tokens

`lumo_auth_router` stores its data in `request.session`: the PKCE verifier and `state` during sign-in, then the access token, refresh token, ID token and the user profile. With Starlette's `SessionMiddleware`, `request.session` is a cookie:

- The cookie is **signed** with `secret_key`, so the browser cannot change it.
- The cookie is **not encrypted**. Its content is base64-encoded JSON. Whoever holds the cookie can read the tokens in it.
- The cookie is `HttpOnly`, so scripts in the page cannot read it.
- Browsers limit one cookie to about 4 KB. Two JWTs plus a profile can come close to that limit or exceed it, for example when tokens carry extra claims. A browser drops a cookie that is too large: sign-in then seems to work, and the next request is anonymous again.

Settings for `SessionMiddleware`:

```python
import os

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI()
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    session_cookie="app_session",
    max_age=8 * 60 * 60,  # seconds; the default is 14 days
    same_site="lax",
    https_only=True,
)
```

| Argument | Value | Reason |
|---|---|---|
| `secret_key` | From the environment, at least 32 random bytes | It signs the cookie. Whoever has it can forge a session |
| `https_only` | `True` in production | The cookie is sent over HTTPS only. Keep `False` for `http://localhost` |
| `same_site` | `"lax"` | LumoAuth returns the browser to `/auth/callback` with a top-level redirect from another site. `"lax"` sends the cookie on that request; `"strict"` does not |
| `max_age` | The session length that the app owner wants | The signed-in state lasts this long. It does not depend on the lifetime of the access token |

For production, prefer a server-side session store: the cookie then holds only a session ID, and the tokens stay on the server. The router works with any session middleware that provides `request.session` as a dict-like object, so a Redis-backed or database-backed session package for Starlette can replace `SessionMiddleware` without other changes. Follow the README of the package that the user chooses.

## Behind a proxy or load balancer

The router builds the redirect URI from the request: `{request.url.scheme}://{request.url.netloc}{callback_path}`.

1. **Scheme.** Behind a proxy that ends TLS, the app sees `http` unless the server trusts the proxy's `X-Forwarded-Proto` header. `uvicorn` reads that header only from addresses in `--forwarded-allow-ips` (default `127.0.0.1`). Set it to the address of the proxy.
2. **Host.** The host comes from the `Host` header. Configure the proxy to pass the original `Host` header to the app.

Check the result: open `/auth/login` and read the `redirect_uri` parameter of the URL that the browser is sent to. It must equal a redirect URI that is registered on the OAuth application, character for character.

## OAuth application settings for production

In the portal, on the application's **Configuration** tab (then **Save configuration**). Show the user every change before you make it.

- **Redirect URIs**: add `https://app.example.com/auth/callback`. Use a separate application for each environment, so that development and production do not share a secret.
- **Logout → Post-logout redirect URIs**: add the URL that the sign-out route below returns to.

From the CLI, `lumo apps update <client-id> --redirect-uris <uri>,<uri>` replaces the whole list of redirect URIs. Pass every URI that must stay.

## The access token expires; the session does not

The router does not renew the access token. `get_current_user` and `require_auth` keep working after the token has expired, because they read the profile from the session. This matters only when the app uses the user's access token, for example to call LumoAuth as the user (ABAC checks, `permissions.list()`) or to call another API.

Read the token from the session, and renew it with the refresh token when LumoAuth answers `401`:

```python
# session_tokens.py
import os
from typing import Callable, Optional, TypeVar

from fastapi import HTTPException, Request

from lumoauth import LumoAuth, LumoAuthApiError, LumoAuthAuthenticationError

SESSION_KEY = "__lumoauth"
T = TypeVar("T")

# No API key is needed: token requests authenticate with the client ID and secret.
_oauth = LumoAuth(org_id=os.environ["LUMO_ORG_ID"], base_url=os.environ["LUMO_BASE_URL"])


def _access_token(request: Request) -> Optional[str]:
    state = request.session.get(SESSION_KEY) or {}
    return (state.get("tokens") or {}).get("access_token")


def _refresh(request: Request) -> Optional[str]:
    """Renew the tokens. Returns the new access token, or None after signing the user out."""
    state = request.session.get(SESSION_KEY) or {}
    tokens = dict(state.get("tokens") or {})
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        return None
    try:
        fresh = _oauth.auth.refresh_token(
            refresh_token,
            client_id=os.environ["LUMO_CLIENT_ID"],
            client_secret=os.environ.get("LUMO_CLIENT_SECRET") or None,
        )
    except LumoAuthApiError:
        # The refresh token is no longer accepted: end the local session.
        request.session.pop(SESSION_KEY, None)
        return None
    tokens["access_token"] = fresh["access_token"]
    tokens["refresh_token"] = fresh.get("refresh_token") or refresh_token
    tokens["id_token"] = fresh.get("id_token") or tokens.get("id_token")
    tokens["scope"] = fresh.get("scope") or tokens.get("scope", "")
    request.session[SESSION_KEY] = {**state, "tokens": tokens}
    return tokens["access_token"]


def as_user(request: Request, call: Callable[[LumoAuth], T]) -> T:
    """Run `call` with a LumoAuth client that acts as the signed-in user. Renews the token once."""
    token = _access_token(request)
    for attempt in (0, 1):
        if not token:
            raise HTTPException(status_code=401, detail={"error": "unauthenticated"})
        current = token
        client = LumoAuth(
            org_id=os.environ["LUMO_ORG_ID"],
            base_url=os.environ["LUMO_BASE_URL"],
            token_provider=lambda: current,
        )
        try:
            return call(client)
        except LumoAuthAuthenticationError:
            if attempt == 1:
                raise HTTPException(status_code=401, detail={"error": "unauthenticated"})
            token = _refresh(request)
    raise HTTPException(status_code=401, detail={"error": "unauthenticated"})
```

```python
from fastapi import APIRouter, Depends, HTTPException, Request

from lumoauth.fastapi import User, require_auth
from session_tokens import as_user

router = APIRouter()


@router.get("/api/invoices/{invoice_id}")
def read_invoice(invoice_id: str, request: Request, user: User = Depends(require_auth(scopes=["abac:read"]))):
    allowed = as_user(request, lambda lumo: lumo.abac.is_allowed("invoice", "read", invoice_id))
    if not allowed:
        raise HTTPException(status_code=403, detail={"error": "forbidden"})
    return {"id": invoice_id, "reader": user.sub}
```

A refresh token is issued when the OAuth application has the `refresh_token` grant type. Two requests of one session can try to renew at the same moment; when the organization rotates refresh tokens, the second attempt can fail and sign the user out. Renew in one place if the app sends parallel requests.

## Sign-out that ends the LumoAuth session

The router's `/logout` clears the local session only. Add a route that also revokes the refresh token and sends the browser through the organization's end-session endpoint:

```python
# signout.py
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from lumoauth import LumoAuth, LumoAuthError

SESSION_KEY = "__lumoauth"
POST_LOGOUT_REDIRECT = "https://app.example.com/"  # registered as a post-logout redirect URI

router = APIRouter()
_oauth = LumoAuth(org_id=os.environ["LUMO_ORG_ID"], base_url=os.environ["LUMO_BASE_URL"])


@router.post("/signout")
def signout(request: Request) -> RedirectResponse:
    state = request.session.pop(SESSION_KEY, None) or {}
    tokens = state.get("tokens") or {}

    refresh_token = tokens.get("refresh_token")
    if refresh_token:
        try:
            _oauth.auth.revoke(
                refresh_token,
                token_type_hint="refresh_token",
                client_id=os.environ["LUMO_CLIENT_ID"],
                client_secret=os.environ.get("LUMO_CLIENT_SECRET") or None,
            )
        except LumoAuthError:
            pass  # sign-out must complete even when revocation fails

    params = {"post_logout_redirect_uri": POST_LOGOUT_REDIRECT}
    if tokens.get("id_token"):
        params["id_token_hint"] = tokens["id_token"]
    end_session = (
        f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1/oauth/logout"
    )
    return RedirectResponse(f"{end_session}?{urlencode(params)}", status_code=303)
```

Include it with `app.include_router(router)` and use a `POST` form for the sign-out button. LumoAuth ends its own session and redirects to `POST_LOGOUT_REDIRECT`. That URL must be registered on the OAuth application, and LumoAuth honours it only together with `id_token_hint`.

## Secrets

| Secret | Where it may be |
|---|---|
| `LUMO_CLIENT_SECRET` | Server environment or secrets manager only |
| `LUMOAUTH_API_KEY` (`lmk_...`) | Server environment or secrets manager only. Give it only the scopes that the app uses, for example `authz:check` |
| `SESSION_SECRET` | Server environment or secrets manager only |

## Checklist

- [ ] `https_only=True` and `same_site="lax"` on the session middleware.
- [ ] A server-side session store is used, or the owner accepts that the tokens are in a signed, unencrypted cookie and has checked the cookie size.
- [ ] The proxy passes the original `Host` header and the server trusts its `X-Forwarded-Proto`.
- [ ] The production redirect URI and the post-logout redirect URI are registered.
- [ ] All secrets come from the environment; `.env` is not committed.
- [ ] No log line prints `request.session`, cookies, tokens or the `Authorization` header.
- [ ] Permission checks deny the request when LumoAuth cannot be reached.
