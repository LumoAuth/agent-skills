---
name: lumoauth-python
description: >-
  Uses the `lumoauth` Python package in backends, workers and scripts: the
  `LumoAuth` client and its namespaces (`auth`, `permissions`, `zanzibar`,
  `abac`, `agents`, `delegation`, `jit`, `approvals`, `mcp`), the
  `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID` and `LUMOAUTH_API_KEY` environment
  variables, RBAC, Zanzibar and ABAC checks, the authorization code flow with
  PKCE for Flask and Django through `client.auth`, client credentials for
  machine-to-machine calls, local access-token verification with
  `verify_access_token`, the error classes, the extras (`aauth`, `dpop`,
  `verify`, `fastapi`, `api`) and the generated client behind `client.api`.
  Use when the user adds LumoAuth sign-in, permission checks or token
  validation to a Python app (Flask, Django, Celery, CLI script), runs
  `pip install lumoauth`, or mentions `from lumoauth import LumoAuth`,
  `permissions.check`, `token_provider` or `LumoAuthPermissionDeniedError`.
  Not for FastAPI (use lumoauth-fastapi) or agent code (use
  lumoauth-agent-identity).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Python

Use the `lumoauth` package from a Python backend, worker or script: check what a user may do, sign users in to a Flask or Django app, validate access tokens, and call the organization's API with a server credential.

## When to use

- A Python service must check a permission (RBAC), a relationship (Zanzibar) or a policy (ABAC).
- A Flask or Django app must sign users in with the organization's hosted login page.
- A Python API must validate the access tokens that it receives.
- A worker or script needs a machine-to-machine token or the Admin API.

Do not use this skill when:

- The app is FastAPI. Use `lumoauth-fastapi`; it has ready-made routes and dependencies.
- The code is an AI agent with its own identity (`LumoAuthAgent`, approvals, JIT, delegation, AAuth). Use `lumoauth-agent-identity`, `lumoauth-agent-approvals`, `lumoauth-agent-delegation` or `lumoauth-aauth`.
- The service is an MCP server. Use `lumoauth-mcp-server`.

## Before you start

Requirements, from the package manifest: Python 3.9 to 3.13. The only required dependency is `requests`.

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Environment variable | Where it comes from |
|---|---|---|
| Base URL | `LUMOAUTH_URL` | `https://app.lumoauth.dev` (US, the default) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | `LUMOAUTH_ORG_ID` | The `{orgId}` in `https://app.lumoauth.dev/orgs/{orgId}/portal/`. Example: `acme-corp` |
| Organization API key | `LUMOAUTH_API_KEY` | Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`) → **Create API key**. Tick only the scopes that the service needs. The key starts with `lmk_` and is shown once |
| Client ID, client secret, redirect URI (sign-in only) | The app's own names | Portal: **Applications → New application → Web application**. The secret is shown once on the next page. `lumo apps list` prints the client IDs |

`LumoAuth()` reads the three `LUMOAUTH_*` variables when an argument is not passed. The client ID, secret and redirect URI are always passed as arguments.

Pick the credential. It determines who an answer is about and which calls work.

| Credential | How to pass it | Works on |
|---|---|---|
| Organization API key (`lmk_...`) | `api_key=` or `LUMOAUTH_API_KEY`. Sent as `X-API-Key` | Permission checks, Zanzibar check and expand, the Admin API through `client.api`. Not ABAC, agents, JIT, approvals or UserInfo |
| A user's access token | `token_provider=lambda: token`. Sent as `Authorization: Bearer`. Wins over `api_key` | Calls about that user. Some need a scope: `authz:read` for `permissions.list()`, `abac:read` and `abac:write` for ABAC |
| Client ID and secret | Arguments of the `client.auth` token calls | The token endpoint only |

Extras, installed only when needed:

| Install | Adds |
|---|---|
| `pip install "lumoauth[verify]"` | Local verification of access tokens (`cryptography`) |
| `pip install "lumoauth[fastapi]"` | The FastAPI router and dependencies |
| `pip install "lumoauth[api]"` | The generated client for the full REST API, as `client.api` |
| `pip install "lumoauth[dpop]"` | DPoP proofs for sender-constrained tokens |
| `pip install "lumoauth[aauth]"` | Ed25519 signing for the AAuth protocol |

## Steps

1. Install the package.

   ```bash
   pip install lumoauth
   ```

2. Set the environment. Keep secrets out of the source and out of version control.

   ```bash
   LUMOAUTH_URL=https://app.lumoauth.dev
   LUMOAUTH_ORG_ID=acme-corp
   LUMOAUTH_API_KEY=
   ```

3. Create one client for the process and check a permission. The API key needs the `authz:check` scope, because the check names another subject than the key's owner.

   ```python
   # authz.py
   from lumoauth import LumoAuth, LumoAuthError

   lumo = LumoAuth()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY


   def may(user_id: str, permission: str) -> bool:
       """True when the user holds the permission. False when the check cannot be completed."""
       try:
           return lumo.permissions.check(permission, user_id=user_id)
       except LumoAuthError:
           return False
   ```

   `user_id` is the LumoAuth user ID: the `sub` claim of the user's tokens. Without `user_id` the check answers for the admin who created the API key. `check_any([...])` needs one of the permissions, `check_all([...])` needs every one, and `check_bulk([...])` returns `{"results": {slug: bool}}`. The client does not cache results; each call is one request.

4. Check a relationship (Zanzibar) with the same client.

   ```python
   from authz import lumo


   def may_view(user_id: str, document_id: str) -> bool:
       return lumo.zanzibar.check(f"document:{document_id}", "viewer", f"user:{user_id}")
   ```

   The arguments are `(object, relation, subject)`. For roles, relations and policies use `lumoauth-rbac`, `lumoauth-rebac` and `lumoauth-abac`. ABAC needs the user's token, not an API key; see step 6.

5. Sign users in (Flask shown here; Django in [references/flask-django-sign-in.md](references/flask-django-sign-in.md)). `client.auth` gives the building blocks of the authorization code flow with PKCE. Register the redirect URI on the OAuth application first; it must match exactly, for example `http://localhost:5000/callback`.

   ```python
   # app.py
   import base64
   import hashlib
   import os
   import secrets

   from flask import Flask, abort, jsonify, redirect, request, session

   from lumoauth import LumoAuth, LumoAuthError

   app = Flask(__name__)
   app.secret_key = os.environ["SESSION_SECRET"]
   app.config.update(
       SESSION_COOKIE_HTTPONLY=True,
       SESSION_COOKIE_SAMESITE="Lax",
       SESSION_COOKIE_SECURE=os.environ.get("APP_ENV") == "production",
   )

   lumo = LumoAuth()
   CLIENT_ID = os.environ["LUMOAUTH_CLIENT_ID"]
   CLIENT_SECRET = os.environ.get("LUMOAUTH_CLIENT_SECRET") or None  # None for a public client
   REDIRECT_URI = os.environ["LUMOAUTH_REDIRECT_URI"]


   @app.get("/login")
   def login():
       verifier = secrets.token_urlsafe(48)
       challenge = (
           base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
       )
       state = secrets.token_urlsafe(24)
       session["oauth_flow"] = {"verifier": verifier, "state": state}
       return redirect(
           lumo.auth.authorization_url(
               client_id=CLIENT_ID,
               redirect_uri=REDIRECT_URI,
               scope="openid profile email",
               state=state,
               code_challenge=challenge,  # the method defaults to S256
           )
       )


   @app.get("/callback")
   def callback():
       flow = session.pop("oauth_flow", None)
       if request.args.get("error"):
           abort(400, description="Sign-in was not completed.")
       state = request.args.get("state", "")
       code = request.args.get("code")
       if not flow or not code or not secrets.compare_digest(state, flow["state"]):
           abort(400, description="Invalid sign-in response.")
       try:
           tokens = lumo.auth.exchange_code(
               code,
               REDIRECT_URI,
               client_id=CLIENT_ID,
               client_secret=CLIENT_SECRET,
               code_verifier=flow["verifier"],
           )
           profile = lumo.auth.userinfo(access_token=tokens["access_token"])
       except LumoAuthError:
           abort(502, description="Sign-in failed.")
       session.clear()
       # Flask's default session is a signed cookie that the browser can read.
       # Keep tokens out of it; store only what the pages need.
       session["user"] = {"sub": profile["sub"], "email": profile.get("email"), "name": profile.get("name")}
       return redirect("/")


   @app.get("/api/me")
   def me():
       user = session.get("user")
       if not user:
           abort(401)
       return jsonify(user)


   @app.post("/logout")
   def logout():
       session.clear()
       return redirect("/")
   ```

6. Call LumoAuth as the user when a call needs the user's own token (ABAC, `permissions.list()`). Pass the token through `token_provider`; it is called before each request.

   ```python
   import os

   from lumoauth import LumoAuth


   def client_for(access_token: str) -> LumoAuth:
       return LumoAuth(org_id=os.environ["LUMOAUTH_ORG_ID"], token_provider=lambda: access_token)


   def may_read_invoice(access_token: str, invoice_id: str) -> bool:
       # The token needs the abac:read scope. Request it at sign-in.
       return client_for(access_token).abac.is_allowed("invoice", "read", invoice_id)
   ```

   The app must keep the access token on the server for this (a server-side session or a database), and renew it with `lumo.auth.refresh_token(refresh_token, client_id=..., client_secret=...)` when it expires.

7. Handle errors by class. Every failure is a subclass of `LumoAuthError`.

   ```python
   import time

   from lumoauth import (
       LumoAuth,
       LumoAuthNetworkError,
       LumoAuthPermissionDeniedError,
       LumoAuthRateLimitError,
   )

   lumo = LumoAuth()


   def check_with_retry(user_id: str, permission: str) -> bool:
       for attempt in range(3):
           try:
               return lumo.permissions.check(permission, user_id=user_id)
           except LumoAuthRateLimitError as err:
               time.sleep(err.retry_after or 1)
           except LumoAuthNetworkError:
               time.sleep(0.5 * (attempt + 1))
           except LumoAuthPermissionDeniedError as err:
               # The credential may not ask this question, for example a key without authz:check.
               raise RuntimeError(f"LumoAuth refused the check: {err.code}") from err
       return False  # deny when LumoAuth cannot be reached
   ```

8. For a JSON API that receives access tokens, a machine-to-machine token, the generated client or the full method list, open the matching reference file below.

Security rules:

- API keys and client secrets stay on the server. Never put one in browser or mobile code, and never commit one.
- Never log tokens, API keys or the `Authorization` header. Never set `skip_cert_validation=True` outside local development.
- Validate `state` on the callback and use PKCE, as in step 5.
- Take the user ID from the session or from a verified token, never from the request body.
- When a check cannot be completed, deny.

## Verify

1. `python -c "from lumoauth import LumoAuth; c = LumoAuth(); print(c.base_url, c.org_id)"` prints the base URL and the slug.
2. Call `may("<a real user's sub>", "<an existing permission>")` from a Python shell, for a user with and without a role that grants the permission. It returns `True` and `False`.
3. Flask: open `/login`, sign in on the organization's login page, and check that `/api/me` returns the profile. `curl -i http://localhost:5000/api/me` without a cookie answers `401`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuthConfigError: org_id is required` | An organization-scoped call (auth, ABAC, agents) without a slug | Pass `org_id` or set `LUMOAUTH_ORG_ID` |
| `LumoAuthAuthenticationError` (401) on every call | No credential, a wrong or expired API key, or the wrong region in `LUMOAUTH_URL` | Check `LUMOAUTH_API_KEY` and the base URL |
| 401 from ABAC, agents, JIT or approvals with an API key | API keys work only on permission checks, Zanzibar and the Admin API | Use a user access token (`token_provider`) or an agent credential |
| 401 from `auth.userinfo()` | The client sent the API key | Pass `access_token=...` |
| `LumoAuthPermissionDeniedError` with code `INSUFFICIENT_PERMISSIONS` on a check with `user_id` or on `zanzibar.expand()` | The credential lacks `authz:check` | Create an API key with the `authz:check` scope |
| `LumoAuthPermissionDeniedError` with `required_scopes == ["authz:read"]` from `permissions.list()` | A user token without `authz:read`, or an API key | Request `authz:read` at sign-in. API keys cannot hold it |
| `LumoAuthNotFoundError` with code `SUBJECT_NOT_FOUND` | `user_id` is an email or the app's own ID | Pass the LumoAuth user ID (`sub`) |
| A check answers for the wrong user | `user_id` was not passed | Pass `user_id=` |
| The API key in the docs or a docstring starts with `lk_` | Old example text | Real organization keys start with `lmk_` |
| `invalid_grant` on `exchange_code` | The code was used twice, the redirect URI differs from the one in the authorization request, or the PKCE verifier is wrong | Send the same `redirect_uri` in both calls; exchange each code once |

## Related skills

- `lumoauth-fastapi`: FastAPI routes and dependencies from the same package.
- `lumoauth-api-protection`: token validation concepts, introspection, API keys.
- `lumoauth-authorization`, `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`: choose and design the authorization model.
- `lumoauth-agent-identity`, `lumoauth-agent-approvals`, `lumoauth-agent-delegation`, `lumoauth-aauth`: `LumoAuthAgent` and the agent helpers of this package.
- `lumoauth-admin-api`: the REST API behind `client.api`.

## References

- [references/client-reference.md](references/client-reference.md): the constructor, every namespace and method with its signature, which credential and scope each call needs, and the error classes. Read it before you call a method that is not shown above.
- [references/flask-django-sign-in.md](references/flask-django-sign-in.md): the sign-in flow in Django, token storage and refresh, and sign-out that ends the LumoAuth session.
- [references/tokens-and-machine-access.md](references/tokens-and-machine-access.md): verifying access tokens in a Flask or Django API with `verify_access_token`, the client-credentials grant, and `client.api`.
- https://docs.lumoauth.dev/quickstarts/python
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/authorization/check
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
