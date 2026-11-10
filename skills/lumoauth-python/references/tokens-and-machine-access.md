# Token verification, machine-to-machine tokens and `client.api`

Read this page when a Python API (Flask, Django or any other framework) receives access tokens and must validate them, when a worker or service needs a token for itself, or when a script needs the full REST API of the organization. FastAPI apps use the ready-made dependency in `lumoauth-fastapi` instead.

## Verify an access token in an API

`verify_access_token` checks a LumoAuth access token locally. It fetches the organization's signing keys once and caches them; no request to LumoAuth is made for each call.

```bash
pip install "lumoauth[verify]"
```

```python
# token_auth.py
import os
from functools import wraps

from flask import g, jsonify, request

from lumoauth import DpopRequest, LumoAuthTokenError, verify_access_token

ISSUER = f"{os.environ.get('LUMOAUTH_URL', 'https://app.lumoauth.dev')}/orgs/{os.environ['LUMOAUTH_ORG_ID']}/api/v1"
AUDIENCE = os.environ["API_AUDIENCE"]  # see "Which audience" below


def require_token(*scopes: str):
    """Flask decorator: a valid access token with every listed scope."""

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            scheme, _, token = request.headers.get("Authorization", "").partition(" ")
            if scheme.lower() not in ("bearer", "dpop") or not token.strip():
                response = jsonify(error="invalid_request")
                response.status_code = 401
                response.headers["WWW-Authenticate"] = "Bearer"
                return response
            try:
                claims = verify_access_token(
                    token.strip(),
                    issuer=ISSUER,
                    resource=AUDIENCE,
                    dpop=DpopRequest(
                        method=request.method,
                        url=request.url,
                        proof=request.headers.get("DPoP"),
                        scheme="DPoP" if scheme.lower() == "dpop" else "Bearer",
                    ),
                )
            except LumoAuthTokenError as err:
                response = jsonify(error=err.error, code=err.code)
                response.status_code = 401
                response.headers["WWW-Authenticate"] = err.www_authenticate
                return response
            missing = claims.missing_scopes(scopes)
            if missing:
                response = jsonify(error="insufficient_scope", missing=missing)
                response.status_code = 403
                return response
            g.claims = claims
            return view(*args, **kwargs)

        return wrapper

    return decorator
```

```python
# api.py
from flask import Flask, g, jsonify

from token_auth import require_token

app = Flask(__name__)


@app.get("/api/documents")
@require_token("documents:read")
def list_documents():
    return jsonify(owner=g.claims.sub)
```

In Django, call `verify_access_token` the same way from a decorator or a middleware. Read the headers with `request.headers.get("Authorization")` and `request.headers.get("DPoP")`, and build the URL with `request.build_absolute_uri()`.

### What is verified

- The token is a JWT with the header `typ` `at+jwt`. An ID token is refused.
- The algorithm is RS256/384/512, PS256/384/512 or ES256/384/512. `none` and HMAC are refused.
- The signature, against the keys at the `jwks_uri` of `{issuer}/.well-known/openid-configuration`.
- `iss` equals `issuer`; `aud` contains `resource`; `exp` and `nbf` with 60 seconds of leeway (`clock_skew`); `sub` is present.
- The token is not a test token.
- For a DPoP-bound token: the `DPoP` proof of the request. Pass `require_dpop=True` to refuse unbound tokens.

Not verified: revocation, and whether the user is still active. A token stays valid locally until `exp`. Use introspection for routes that need immediate revocation (`lumoauth-api-protection`).

The result is an `AccessTokenClaims` object: `sub`, `aud`, `exp`, `scopes`, `has_scope()`, `has_scopes()`, `missing_scopes()`, `client_id`, `is_agent`, `agent_id`, `capabilities`, `is_delegated`, `act_chain`, `is_dpop_bound`, and the raw `claims` dict. For a user token, `sub` is the user ID. For an agent token, `sub` is `agent_agt_...` and `is_agent` is true; decide whether the route accepts agents.

A failure raises `LumoAuthTokenError`. Its `code` is stable (`TOKEN_EXPIRED`, `TOKEN_WRONG_AUDIENCE`, `TOKEN_WRONG_ISSUER`, `TOKEN_WRONG_TYPE`, `TOKEN_BAD_SIGNATURE`, `TOKEN_UNKNOWN_KEY`, `TOKEN_KEYS_UNAVAILABLE`, `DPOP_REQUIRED` and others), `error` is the OAuth error for the response, and `www_authenticate` is a ready-made header value.

### Which issuer

`{base URL}/orgs/{org}/api/v1`. An organization that serves sign-in on its own verified custom domain uses that bare domain as the issuer. Read the `issuer` field of `{base URL}/orgs/{org}/api/v1/.well-known/openid-configuration` and use that value.

### Which audience

`resource` must equal one entry of the token's `aud`:

- The client requested a resource at sign-in or at the token endpoint (`resource=https://api.example.com`): `aud` is that URI.
- The client requested no resource: `aud` is the client ID of the OAuth application that obtained the token.

Ask the user which case applies. Do not guess.

### Behind a proxy, and with several workers

The DPoP check compares the proof with the method and URL of the request. Behind a proxy, pass the public URL that the client called instead of `request.url`. The memory of proof IDs that were already used is per process; pass `replay_cache=` (an object with `check_and_add(key, ttl) -> bool`) to share it between workers. Plain bearer tokens need neither.

## Client credentials: a token for the service itself

Use this when a worker or service calls another API of yours and no user is involved.

1. Create the application. Portal: **Applications → New application**, choose **Machine to machine**, click **Create application**. The next page shows the client secret once. Adjust the scopes on the application's **Configuration** tab.
2. Request the token with `client.auth.client_credentials` and cache it until shortly before it expires.

```python
# service_token.py
import os
import threading
import time
from typing import List, Optional

from lumoauth import LumoAuth

_lumo = LumoAuth()  # needs LUMOAUTH_URL and LUMOAUTH_ORG_ID; no API key is used for token calls
_lock = threading.Lock()
_cached = {"token": None, "expires_at": 0.0}


def service_token(scopes: Optional[List[str]] = None) -> str:
    """Access token of this service. Requests a new one 60 seconds before expiry."""
    with _lock:
        if _cached["token"] and _cached["expires_at"] - 60 > time.time():
            return _cached["token"]
        tokens = _lumo.auth.client_credentials(
            os.environ["SERVICE_CLIENT_ID"],
            os.environ["SERVICE_CLIENT_SECRET"],
            scopes=scopes,
        )
        _cached["token"] = tokens["access_token"]
        _cached["expires_at"] = time.time() + tokens.get("expires_in", 3600)
        return _cached["token"]
```

```python
# call_billing.py
import requests

from service_token import service_token


def fetch_invoices() -> list:
    response = requests.get(
        "https://api.example.com/invoices",
        headers={"Authorization": f"Bearer {service_token(['invoices:read'])}"},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()
```

- Without `scopes`, LumoAuth issues the scopes that are registered on the application. Request only what the call needs.
- The cache above holds one token. Keep one entry for each scope set if the service requests several.
- A wrong secret raises `LumoAuthApiError` with the code `invalid_client`.
- The receiving service validates the token with `verify_access_token`, as above. A client-credentials token has no user: `sub` is not a user ID.

For an AI agent that signs in with its own client ID and secret, use `LumoAuthAgent` (`lumoauth-agent-identity`). It renews the token itself.

## `client.api`: the generated client for the full REST API

The namespaces of `LumoAuth` cover authorization checks and OAuth. Every other operation (users, roles, groups, OAuth clients, webhooks, audit logs and more) is in the generated OpenAPI client `lumoauth_api_client`. `client.api` returns its `ApiClient`, configured with the same base URL and credential.

```bash
pip install "lumoauth[api]"
```

The extra installs the `lumoauth-api-client` package. If the package index does not have it, install it from the `python/` directory of the `LumoAuth/api-clients` repository on GitHub. Without the package, `client.api` raises `LumoAuthConfigError`.

```python
# list_users.py
import lumoauth_api_client

from lumoauth import LumoAuth

lumo = LumoAuth()  # LUMOAUTH_API_KEY: an lmk_... key with the admin:users:read scope

users_api = lumoauth_api_client.AdminUsersApi(lumo.api)
result = users_api.list_users(org_id=lumo.org_id)
print(result)
```

- With an API key, the generated client sends it as `X-API-Key`. With a `token_provider`, it asks for the token before each request and sends it as a bearer token.
- Each generated method takes the organization slug as `org_id`.
- The generated client raises its own exception classes (`lumoauth_api_client.ApiException`), not the `LumoAuth*Error` classes.
- The API key needs the scope of the resource: `admin:<resource>:read` for reads, `admin:<resource>:write` for writes. A missing scope gives `403` with `details.required_scopes`.

Show the user every call that creates, changes or deletes something in the organization before you run it. For the endpoints, pagination and scopes use `lumoauth-admin-api`.
