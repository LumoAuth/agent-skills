# Token introspection for an API

Introspection asks LumoAuth whether a token is active right now. Use it for opaque access tokens
and for operations that must respect revocation at once. For everything else, validate JWTs
offline.

## Who may introspect a token

LumoAuth answers `{"active": false}` unless one of these holds:

- the caller is the application that the token was issued to (the token's `client_id`), or
- the caller's client ID is in the token's `aud`.

A token that was requested with `resource=https://api.example.com` has that URI as `aud`, not a
client ID. So in practice the API introspects with the credentials of the application that
obtains the tokens. This fits a backend that is both the OAuth client and the API (a web app with
its own API, a backend-for-frontend). An API that receives tokens from applications that it does
not share credentials with validates JWTs offline instead.

The caller must be a confidential application of the same organization and must be active.
Authentication is HTTP Basic or `client_id` and `client_secret` in the form body. Never call the
endpoint from a browser or mobile app.

## Request

**POST** `{issuer}/oauth/introspect` (the discovery `introspection_endpoint`), body
`application/x-www-form-urlencoded`.

| Parameter | Required | Notes |
|---|---|---|
| `token` | Yes | The access token or refresh token |
| `token_type_hint` | No | `access_token` or `refresh_token` |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/introspect \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "token=$ACCESS_TOKEN" \
  -d "token_type_hint=access_token"
```

## Response

Active access token:

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

| Field | Notes |
|---|---|
| `active` | Always present. The only field in an inactive response |
| `token_type` | `Bearer`; `DPoP` for a key-bound token; `refresh_token` for a refresh token |
| `scope` | Space-separated granted scopes |
| `client_id` | The application that the token was issued to |
| `sub` | The user's ID, `client_<client_id>` or `agent_<agent_id>` |
| `exp`, `iat`, `nbf` | Times, when the token has them |
| `iss` | The issuer, equal to the discovery `issuer` |
| `aud` | A string, or an array for several resources. The client ID when no `resource` was requested |
| `jti` | The token ID of a JWT access token |
| `cnf` | `{"jkt": "..."}` for a DPoP-bound token. The API must then verify a DPoP proof with that key |
| `username` | The user's email address. Only for opaque tokens that were granted the `email` scope. Do not depend on it |

Inactive, for every reason (unknown, expired, revoked, wrong caller, another organization):

```json
{ "active": false }
```

A token is inactive before `exp` when the user was blocked, deactivated or deleted, signed out
everywhere, or had the password changed or reset after the token was issued; when the refresh
token of its sign-in was revoked; when an admin revoked the application's tokens or disabled the
application; and, for an agent's token, when the agent is not active.

## After the call

`active: true` is not enough. The API still checks, on the response:

1. `iss` equals the discovery `issuer`.
2. `aud` contains the API identifier (or `client_id` is an application that may call the API).
3. `scope` contains the scope that the route needs.
4. `token_type` is not `DPoP`, unless the API verifies the DPoP proof.

## TypeScript

```ts
// introspect.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!;
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET!;
const AUDIENCE = process.env.API_AUDIENCE!;

export interface Introspection {
  active: boolean;
  token_type?: string;
  scope?: string;
  client_id?: string;
  sub?: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

/** Returns the introspection result when the token is active and meant for this API, else null. */
export async function introspect(token: string, requiredScope: string): Promise<Introspection | null> {
  const res = await fetch(`${ISSUER}/oauth/introspect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
  });
  if (!res.ok) throw new Error(`Introspection failed with HTTP ${res.status}`);

  const result = (await res.json()) as Introspection;
  if (!result.active) return null;
  if (result.iss !== ISSUER) return null;
  if (result.token_type !== "Bearer") return null;
  const audiences = Array.isArray(result.aud) ? result.aud : [result.aud];
  if (!audiences.includes(AUDIENCE)) return null;
  if (!(result.scope ?? "").split(" ").includes(requiredScope)) return null;
  return result;
}
```

Treat a failed introspection call (network error, `5xx`, `429`) as "not authorized". Do not fall
back to accepting the token.

## Caching and limits

- The endpoint is rate limited and answers `429` with `too_many_requests`. Do not introspect on
  every request of a busy API.
- For JWTs: validate offline on every request and introspect only on sensitive operations.
- If you cache a result, cache it for seconds, never beyond the token's `exp`. A long cache
  removes the reason to introspect.

## Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | No `token` parameter |
| 401 | `invalid_client` | Wrong or missing client credentials, a public client, a disabled application, or an application of another organization |
| 429 | `too_many_requests` | Rate limit |

## Revocation

To end a token before it expires, the application that holds it calls the revocation endpoint
(`{issuer}/oauth/revoke`). Revoking a refresh token ends every access token of that sign-in.
Introspection then reports them inactive. Offline validation does not notice. For the parameters
see `lumoauth-oauth-advanced`.

## Sources

- https://docs.lumoauth.dev/oauth/introspect
- https://docs.lumoauth.dev/oauth/token-management
