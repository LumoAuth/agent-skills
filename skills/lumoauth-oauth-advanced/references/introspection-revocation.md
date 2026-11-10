# Token introspection and revocation

Two back-channel endpoints of the authorization server:

- **Introspection** tells an authenticated client whether a token is active and what it allows.
- **Revocation** ends an access token or a refresh token before it expires.

For when an API should introspect and when it should validate offline, see
`lumoauth-api-protection`. This file has the exact requests and responses.

## Client authentication for both endpoints

| Method | Introspection | Revocation |
|---|---|---|
| HTTP Basic (`client_secret_basic`) | Yes | Yes |
| `client_id` and `client_secret` in the form body (`client_secret_post`) | Yes | Yes |
| `client_id` alone (public client) | No | Yes, for the client's own tokens |

Discovery lists these as `introspection_endpoint_auth_methods_supported` and
`revocation_endpoint_auth_methods_supported`. Call both endpoints from a server, except for the
revocation call of a public client that ends its own tokens.

## Introspection

**POST** `{issuer}/oauth/introspect` (the discovery `introspection_endpoint`), body
`application/x-www-form-urlencoded`.

| Parameter | Required | Notes |
|---|---|---|
| `token` | Yes | An access token (JWT or opaque) or a refresh token |
| `token_type_hint` | No | `access_token` or `refresh_token` |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/introspect \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "token=$ACCESS_TOKEN" \
  -d "token_type_hint=access_token"
```

Active token:

```json
{
  "active": true,
  "token_type": "Bearer",
  "scope": "openid email read:reports",
  "client_id": "<client_id>",
  "sub": "4821",
  "exp": 1767229200,
  "iat": 1767225600,
  "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "aud": "https://api.example.com",
  "jti": "9f2c4e5a7b8d4c1e9a3f6b2d8c7e5f41"
}
```

Anything else:

```json
{ "active": false }
```

| Field | Notes |
|---|---|
| `active` | Always present |
| `token_type` | `Bearer`, `DPoP` (key-bound access token) or `refresh_token` |
| `scope` | Space-separated |
| `client_id` | The application that the token was issued to |
| `sub` | User ID, `client_<client_id>` or `agent_<agent_id>` |
| `exp`, `iat`, `nbf` | When the token has them |
| `iss` | Equal to the discovery `issuer` |
| `aud` | String or array; the client ID when no `resource` was requested |
| `jti` | For JWT access tokens |
| `cnf` | `{"jkt": "..."}` for a DPoP-bound token |
| `username` | The user's email; only for opaque tokens with the `email` scope |

Rules:

- **Who gets an answer.** `active: true` goes only to the application that the token was issued
  to, or to a client whose ID is in the token's `aud`. Every other caller gets `active: false`.
- **One answer for every failure.** Unknown, expired, revoked, wrong caller, another
  organization: all `{"active": false}`.
- **Revocation is visible here.** A token is inactive when it was revoked, when its refresh token
  was revoked, when the user was blocked, deactivated or deleted, signed out everywhere or had
  the password changed or reset, and when the application was disabled or had its tokens revoked
  by an admin.
- **Only access tokens count as access tokens.** A JWT must have `typ: at+jwt`. An ID token or a
  logout token is reported as inactive.

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | No `token` |
| 401 | `invalid_client` | Missing or wrong credentials, a disabled application, or an application of another organization |
| 429 | `too_many_requests` | Rate limit |

## Revocation

**POST** `{issuer}/oauth/revoke` (the discovery `revocation_endpoint`), body
`application/x-www-form-urlencoded`. Authenticate as the application that the token was issued
to.

| Parameter | Required | Notes |
|---|---|---|
| `token` | Yes | The access token or refresh token to end |
| `token_type_hint` | No | `access_token` or `refresh_token` |

```bash
# Confidential client
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/revoke \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "token=$REFRESH_TOKEN" \
  -d "token_type_hint=refresh_token"

# Public client
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/revoke \
  -d "client_id=$LUMOAUTH_CLIENT_ID" \
  -d "token=$REFRESH_TOKEN" \
  -d "token_type_hint=refresh_token"
```

The answer is `200` with an empty JSON body, whether or not the token existed or belonged to the
caller. Check the status; do not parse the body.

| What you revoke | Effect |
|---|---|
| A refresh token | The refresh token and every access token of the same sign-in end, JWT and opaque alike |
| An opaque access token | That token ends |
| A JWT access token | Its `jti` is put on a deny-list. Introspection, UserInfo and LumoAuth's own APIs refuse it. An API that validates JWTs offline keeps accepting it until `exp` |

A client can revoke only its own tokens. A token of another application is left alone, and the
answer is still `200`.

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | No `token` |
| 400 | `unsupported_token_type` | A `token_type_hint` other than `access_token` or `refresh_token`, when no token was found |
| 401 | `invalid_client` | Client authentication failed, or the application is disabled |
| 429 | `too_many_requests` | Rate limit |

### At sign-out

1. Revoke the refresh token (this ends the access tokens of the sign-in too).
2. Delete the app's session and stored tokens.
3. Redirect the browser to the `end_session_endpoint` to end the LumoAuth session (see
   `lumoauth-oauth-oidc`).

Revocation ends tokens. It does not end the user's LumoAuth browser session; step 3 does that.

### TypeScript

```ts
// revoke.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET; // undefined for a public client

export async function revokeToken(token: string, hint: "access_token" | "refresh_token"): Promise<void> {
  const body = new URLSearchParams({ token, token_type_hint: hint });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
  } else {
    body.set("client_id", CLIENT_ID);
  }
  const res = await fetch(`${ISSUER}/oauth/revoke`, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`Revocation failed with HTTP ${res.status}`);
}
```

## Other ways in which tokens end early

These are done by administrators or users, not by the client:

| Action | Effect |
|---|---|
| The user removes the app under **Authorized apps** in the account pages | That user's tokens for the application end |
| An admin revokes all tokens of an application (`POST /admin/clients/{clientId}/tokens/revoke`) | Every user's tokens for it end |
| An admin disables the application | Its tokens end, and it gets `invalid_client` on every OAuth endpoint |
| The user signs out everywhere, or the password is changed or reset | All of the user's tokens from before that moment end |

For the Admin API calls use `lumoauth-admin-api`; for sessions use `lumoauth-users-sessions`.

## Sources

- https://docs.lumoauth.dev/oauth/introspect
- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/oauth/token-management
