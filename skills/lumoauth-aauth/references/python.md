# AAuth agent in Python

The Python client does what the TypeScript examples in `SKILL.md` do: get an agent token, request
an auth token, call the resource with a signed request. Register the agent and the resource in the
portal first (step 2 of `SKILL.md`).

```bash
pip install 'lumoauth[aauth]'
```

Python 3.9 or later. The extra installs the `cryptography` package. The client reads
`LUMOAUTH_URL` and `LUMOAUTH_ORG_ID`; the private key comes from your own variable, here
`AGENT_PRIVATE_KEY`. Keep the key on the server.

Generate the key pair once:

```python
import json

from lumoauth import AAuthClient

private_pem, jwks = AAuthClient.generate_keypair()  # Ed25519, kid "key-1"
print(json.dumps(jwks, indent=2))                    # public keys: register these
# Store private_pem in a secrets manager. Do not print or commit it.
```

The agent:

```python
import base64
import json
import os

import requests
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, load_pem_private_key
from lumoauth import AAuthClient

AGENT = "https://my-agent.example.com"
KID = "key-1"
PRIVATE_PEM = os.environ["AGENT_PRIVATE_KEY"]

client = AAuthClient(agent_identifier=AGENT, private_key_pem=PRIVATE_PEM, kid=KID)  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID
ISSUER = f"{client.base_url.rstrip('/')}/orgs/{client.org_id}/api/v1"


def public_jwk() -> dict:
    raw = load_pem_private_key(PRIVATE_PEM.encode(), password=None).public_key().public_bytes(
        Encoding.Raw, PublicFormat.Raw
    )
    return {"kty": "OKP", "crv": "Ed25519", "x": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(), "kid": KID}


def issue_agent_token() -> str:
    url = f"{ISSUER}/aauth/agent/issue"
    body = json.dumps(
        {"delegate_sub": f"{AGENT}/session/main", "delegate_public_key": public_jwk(), "audience": ISSUER}
    ).encode()
    signature_key = f'sig1=jwks_uri;id="{AGENT}";kid="{KID}"'
    headers = client.sign_request("POST", url, body=body, signature_key=signature_key)
    headers["Signature-Key"] = signature_key  # sign_request covers the value but does not add the header
    response = requests.post(url, headers=headers, data=body, timeout=30)
    response.raise_for_status()
    return response.json()["agent_token"]


def get_auth_token(resource_token: str) -> str:
    tokens = client.request_authorization(
        resource_token,
        "",  # scope: ignored by the server, it comes from the resource token
        agent_token=issue_agent_token(),
        redirect_uri="https://my-agent.example.com/oauth/callback",
    )
    if "auth_token" in tokens:
        return tokens["auth_token"]
    if tokens.get("authorization_uri"):
        # A user must approve. Send the browser to this URL, then call
        # client.exchange_code(code, redirect_uri, agent_token=...) with the code from the callback.
        raise RuntimeError(f"User consent needed: {tokens['authorization_uri']}")
    # The client turns a 401 into {"authorization_required": True, "auth_url": ""}.
    raise RuntimeError("LumoAuth refused the request: check the agent token and the signing key")


def read_data(auth_token: str) -> dict:
    response = client.signed_request("GET", "https://api.example.com/v1/data", auth_token=auth_token)
    response.raise_for_status()
    return response.json()
```

The Python client signs with Ed25519 keys only, and it does not sign a query string. Put request
parameters in the path or in the JSON body when you call a resource with it.

## Methods

| Method | What it does |
|---|---|
| `AAuthClient(agent_identifier, private_key_pem, *, base_url=None, org_id=None, kid="key-1")` | Creates the client. The key must be an Ed25519 key in PEM form |
| `AAuthClient.generate_keypair()` | Returns `(private_key_pem, jwks)` |
| `sign_request(method, url, *, body=None, content_type="application/json", agent_token=None, authorization="", signature_key="")` | Returns the signature headers. It does not return a `Signature-Key` header: add it yourself when you pass `signature_key` |
| `request_authorization(resource_token, scope, *, agent_token, redirect_uri=None)` | `request_type=auth`. Returns the server's JSON |
| `exchange_code(code, redirect_uri, *, agent_token)` | `request_type=code`, after user consent |
| `refresh(refresh_token, resource_token, *, scope=None, agent_token)` | `request_type=refresh`. Needs a new resource token each time |
| `signed_request(method, url, *, auth_token, data=None)` | Sends a signed request with the auth token. Returns a `requests.Response` |
| `discover_resource(resource_url)` | Reads `{resource_url}/.well-known/aauth-resource` |

Limits of the Python client:

- Ed25519 keys only.
- No query string in signed URLs: the signer does not cover `@query`, and LumoAuth rejects such a
  request. Put parameters in the path or in the JSON body.
- No `exchange` and no revocation method. Build those requests with `sign_request` and the body
  fields in `token-flows.md`, or use the JS, Go, Java or .NET client.
- No verifier for AAuth auth tokens. `verify_access_token` from `lumoauth` verifies ordinary OAuth
  access tokens (`at+jwt`), not `auth+jwt`. Build the resource in Node.js, Go, Java or .NET (see
  `resource-server.md`), or use the introspection endpoint that file describes.
- When consent is needed, the server answers `200` with `request_token` and `authorization_uri`.
  The client returns that JSON unchanged. It reports a `401` (a refused signature or agent token)
  as `{"authorization_required": True, "auth_url": ""}`. So test for `auth_token` first, then for
  `authorization_uri`, as the example does.

Docs: https://docs.lumoauth.dev/agents/aauth-qs-python
