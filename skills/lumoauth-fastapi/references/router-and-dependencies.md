# `lumoauth.fastapi`: router, dependencies and responses

Checked against the `lumoauth` package 1.4.0 (`lumoauth/fastapi/integration.py`). Read this page when you change a default, debug a response of the sign-in routes, or need to know what the session holds.

## Exports of `lumoauth.fastapi`

| Name | Kind | Purpose |
|---|---|---|
| `lumo_auth_router(...)` | function | Returns an `APIRouter` with `/login`, `/callback` and `/logout` |
| `get_current_user` | dependency | Returns the signed-in `User` or `None` |
| `require_auth(scopes=None)` | dependency factory | Returns the `User`; answers `401` or `403` |
| `User` | Pydantic model | The signed-in user |
| `LumoAuthFastAPI` | dataclass | The configuration that the router builds from its arguments |
| `require_access_token(...)` | dependency factory | Verifies a bearer or DPoP access token. See [bearer-token-apis.md](bearer-token-apis.md) |
| `parse_authorization(value)` | function | Splits an `Authorization` header into `("Bearer" or "DPoP", token)`, or `(None, None)` |
| `AccessTokenClaims` | dataclass | The verified claims of an access token |

## `lumo_auth_router(...)`

All arguments are keyword-only.

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `base_url` | `str` | required | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `organization` | `str` | required | Organization slug |
| `client_id` | `str` | required | Client ID of the OAuth application |
| `client_secret` | `Optional[str]` | `None` | Secret of a confidential client. It is sent in the body of the token request. Leave it out, or pass `None`, for a public client, which relies on PKCE alone |
| `callback_path` | `str` | `"/auth/callback"` | The absolute path that LumoAuth redirects back to. It must be the `include_router` prefix plus `/callback` |
| `scope` | `str` | `"openid profile email"` | Space-separated scopes to request |
| `post_login_redirect` | `str` | `"/"` | Where the browser goes after sign-in when the login request had no valid `return_to` |
| `post_logout_redirect` | `str` | `"/"` | Where `/logout` redirects |

The router reads nothing from the environment. Requests to LumoAuth have a 10-second timeout.

With another prefix, change both values together:

```python
import os

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from lumoauth.fastapi import lumo_auth_router

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key=os.environ["SESSION_SECRET"])
app.include_router(
    lumo_auth_router(
        base_url=os.environ["LUMO_BASE_URL"],
        organization=os.environ["LUMO_ORG_ID"],
        client_id=os.environ["LUMO_CLIENT_ID"],
        client_secret=os.environ.get("LUMO_CLIENT_SECRET") or None,
        callback_path="/account/callback",
        scope="openid profile email",
        post_login_redirect="/dashboard",
        post_logout_redirect="/",
    ),
    prefix="/account",
)
```

The redirect URI to register is then `{origin}/account/callback`.

## What each route does

| Request | Behaviour |
|---|---|
| `GET {prefix}/login` | Creates a PKCE verifier, an S256 challenge and a random `state`. Stores the verifier, the `state`, the redirect URI and the return path in the session. Redirects (`302`) to `{base_url}/orgs/{organization}/api/v1/oauth/authorize`. The optional query parameter `return_to` is accepted only when it starts with `/` and not with `//`; otherwise `post_login_redirect` is used |
| `GET {prefix}/callback` | Compares `state` with the stored value. Exchanges the code at the token endpoint with the PKCE verifier (and `client_secret` when set). Loads the profile from the UserInfo endpoint. Stores the tokens and the profile in the session. Redirects to the return path |
| `GET` or `POST {prefix}/logout` | Deletes the LumoAuth data from the session. Other session keys stay. Redirects to `post_logout_redirect` |

The redirect URI is built from the request: `{request.url.scheme}://{request.url.netloc}{callback_path}`.

What the router does not do. Plan for these:

- **No token refresh.** The access token in the session is not renewed when it expires. The signed-in state (`get_current_user`) does not depend on the token and lasts as long as the session.
- **No sign-out at LumoAuth.** `/logout` clears the local session only. It does not revoke tokens and does not end the user's LumoAuth session, so the next `/login` can return without showing the login page.

[production.md](production.md) shows how to add both.

## Dependencies

```python
from typing import Optional

from fastapi import APIRouter, Depends

from lumoauth.fastapi import User, get_current_user, require_auth

router = APIRouter()


@router.get("/maybe")
def maybe(user: Optional[User] = Depends(get_current_user)):
    return {"signed_in": user is not None}


@router.get("/must")
def must(user: User = Depends(require_auth())):
    return {"sub": user.sub}


@router.get("/admin/reports")
def admin_reports(user: User = Depends(require_auth(scopes=["reports:read", "reports:export"]))):
    return {"sub": user.sub}
```

| Dependency | Result |
|---|---|
| `get_current_user` | The `User` from the session, or `None`. Never raises for an anonymous visitor |
| `require_auth()` | The `User`. Raises `401` with `{"detail": {"error": "unauthenticated"}}` when nobody is signed in |
| `require_auth(scopes=[...])` | Also compares each scope with the `scope` value that the token endpoint returned at sign-in. Raises `403` with `{"detail": {"error": "insufficient_scope", "error_description": "Missing: ..."}}` |

Protect a whole router with `APIRouter(dependencies=[Depends(require_auth())])`.

Both dependencies read `request.session`. On a route that is reached without `SessionMiddleware`, Starlette raises an `AssertionError` and the answer is `500`.

For a page, redirect instead of answering `401`:

```python
from typing import Optional
from urllib.parse import quote

from fastapi import Depends, HTTPException, Request

from lumoauth.fastapi import User, get_current_user


def require_sign_in(request: Request, user: Optional[User] = Depends(get_current_user)) -> User:
    if user is None:
        target = quote(request.url.path, safe="/")
        raise HTTPException(status_code=307, headers={"Location": f"/auth/login?return_to={target}"})
    return user
```

## The `User` model

```python
class User(BaseModel):
    model_config = ConfigDict(extra="allow")

    sub: str
    email: Optional[str] = None
    email_verified: Optional[bool] = None
    name: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    picture: Optional[str] = None
```

- `sub` is the LumoAuth user ID. Use it as the key for your own user records and as `user_id` in permission checks.
- The model is built from the UserInfo answer that was stored at sign-in. It is not loaded again on later requests, so a profile change reaches the app at the next sign-in.
- Extra claims are kept. Read one with `getattr(user, "claim_name", None)`, or get everything with `user.model_dump()`.
- Which claims are present depends on the granted scopes: `profile` gives the name claims, `email` gives `email` and `email_verified`.

## Error responses of the sign-in routes

| Route | Status | Body | Cause |
|---|---|---|---|
| `/login` | `500` | `{"detail": {"error": "session_middleware_missing", ...}}` | `SessionMiddleware` is not installed |
| `/callback` | `400` | `{"error": "<error from LumoAuth>", "error_description": "..."}` | LumoAuth sent `error` to the callback, for example `access_denied` |
| `/callback` | `400` | `{"error": "invalid_request", "error_description": "Missing code or state"}` | The callback has no `code` or no `state` |
| `/callback` | `400` | `{"error": "invalid_request", "error_description": "No login in progress"}` | The session holds no sign-in in progress |
| `/callback` | `400` | `{"error": "invalid_state", "error_description": "CSRF state mismatch"}` | `state` differs from the stored value |
| `/callback` | `502` | `{"detail": {"error": "...", "error_description": "..."}}` | LumoAuth refused the code exchange. `error` is the OAuth error, for example `invalid_client` or `invalid_grant` |
| `/callback` | `502` | `{"error": "token_exchange_failed", "error_description": "..."}` | The token request failed for another reason, for example a network error |

A failure of the UserInfo request after a successful exchange is not caught by the router and gives `500`.

## What the session holds

The router keeps its data under one key, `request.session["__lumoauth"]`:

| Field | Content |
|---|---|
| `flow` | `code_verifier`, `state`, `redirect_uri`, `return_to`. Present only between login and callback |
| `tokens` | `access_token`, `refresh_token` (or `None`), `id_token` (or `None`), `token_type`, `scope` |
| `user` | The UserInfo claims as a dict |

The expiry time of the access token is not stored. With Starlette's `SessionMiddleware`, all of this is in the session cookie; see [production.md](production.md).

## `LumoAuthFastAPI`

`lumo_auth_router` builds this dataclass from its arguments. Create one yourself only when your own code needs the same settings and helpers:

| Member | Purpose |
|---|---|
| Fields `base_url`, `organization`, `client_id`, `client_secret`, `callback_path`, `scope`, `post_login_redirect`, `post_logout_redirect`, `request_timeout_seconds` (default `10.0`) | The configuration |
| `authorize_url()`, `token_url()`, `userinfo_url()` | The organization's endpoint URLs |
| `exchange_code(code, code_verifier, redirect_uri)` | Code exchange. Raises `HTTPException(502)` when LumoAuth refuses it |
| `fetch_userinfo(access_token)` | UserInfo request |
| `auth_resource()` | The `AuthResource` that the helpers use. It is the same class as `client.auth` on the `LumoAuth` client |

An instance that you create is not connected to the router; the router keeps its own.
