---
name: lumoauth-fastapi
description: >-
  Adds LumoAuth to a FastAPI app with the `lumoauth[fastapi]` Python package:
  Starlette `SessionMiddleware`, `lumo_auth_router()` for the login, callback
  and logout routes (authorization code flow with PKCE), the
  `get_current_user` and `require_auth(scopes=[...])` dependencies, the `User`
  model, permission checks with the `LumoAuth` client, and
  `require_access_token()` for JSON APIs that receive bearer or DPoP access
  tokens. Use when the user wants sign-in, sign-out, sessions, protected
  routes or token validation in FastAPI or Starlette with LumoAuth, mentions
  `lumoauth.fastapi`, `lumo_auth_router`, `get_current_user`, `require_auth`,
  `require_access_token` or `lumo init --framework fastapi`, or sees
  `session_middleware_missing`, `invalid_state` or a redirect URI mismatch in
  a FastAPI app. Not for Flask, Django or scripts (use lumoauth-python).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for FastAPI

Add sign-in and route protection to a FastAPI app with `lumoauth.fastapi`. The package covers two cases: a web app that signs users in and keeps a session, and a JSON API that validates the access token on each request.

## When to use

- **Session sign-in**: the FastAPI app serves pages, or a same-origin frontend, and must sign users in. Follow the steps below.
- **Bearer-token API**: a separate frontend, a mobile app, an agent or an MCP client sends `Authorization: Bearer` or `DPoP` tokens to the FastAPI app. Go to step 7 and [references/bearer-token-apis.md](references/bearer-token-apis.md).

Do not use this skill when:

- The Python app is Flask, Django, a worker or a script. Use `lumoauth-python`.
- The FastAPI app is an MCP server. Use `lumoauth-mcp-server`.
- The code is an AI agent that signs in as itself. Use `lumoauth-agent-identity`.

## Before you start

Requirements, from the package manifest: Python 3.9 to 3.13 and FastAPI 0.110 or newer. The `fastapi` extra installs `fastapi` and `itsdangerous`. It does not install a server; add `uvicorn`.

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in `https://app.lumoauth.dev/orgs/{orgId}/portal/`. Example: `acme-corp` |
| Client ID | An OAuth application in the organization. See below |
| Client secret | Shown once when a **Web application** is created. A public PKCE client has none |
| Redirect URI | `{app origin}/auth/callback`, registered on the application. The port is part of it: `http://localhost:3000/auth/callback` in development, `https://app.example.com/auth/callback` in production |
| Session secret | A random string that the app owner generates, for example `openssl rand -hex 32` |

Find or create the OAuth application in one of these ways:

- **Portal.** Open **Applications** (`/orgs/{orgId}/portal/applications`) and click **New application**. Keep the protocol **OpenID Connect**, enter an **Application name**, choose **Web application**, enter the **Redirect URI** and click **Create application**. The next page shows the client secret once. The client ID stays on the application's **Credentials** tab.
- **Portal Quickstarts page.** The **FastAPI** tab shows the `.env` values for the organization and the selected client.
- **CLI.** `lumo apps list` prints the client IDs. To create a client, show this command to the user before you run it:

  ```bash
  lumo apps create --name "FastAPI app" --redirect-uris http://localhost:3000/auth/callback -o json
  ```

  The JSON output holds the client ID in `data.clientId` and the secret in `data.secret`. The secret is not shown again. Without `-o json` the secret is not printed.

Every organization also has a **Starter App**: a public PKCE client (no secret) that already allows `http://localhost:3000/auth/callback`. It is enough for local development on port 3000.

Redirect URIs match exactly. `uvicorn` listens on port 8000 by default; either run it with `--port 3000` or register `http://localhost:8000/auth/callback`.

## Steps

### Option A: scaffold a new app

Use this for an empty directory. Run `lumo login` first, so that `.env` gets the organization slug and base URL.

```bash
lumo init --framework fastapi --dir ./my-app
cd ./my-app && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload --port 3000
```

The command writes `README.md`, `.env`, `.gitignore`, `requirements.txt` and `main.py`. `--client-id` pre-fills the client ID; without it, set `LUMO_CLIENT_ID` in `.env` before the first sign-in. The generated `main.py` uses `User | None`, which needs Python 3.10 or newer. The result is the same code as Option B.

### Option B: add to an existing app

1. Install the packages.

   ```bash
   pip install "lumoauth[fastapi]" "uvicorn[standard]" python-dotenv
   ```

2. Add the configuration to `.env`. Keep `.env` out of version control. The router reads no environment variables itself; these names match the `lumo init` starter and the portal's Quickstarts page.

   ```bash
   LUMO_BASE_URL=https://app.lumoauth.dev
   LUMO_ORG_ID=acme-corp
   LUMO_CLIENT_ID=
   LUMO_CLIENT_SECRET=
   SESSION_SECRET=
   ```

3. Add `SessionMiddleware`, then include the router under the `/auth` prefix.

   ```python
   # main.py
   import os
   from html import escape
   from typing import Optional

   from dotenv import load_dotenv
   from fastapi import Depends, FastAPI
   from fastapi.responses import HTMLResponse, RedirectResponse
   from starlette.middleware.sessions import SessionMiddleware

   from lumoauth.fastapi import User, get_current_user, lumo_auth_router, require_auth

   load_dotenv()

   app = FastAPI()

   # The router keeps the PKCE verifier, the state value, the tokens and the profile
   # in request.session, so a session middleware is required.
   app.add_middleware(
       SessionMiddleware,
       secret_key=os.environ["SESSION_SECRET"],
       same_site="lax",
       https_only=os.environ.get("APP_ENV") == "production",
   )

   # Adds GET /auth/login, GET /auth/callback and GET|POST /auth/logout.
   app.include_router(
       lumo_auth_router(
           base_url=os.environ["LUMO_BASE_URL"],
           organization=os.environ["LUMO_ORG_ID"],
           client_id=os.environ["LUMO_CLIENT_ID"],
           # Leave LUMO_CLIENT_SECRET empty for a public PKCE client such as the Starter App.
           client_secret=os.environ.get("LUMO_CLIENT_SECRET") or None,
           callback_path="/auth/callback",
       ),
       prefix="/auth",
   )


   @app.get("/", response_class=HTMLResponse)
   def home(user: Optional[User] = Depends(get_current_user)):
       if user is None:
           return RedirectResponse("/auth/login")
       return f"<h1>Hi {escape(user.email or user.sub)}</h1><a href='/auth/logout'>Sign out</a>"


   # 401 when nobody is signed in.
   @app.get("/api/me")
   def me(user: User = Depends(require_auth())):
       return user.model_dump()
   ```

   `callback_path` must be the prefix plus `/callback`. The router mounts the route at `{prefix}/callback` and sends `{scheme}://{host}{callback_path}` to LumoAuth as the redirect URI.

4. Run the app on the port of the registered redirect URI.

   ```bash
   uvicorn main:app --reload --port 3000
   ```

5. Use the dependencies in routes.

   ```python
   from typing import Optional

   from fastapi import APIRouter, Depends
   from fastapi.responses import RedirectResponse

   from lumoauth.fastapi import User, get_current_user, require_auth

   router = APIRouter()


   # Optional sign-in: the dependency returns None for an anonymous visitor.
   @router.get("/dashboard")
   def dashboard(user: Optional[User] = Depends(get_current_user)):
       if user is None:
           return RedirectResponse("/auth/login?return_to=/dashboard")
       return {"name": user.name}


   # Required sign-in plus scopes: 403 when the granted scopes lack one of them.
   @router.get("/api/reports")
   def reports(user: User = Depends(require_auth(scopes=["reports:read"]))):
       return {"owner": user.sub}
   ```

   `require_auth()` reads the session only. It does not call LumoAuth. A scope that a route needs must also be requested at sign-in with the `scope` argument of `lumo_auth_router` and allowed on the OAuth application.

6. Check a permission (RBAC) with the `LumoAuth` client. It needs an organization API key with the `authz:check` scope. Create the key in the portal under **API keys** (`/orgs/{orgId}/portal/settings/api-keys`): click **Create API key**, tick `authz:check` under **Permissions**, and copy the key once. It starts with `lmk_`. Store it as `LUMOAUTH_API_KEY` on the server only.

   ```python
   # permissions.py
   import os

   from fastapi import Depends, HTTPException

   from lumoauth import LumoAuth, LumoAuthError
   from lumoauth.fastapi import User, require_auth

   lumo = LumoAuth(
       api_key=os.environ["LUMOAUTH_API_KEY"],
       org_id=os.environ["LUMO_ORG_ID"],
       base_url=os.environ["LUMO_BASE_URL"],
   )


   def require_permission(permission: str):
       """Dependency factory: the signed-in user must hold the permission."""

       def dependency(user: User = Depends(require_auth())) -> User:
           try:
               allowed = lumo.permissions.check(permission, user_id=user.sub)
           except LumoAuthError as exc:
               # Deny when the check cannot be completed.
               raise HTTPException(status_code=503, detail={"error": "authorization_unavailable"}) from exc
           if not allowed:
               raise HTTPException(status_code=403, detail={"error": "forbidden"})
           return user

       return dependency
   ```

   ```python
   from fastapi import APIRouter, Depends

   from lumoauth.fastapi import User
   from permissions import require_permission

   router = APIRouter()


   @router.delete("/api/documents/{document_id}")
   def delete_document(document_id: str, user: User = Depends(require_permission("document.delete"))):
       return {"deleted": document_id, "by": user.sub}
   ```

   Always pass `user_id=user.sub`. Without it the check answers for the owner of the API key. The client is synchronous (`requests`), so keep the dependency a plain `def`: FastAPI then runs it in a thread pool. For roles and permission design use `lumoauth-rbac`. For Zanzibar, ABAC and the other namespaces of the client use `lumoauth-python`.

7. For a JSON API that receives access tokens instead of a session cookie, use `require_access_token()`. It verifies the token locally: signature against the organization's JWKS, `iss`, `aud`, `exp`, and the DPoP proof when the token is bound. It needs the `verify` extra.

   ```bash
   pip install "lumoauth[fastapi,verify]"
   ```

   ```python
   # api.py
   import os

   from fastapi import Depends, FastAPI

   from lumoauth.fastapi import AccessTokenClaims, require_access_token

   app = FastAPI()

   issuer = f"{os.environ['LUMO_BASE_URL']}/orgs/{os.environ['LUMO_ORG_ID']}/api/v1"

   read_access = require_access_token(
       issuer=issuer,
       resource=os.environ["API_AUDIENCE"],  # the value that the token's aud must contain
       scopes=["documents:read"],
   )


   @app.get("/api/documents")
   def list_documents(claims: AccessTokenClaims = Depends(read_access)):
       return {"sub": claims.sub, "scopes": list(claims.scopes)}
   ```

   No `SessionMiddleware` and no client secret are needed for this. Read [references/bearer-token-apis.md](references/bearer-token-apis.md) for the audience value, every parameter, the error responses and DPoP.

Security rules:

- The client secret, the API key and the session secret stay on the server. Never commit them and never return them in a response.
- Never log `request.session`, tokens or the `Authorization` header.
- Starlette's `SessionMiddleware` stores the session in a signed cookie. The tokens are in it. Read [references/production.md](references/production.md) before the app is deployed.
- Do not write your own callback handler next to the router. The router already validates `state` and uses PKCE.

## Verify

1. Start the app and open `http://localhost:3000/`. The browser goes to `/auth/login`, then to the organization's login page.
2. Sign in. The browser returns to `/auth/callback` and then to `/`, which shows the user's email.
3. `curl -i http://localhost:3000/api/me` answers `401` with `{"detail":{"error":"unauthenticated"}}`.
4. Open `/api/me` in the signed-in browser. It returns the profile with `sub`.
5. Open `/auth/logout`. After that, `/api/me` answers `401` again.
6. Bearer-token API: `curl -i http://localhost:3000/api/documents` answers `401` with a `WWW-Authenticate` header. With a valid access token it answers `200`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `/auth/login` answers `500` `session_middleware_missing` | `SessionMiddleware` is not added | Add it with `app.add_middleware(SessionMiddleware, secret_key=...)` |
| LumoAuth shows a redirect URI error | The URI that the router built (`{scheme}://{host}{callback_path}`) is not registered. Typical: port 8000 instead of 3000, `127.0.0.1` instead of `localhost`, or `http` behind a TLS proxy | Register the exact URI, or fix the port, host or proxy headers. See [references/production.md](references/production.md) |
| After sign-in the browser gets `404` | `callback_path` does not equal the prefix plus `/callback` | Use `prefix="/auth"` with `callback_path="/auth/callback"` |
| `/auth/callback` answers `400` `invalid_state` or `No login in progress` | The session cookie did not come back: the login started on another host name, `https_only=True` over plain HTTP, or `same_site="strict"` | Use one host name, `same_site="lax"`, and `https_only` only on HTTPS |
| `/auth/callback` answers `502` with `invalid_client` | Wrong or missing client secret for a confidential client | Set `LUMO_CLIENT_SECRET` to the secret of the **Web application** |
| Sign-in completes, but the next request is anonymous | The session cookie was not stored, for example because it grew past the browser's size limit | Use a server-side session store. See [references/production.md](references/production.md) |
| `require_auth(scopes=[...])` answers `403` `insufficient_scope` | The token was not granted the scope | Add the scope to `scope=`, allow it on the application, sign in again |
| A permission check answers for the wrong user | `user_id` was not passed | Pass `user_id=user.sub` |
| `require_access_token` answers `401` with `TOKEN_WRONG_AUDIENCE` | `resource` is not in the token's `aud` | Read "Which audience" in [references/bearer-token-apis.md](references/bearer-token-apis.md) |
| `LumoAuthConfigError` that mentions `cryptography` | The `verify` extra is not installed | `pip install "lumoauth[verify]"` |

## Related skills

- `lumoauth-python`: the `LumoAuth` client in full, Flask and Django sign-in, error classes.
- `lumoauth-api-protection`: token validation concepts, introspection and other languages.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`: design the permissions that the routes check.
- `lumoauth-mcp-server`: a FastAPI or FastMCP app that is an MCP server.
- `lumoauth-cli`: `lumo login`, `lumo apps` and `lumo init` in detail.

## References

- [references/router-and-dependencies.md](references/router-and-dependencies.md): every parameter of `lumo_auth_router`, what each route does, the dependencies, the `User` model, error responses and the session content.
- [references/bearer-token-apis.md](references/bearer-token-apis.md): `require_access_token` in full, `AccessTokenClaims`, the audience, DPoP, and an app that accepts both sessions and tokens.
- [references/production.md](references/production.md): session cookie and server-side sessions, reverse proxies, token expiry, sign-out that ends the LumoAuth session, a deployment checklist.
- https://docs.lumoauth.dev/quickstarts/fastapi
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/cli/init
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/user-guide/applications/api-keys
