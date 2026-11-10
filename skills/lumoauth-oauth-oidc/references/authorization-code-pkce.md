# Authorization code flow with PKCE

The complete flow in raw HTTP, with a TypeScript implementation that uses no OIDC library. Use it
when the project cannot take a library, or to debug what a library sends.

## Authorization request

**GET** `{issuer}/oauth/authorize` (the discovery `authorization_endpoint`).

| Parameter | Required | Notes |
|---|---|---|
| `response_type` | Yes | `code`. Nothing else is supported |
| `client_id` | Yes | The application's client ID |
| `redirect_uri` | Yes | Exact match with a registered URI |
| `scope` | Send it | Space-separated, for example `openid profile email`. Every scope must be in the application's allowed scopes, otherwise the request fails with `invalid_scope` |
| `state` | Yes for your own safety | At least 128 bits of randomness, bound to the browser session. Echoed back |
| `code_challenge` | Required for public clients and for applications that require PKCE | `BASE64URL(SHA256(code_verifier))` |
| `code_challenge_method` | With PKCE | `S256`. `plain` is refused |
| `nonce` | For OIDC | Returned in the ID token; compare it |
| `prompt` | No | `login` forces a new sign-in. `none` never shows a page and fails with `login_required`, `consent_required` or `interaction_required`. `consent` asks for consent again. `create` opens the sign-up page when self-registration is on |
| `max_age` | No | Maximum age in seconds of the user's sign-in. An older session signs in again |
| `login_hint` | No | An email address; pre-fills the login page |
| `acr_values` | No | Minimum authentication level, for example `urn:lumoauth:acr:mfa`. Check the `acr` claim afterwards. See `lumoauth-mfa-passkeys` |
| `ui_locales` | No | Preferred languages of the hosted pages, for example `fr de` |
| `id_token_hint` | No | With `prompt=none`: the signed-in user must match its `sub` |
| `response_mode` | No | `query` (default), `fragment`, `form_post`, or a signed mode (`jwt`, `query.jwt`, `fragment.jwt`, `form_post.jwt`) |
| `resource` | No | The API that the access token is for. See `lumoauth-oauth-advanced` |
| `provider` | No | A social provider hint such as `google`; sends the user straight to that provider |

## Authorization response

Success:

```text
https://app.example.com/callback
  ?code=SplxlOBeZQQYbYS6WxSbIA
  &state=STATE
  &iss=https%3A%2F%2Fapp.lumoauth.dev%2Forgs%2Facme-corp%2Fapi%2Fv1
  &session_state=...
```

Error:

```text
https://app.example.com/callback
  ?error=access_denied
  &error_description=...
  &state=STATE
  &iss=https%3A%2F%2Fapp.lumoauth.dev%2Forgs%2Facme-corp%2Fapi%2Fv1
```

Checks, in this order:

1. `iss` equals the discovery `issuer`. If not, stop: do not redeem the code.
2. `state` equals the value in the session. If not, stop.
3. If `error` is present, show a sign-in error and stop.
4. Redeem `code` once, at once. A code for a FAPI 2.0 application expires after 60 seconds, for
   other applications after 10 minutes.

`session_state` is only for session monitoring (see `logout.md` in this folder). Ignore it
otherwise.

| `error` on the redirect | Meaning |
|---|---|
| `access_denied` | The user chose **Deny** |
| `login_required` | `prompt=none` and no session, or `max_age` exceeded |
| `consent_required` | `prompt=none` and the user has not approved these scopes |
| `interaction_required` | `prompt=none` and `acr_values` needs an MFA step |
| `invalid_request` | A parameter is missing or wrong, for example `code_challenge_method` other than `S256` |
| `invalid_scope` | A scope is not allowed for the application |
| `invalid_target` | A `resource` value is malformed or not allowed for the application |
| `unsupported_response_type` | `response_type` is not `code` |

Some errors are shown on a LumoAuth error page and are never redirected, because the redirect URI
cannot be trusted at that point: an unknown or disabled `client_id` and a `redirect_uri` that is
not registered.

## Token request

**POST** `{issuer}/oauth/token`, body `application/x-www-form-urlencoded`.

| Parameter | Required | Notes |
|---|---|---|
| `grant_type` | Yes | `authorization_code` |
| `code` | Yes | From the callback |
| `redirect_uri` | Yes | The same value as in the authorization request |
| `code_verifier` | When PKCE was used | The original verifier |
| `client_id` | Public clients | Confidential clients authenticate with HTTP Basic instead (or send `client_id` and `client_secret` in the body) |

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | `code` or `redirect_uri` missing; two client authentication methods in one request |
| 401 | `invalid_client` | Authentication failed, or the application is unknown or disabled |
| 400 | `invalid_grant` | Code invalid, expired, already used or revoked; `redirect_uri` differs; PKCE verifier mismatch; the user signed out everywhere or reset the password after approving |
| 403 | `unauthorized_client` | The application does not have the `authorization_code` grant type |
| 400 | `invalid_target` | A `resource` value is not within what was granted |
| 429 | `too_many_requests` | Rate limit; back off |

Error bodies are `{"error": "...", "error_description": "..."}`.

## TypeScript implementation

Runs on Node.js 18 or later. The only dependency is `jose`, a standard JOSE library, for ID token
verification:

```bash
npm install jose
```

```ts
// lumoauth-oidc.ts
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET; // undefined for a public client
const REDIRECT_URI = process.env.LUMOAUTH_REDIRECT_URI!; // https://app.example.com/callback

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
}

export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
  id_token?: string;
}

let discoveryCache: Promise<Discovery> | undefined;

export function discover(): Promise<Discovery> {
  discoveryCache ??= (async () => {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`Discovery failed with HTTP ${res.status}`);
    const doc = (await res.json()) as Discovery;
    if (doc.issuer !== ISSUER) throw new Error("Discovery issuer does not match the configured issuer");
    return doc;
  })();
  return discoveryCache;
}

const base64url = (buf: Buffer): string => buf.toString("base64url");

/** Step 1: build the redirect. Store `pending` in the server-side session. */
export async function beginLogin(): Promise<{ url: string; pending: PendingLogin }> {
  const { authorization_endpoint } = await discover();
  const pending: PendingLogin = {
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
    codeVerifier: base64url(randomBytes(32)),
  };
  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: base64url(createHash("sha256").update(pending.codeVerifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), pending };
}

/** Step 2: handle the callback. `params` is the query string of the callback request. */
export async function completeLogin(
  params: URLSearchParams,
  pending: PendingLogin,
): Promise<{ tokens: TokenResponse; claims: JWTPayload }> {
  const doc = await discover();

  if (params.get("iss") !== doc.issuer) throw new Error("Issuer mismatch in the authorization response");
  if (params.get("state") !== pending.state) throw new Error("State mismatch in the authorization response");
  const error = params.get("error");
  if (error) throw new Error(`Authorization failed: ${error}`);
  const code = params.get("code");
  if (!code) throw new Error("The authorization response has no code");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.codeVerifier,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
  } else {
    body.set("client_id", CLIENT_ID);
  }

  const res = await fetch(doc.token_endpoint, { method: "POST", headers, body });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok) throw new Error(`Token request failed: ${json.error ?? res.status}`);
  if (!json.id_token) throw new Error("No ID token: request the openid scope");

  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  const { payload } = await jwtVerify(json.id_token, jwks, {
    issuer: doc.issuer,
    audience: CLIENT_ID,
  });
  if (payload.nonce !== pending.nonce) throw new Error("Nonce mismatch in the ID token");

  return { tokens: json, claims: payload };
}

/** Refresh. Persist the returned refresh_token: the old one stops working. */
export async function refresh(refreshToken: string): Promise<TokenResponse> {
  const { token_endpoint } = await discover();
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
  } else {
    body.set("client_id", CLIENT_ID);
  }
  const res = await fetch(token_endpoint, { method: "POST", headers, body });
  const json = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok) throw new Error(`Refresh failed: ${json.error ?? res.status}`);
  return json;
}

/** Sign-out URL for a browser redirect. */
export async function logoutUrl(idToken: string, postLogoutRedirectUri: string): Promise<string> {
  const { end_session_endpoint } = await discover();
  const url = new URL(end_session_endpoint);
  url.search = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: postLogoutRedirectUri,
  }).toString();
  return url.toString();
}
```

How to use the module:

1. Login route: call `beginLogin()`, store `pending` in the server-side session, redirect to `url`.
2. Callback route: read `pending` from the session and delete it, call `completeLogin()`, then
   create the app session from `claims.sub`. Store tokens on the server, never in `localStorage`.
3. Before the access token expires (`expires_in`), call `refresh()` and store the new tokens.
4. Logout route: clear the session and redirect to `logoutUrl()`.

A percent sign or other reserved character in the client ID or secret must be form-encoded before
it goes into the Basic header. The values that LumoAuth generates need no encoding.

## Token storage

| Where the app runs | Access token | Refresh token |
|---|---|---|
| Server | Server-side session or short cache | Encrypted at rest, server only |
| Single-page app | Memory only | Avoid; prefer a backend-for-frontend that holds it |
| Mobile or desktop | Keychain / Keystore | Keychain / Keystore |

Never store tokens in `localStorage` or in a cookie without `HttpOnly` and `SameSite`.

## Sources

- https://docs.lumoauth.dev/oauth/authorize
- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/oauth/pkce
- https://docs.lumoauth.dev/oauth/security
