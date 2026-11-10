# Pushed authorization requests, request objects and signed responses

Three ways to protect the authorization request and response of the authorization code flow:

- **PAR**: the client sends the request to LumoAuth from its server and redirects the browser
  with a reference.
- **Request objects (JAR)**: the client sends the parameters as a signed JWT.
- **Signed responses (JARM)**: LumoAuth returns the authorization response as a signed JWT.

## PAR

**POST** `{issuer}/oauth/par` (the discovery `pushed_authorization_request_endpoint`), body
`application/x-www-form-urlencoded`. The request must authenticate the client with the
application's own method: client secret (HTTP Basic or body), `private_key_jwt` or client
attestation.

### Request

| Parameter | Required | Notes |
|---|---|---|
| `response_type` | Yes | `code` |
| `redirect_uri` | Yes | Must equal a registered redirect URI |
| `scope` | Send it | Space-separated |
| `state` | Recommended | Returned on the callback |
| `nonce` | For OIDC | Returned in the ID token |
| `code_challenge`, `code_challenge_method` | With PKCE; required for FAPI 2.0 applications | `S256` |
| `prompt` | No | As on the authorization endpoint |
| `response_mode` | No | `query`, `fragment`, `form_post` or a signed mode |
| `resource` | No | May be repeated. Validated now and stored with the request |
| `request` | No | A signed request object; its claims take precedence over the form fields |

These are the parameters that a pushed request stores. `request_uri` is not allowed in a PAR body
and answers `invalid_request`.

A `DPoP` proof header on the PAR request binds the authorization code to that key: the token
request must then carry a proof signed with the same key.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/par \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "response_type=code" \
  -d "redirect_uri=https://app.example.com/callback" \
  -d "scope=openid profile email" \
  -d "state=$STATE" \
  -d "nonce=$NONCE" \
  -d "code_challenge=$CODE_CHALLENGE" \
  -d "code_challenge_method=S256" \
  -d "resource=https://api.example.com"
```

### Response

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "request_uri": "urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY22c",
  "expires_in": 600
}
```

The `request_uri` works once and until `expires_in` seconds have passed.

### Use the `request_uri`

```text
https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize
  ?client_id=CLIENT_ID
  &request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A6esc_11ACC5bwc014ltc14eY22c
```

Send only `client_id` and `request_uri`. The callback, the checks on it (`iss`, `state`) and the
code exchange are the same as without PAR. The token request still sends `redirect_uri` and
`code_verifier`.

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | `response_type` is not `code`; `redirect_uri` missing or not registered; `request_uri` in the body; for a FAPI 2.0 application, `code_challenge` missing or the method is not `S256` |
| 400 | `invalid_target` | A `resource` value is malformed or not allowed for the application |
| 400 | `invalid_request_object`, `request_not_supported` | The request object failed verification, or it is encrypted |
| 400 | `invalid_dpop_proof`, `use_dpop_nonce` | The DPoP proof on the PAR request was refused |
| 401 | `invalid_client` | Client authentication failed, or the application is disabled |
| 429 | `too_many_requests` | Rate limit |

At the authorization endpoint, a `request_uri` that is unknown, expired or already used answers
with the error `invalid_request` and the text "The authorization request has expired". A
`request_uri` that the PAR endpoint did not issue answers `request_uri_not_supported`.

### TypeScript

```ts
// par.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!;
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET!;

export interface PushedRequest {
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  resource?: string;
}

/** Pushes the request and returns the URL to redirect the browser to. */
export async function pushAuthorizationRequest(request: PushedRequest): Promise<string> {
  const body = new URLSearchParams({
    response_type: "code",
    redirect_uri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  });
  if (request.resource) body.set("resource", request.resource);

  const res = await fetch(`${ISSUER}/oauth/par`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body,
  });
  const json = (await res.json()) as { request_uri?: string; error?: string };
  if (res.status !== 201 || !json.request_uri) {
    throw new Error(`PAR failed: ${json.error ?? res.status}`);
  }

  const url = new URL(`${ISSUER}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: CLIENT_ID, request_uri: json.request_uri }).toString();
  return url.toString();
}
```

On a custom domain take both endpoint URLs from the discovery document.

### Require PAR for an application

Portal: **Applications → your app → Security → FAPI 2.0 and client authentication → Require
PAR**, then **Save FAPI settings**. From then on, an authorization request for this application
without a `request_uri` is refused with `invalid_request`.

Many OIDC libraries support PAR with one switch once discovery lists
`pushed_authorization_request_endpoint`. Prefer the library's switch to hand-written code.

## Signed request objects (JAR)

The client sends the authorization parameters as a signed JWT in the `request` parameter, at the
authorization endpoint or inside a PAR body. `client_id` is always sent as a plain parameter too,
because it selects the key.

Requirements:

| Rule | Detail |
|---|---|
| Keys | The application's registered JWKS or JWKS URI (**Security → FAPI 2.0 and client authentication**) |
| Algorithms | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512`. `none` and `HS*` are refused |
| `iss` | The client ID |
| `aud` | Contains the discovery `issuer` |
| `exp`, `nbf` | Enforced when present. The object may be at most 60 minutes old |
| FAPI 2.0 applications | `exp` and `nbf` are required; `nbf` at most 60 minutes old; `exp` at most 60 minutes after `nbf` |
| `client_id`, `response_type` inside the object | Must equal the outer parameters |
| Nesting | No `request` or `request_uri` inside the object |
| Encryption | Not supported: `request_not_supported` |

A request object that fails is answered with `invalid_request_object` on a LumoAuth error page.
The browser is not redirected.

Request objects are never fetched from a URL of the client. The only accepted `request_uri` is
the one that the PAR endpoint returns.

## Signed responses (JARM)

Send `response_mode=jwt` (or `query.jwt`, `fragment.jwt`, `form_post.jwt`) on the authorization
request or in the PAR body. The callback then carries a single parameter, `response`, which is a
JWT signed with the organization's signing key:

| Claim | Value |
|---|---|
| `iss` | The discovery `issuer` |
| `aud` | The client ID |
| `iat`, `exp` | Issue time and expiry |
| `code`, `state` | On success |
| `error`, `error_description`, `state` | On error |

Verify the JWT against `jwks_uri`, check `iss`, `aud` and `exp`, and only then read `code`.
`jwt` alone means `query.jwt` for the code flow.

## Sources

- https://docs.lumoauth.dev/oauth/par
- https://docs.lumoauth.dev/oauth/authorize
- https://docs.lumoauth.dev/oauth/fapi
