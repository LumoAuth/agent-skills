# Sign-in for Flask and Django with `client.auth`

The `lumoauth` package has ready-made sign-in routes for FastAPI only. For Flask and Django, the app writes three small views on top of `client.auth`: login, callback and logout. `SKILL.md` shows the Flask version. Read this page for Django, for storing and renewing tokens, and for a sign-out that also ends the LumoAuth session.

## What the app must do itself

| Task | Why |
|---|---|
| Create a PKCE verifier and S256 challenge for each sign-in | The code cannot be redeemed without the verifier |
| Create a random `state`, store it in the session, compare it on the callback | Protects the callback against forged requests |
| Send the same `redirect_uri` to `authorization_url()` and `exchange_code()` | LumoAuth compares both with the registered URI, exactly |
| Keep the client secret and the tokens on the server | The browser must never see them |
| Accept only local paths as the page to open after sign-in | Prevents open redirects |

Register the redirect URI on the OAuth application before the first test: portal **Applications → the application → Configuration → Redirect URIs**, or `lumo apps update <client-id> --redirect-uris <uri>,<uri>` (the command replaces the whole list). `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`.

## Django

Django's default session backend stores session data in the database, so the tokens stay on the server. Do not use the `signed_cookies` session backend for this: it would put the tokens into the cookie.

```python
# settings.py (additions)
import os

LUMOAUTH_CLIENT_ID = os.environ["LUMOAUTH_CLIENT_ID"]
LUMOAUTH_CLIENT_SECRET = os.environ.get("LUMOAUTH_CLIENT_SECRET") or None
LUMOAUTH_REDIRECT_URI = os.environ["LUMOAUTH_REDIRECT_URI"]        # https://app.example.com/auth/callback
LUMOAUTH_POST_LOGOUT_URI = os.environ["LUMOAUTH_POST_LOGOUT_URI"]  # https://app.example.com/

SESSION_COOKIE_SECURE = True      # False only for http://localhost
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"   # "Strict" would drop the cookie on the callback redirect
```

```python
# accounts/lumo_views.py
import base64
import hashlib
import secrets
import time
from functools import wraps
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.http import require_GET, require_POST

from lumoauth import LumoAuth, LumoAuthError

lumo = LumoAuth()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY


def _safe_path(value, fallback="/"):
    """Only paths on this site: starts with one slash."""
    if isinstance(value, str) and value.startswith("/") and not value.startswith("//"):
        return value
    return fallback


@require_GET
def login(request):
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    state = secrets.token_urlsafe(24)
    request.session["lumo_flow"] = {
        "verifier": verifier,
        "state": state,
        "next": _safe_path(request.GET.get("next")),
    }
    return redirect(
        lumo.auth.authorization_url(
            client_id=settings.LUMOAUTH_CLIENT_ID,
            redirect_uri=settings.LUMOAUTH_REDIRECT_URI,
            scope="openid profile email",
            state=state,
            code_challenge=challenge,
        )
    )


@require_GET
def callback(request):
    flow = request.session.pop("lumo_flow", None)
    if request.GET.get("error"):
        return HttpResponseBadRequest("Sign-in was not completed.")
    code = request.GET.get("code")
    state = request.GET.get("state", "")
    if not flow or not code or not secrets.compare_digest(state, flow["state"]):
        return HttpResponseBadRequest("Invalid sign-in response.")
    try:
        tokens = lumo.auth.exchange_code(
            code,
            settings.LUMOAUTH_REDIRECT_URI,
            client_id=settings.LUMOAUTH_CLIENT_ID,
            client_secret=settings.LUMOAUTH_CLIENT_SECRET,
            code_verifier=flow["verifier"],
        )
        profile = lumo.auth.userinfo(access_token=tokens["access_token"])
    except LumoAuthError:
        return HttpResponse("Sign-in failed.", status=502)

    request.session.cycle_key()  # new session ID after sign-in
    request.session["lumo_user"] = {
        "sub": profile["sub"],
        "email": profile.get("email"),
        "name": profile.get("name"),
    }
    request.session["lumo_tokens"] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "id_token": tokens.get("id_token"),
        "scope": tokens.get("scope", ""),
        "expires_at": time.time() + tokens.get("expires_in", 3600),
    }
    return redirect(flow["next"])


def lumo_login_required(view):
    """Redirect anonymous visitors to the login view."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.session.get("lumo_user"):
            return redirect(f"/auth/login?{urlencode({'next': request.get_full_path()})}")
        return view(request, *args, **kwargs)

    return wrapper


@lumo_login_required
def me(request):
    return JsonResponse(request.session["lumo_user"])


@require_POST
def logout(request):
    tokens = request.session.get("lumo_tokens") or {}
    request.session.flush()

    if tokens.get("refresh_token"):
        try:
            lumo.auth.revoke(
                tokens["refresh_token"],
                token_type_hint="refresh_token",
                client_id=settings.LUMOAUTH_CLIENT_ID,
                client_secret=settings.LUMOAUTH_CLIENT_SECRET,
            )
        except LumoAuthError:
            pass  # sign-out must complete even when revocation fails

    # End the LumoAuth session too. Otherwise the next login returns without the login page.
    params = {"post_logout_redirect_uri": settings.LUMOAUTH_POST_LOGOUT_URI}
    if tokens.get("id_token"):
        params["id_token_hint"] = tokens["id_token"]
    end_session = f"{lumo.base_url}/orgs/{lumo.org_id}/api/v1/oauth/logout"
    return redirect(f"{end_session}?{urlencode(params)}")
```

```python
# urls.py (additions)
from django.urls import path

from accounts import lumo_views

urlpatterns = [
    path("auth/login", lumo_views.login),
    path("auth/callback", lumo_views.callback),
    path("auth/logout", lumo_views.logout),
    path("api/me", lumo_views.me),
]
```

The logout view accepts `POST` only, so Django's CSRF protection covers it. Use a form with `{% csrf_token %}` for the sign-out button.

To use Django's own `User` model and `@login_required`, look up or create a `User` keyed by the `sub` value in the callback and call `django.contrib.auth.login(request, user)`. Key the record by `sub`, not by email: an email address can change.

## Renew the access token

The views above store `expires_at`. Renew the token shortly before that time, in one helper:

```python
# accounts/lumo_tokens.py
import time
from typing import Optional

from django.conf import settings

from lumoauth import LumoAuth, LumoAuthApiError

lumo = LumoAuth()


def access_token_for(request) -> Optional[str]:
    """The user's access token, renewed when needed. None means: sign in again."""
    tokens = request.session.get("lumo_tokens")
    if not tokens:
        return None
    if tokens["expires_at"] - time.time() > 60:
        return tokens["access_token"]
    if not tokens.get("refresh_token"):
        return None
    try:
        fresh = lumo.auth.refresh_token(
            tokens["refresh_token"],
            client_id=settings.LUMOAUTH_CLIENT_ID,
            client_secret=settings.LUMOAUTH_CLIENT_SECRET,
        )
    except LumoAuthApiError:
        request.session.flush()  # the refresh token is no longer accepted
        return None
    request.session["lumo_tokens"] = {
        "access_token": fresh["access_token"],
        "refresh_token": fresh.get("refresh_token") or tokens["refresh_token"],
        "id_token": fresh.get("id_token") or tokens.get("id_token"),
        "scope": fresh.get("scope") or tokens.get("scope", ""),
        "expires_at": time.time() + fresh.get("expires_in", 3600),
    }
    return fresh["access_token"]
```

LumoAuth issues a refresh token when the OAuth application has the `refresh_token` grant type. Always store the `refresh_token` of the newest response: with rotation, the old one stops working.

Use the token for calls that must run as the user:

```python
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import redirect

from lumoauth import LumoAuth

from accounts.lumo_tokens import access_token_for


def invoice(request, invoice_id: str):
    token = access_token_for(request)
    if token is None:
        return redirect("/auth/login")
    as_user = LumoAuth(token_provider=lambda: token)
    # ABAC needs the abac:read scope on the token. Request it at sign-in.
    if not as_user.abac.is_allowed("invoice", "read", invoice_id):
        return HttpResponseForbidden()
    return JsonResponse({"id": invoice_id})
```

## Flask: tokens, guards and sign-out

Flask's default session is a signed cookie. The browser can read its content, and its size is limited. The Flask example in `SKILL.md` therefore stores only the profile. When the app needs the tokens later, use a server-side session (for example the Flask-Session extension) or store the tokens in the app's database, keyed by `sub`. The helpers of the Django section then work the same way with Flask's `session`.

A guard and a sign-out that ends the LumoAuth session:

```python
# auth_helpers.py
import os
from functools import wraps
from urllib.parse import urlencode

from flask import abort, redirect, session

from lumoauth import LumoAuth

lumo = LumoAuth()


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            abort(401)
        return view(*args, **kwargs)

    return wrapper


def end_session_redirect(id_token=None):
    """Clear the local session and send the browser through the end-session endpoint."""
    session.clear()
    params = {"post_logout_redirect_uri": os.environ["LUMOAUTH_POST_LOGOUT_URI"]}
    if id_token:
        params["id_token_hint"] = id_token
    return redirect(f"{lumo.base_url}/orgs/{lumo.org_id}/api/v1/oauth/logout?{urlencode(params)}")
```

LumoAuth honours `post_logout_redirect_uri` only when `id_token_hint` identifies the application and the URI is registered on it (**Configuration → Logout → Post-logout redirect URIs**). Without the hint, LumoAuth still ends its session and shows its own confirmation page. Keep the ID token from the callback on the server if the app needs the redirect.

Flask has no CSRF protection of its own. Make the logout route `POST`, keep `SESSION_COOKIE_SAMESITE="Lax"`, and add CSRF protection to forms if the app has none.

## Requesting more at sign-in

| Need | How |
|---|---|
| More scopes | `scope="openid profile email authz:read"`. The OAuth application must allow each scope |
| A token for one API (audience) | `extra={"resource": "https://api.example.com"}`. The URI must be allowed on the application |
| Force the login page | `prompt="login"` |
| Open the sign-up page | `prompt="create"`, when self-registration is on |
| Pre-fill the email field | `extra={"login_hint": "<the address that the user typed>"}` |

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows a redirect URI error | The URI is not registered, or differs in scheme, host, port or path | Register the exact value of `LUMOAUTH_REDIRECT_URI` |
| The callback answers "Invalid sign-in response" | The session cookie did not come back: another host name (`127.0.0.1` vs `localhost`), `SameSite=Strict`, or a `Secure` cookie over plain HTTP | Use one host name, `Lax`, and `Secure` only on HTTPS |
| `invalid_client` on `exchange_code` | Wrong or missing client secret for a confidential client | Check `LUMOAUTH_CLIENT_SECRET` |
| The next login skips the login page after sign-out | Only the local session ended | Redirect through the end-session endpoint |
| No `refresh_token` in the token response | The application lacks the `refresh_token` grant type | Add it on the application's **Configuration** tab under **Grant types** |
