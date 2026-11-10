# Machine-to-machine access

A service calls an API without a user. It authenticates as itself with the OAuth client
credentials grant and presents the access token to the API. This file also compares access tokens
with organization API keys.

## Set up the calling service

1. Portal: **Applications → New application**, protocol **OpenID Connect**, **Machine to
   machine**, then **Create application**. The application is confidential and has the
   `client_credentials` grant type. Its default scopes are `api:read api:write`.
2. Copy the **Client ID** and the **Client secret**. The secret is shown once and stored hashed;
   **Regenerate** on the **Credentials** tab makes a new one and ends the old one at once.
3. On the **Configuration** tab set **Allowed scopes** to the scopes that this service needs, and
   add the API identifier under **Resource indicators**.
4. Store the client ID and secret in the service's secret store. Read them from environment
   variables.

Use one application per calling service. Then each service has its own secret, its own scopes and
its own entry in the audit log, and one service can be disabled without touching the others.

The same application can be created with the Admin API:

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/clients \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Billing worker",
    "grantTypes": ["client_credentials"],
    "scopes": ["read:reports"],
    "isConfidential": true
  }'
```

Show this command to the user before you run it. The key needs the `admin:clients:write` scope.
The response contains `clientId` and, once, `secret`.

## Token request

**POST** `{issuer}/oauth/token`, body `application/x-www-form-urlencoded`.

| Parameter | Required | Notes |
|---|---|---|
| `grant_type` | Yes | `client_credentials` |
| `scope` | No | Space-separated. Each scope must be allowed for the application. Without it, the token gets all of the application's allowed scopes |
| `resource` | Recommended | The API identifier. Becomes the token's `aud`. Without it, `aud` is the client ID |

Client authentication: HTTP Basic with the client ID and secret, or `client_id` and
`client_secret` in the body. Use one method, not both.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=read:reports" \
  -d "resource=https://api.example.com"
```

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:reports"
}
```

`expires_in` is the application's access token lifetime (**Security → Token settings →
Lifetimes**). There is no refresh token: request a new token when the old one is about to expire.

| HTTP | `error` | Cause |
|---|---|---|
| 401 | `invalid_client` | Wrong client ID or secret, or the application is disabled |
| 403 | `unauthorized_client` | The application is public, or it does not have the `client_credentials` grant type |
| 400 | `invalid_scope` | A requested scope is not allowed for the application |
| 400 | `invalid_target` | `resource` is not an absolute URI, has a fragment, or is not in the application's resource indicators |
| 400 | `invalid_request` | Two client authentication methods in one request, or no `client_id` |
| 429 | `too_many_requests` | Rate limit; back off |

## A caching client in TypeScript

Request a token once and reuse it until shortly before it expires. Do not request a token per
call.

```ts
// service-token.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET!;

interface CachedToken {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const pending = new Map<string, Promise<string>>();

async function requestToken(resource: string, scope: string): Promise<CachedToken> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope, resource }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token || !json.expires_in) {
    throw new Error(`Token request failed: ${json.error ?? res.status}`);
  }
  return { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

/** Access token for one API and scope set. Refreshed 60 seconds before it expires. */
export async function getServiceToken(resource: string, scope: string): Promise<string> {
  const key = `${resource} ${scope}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;

  let inFlight = pending.get(key);
  if (!inFlight) {
    inFlight = requestToken(resource, scope)
      .then((token) => {
        cache.set(key, token);
        return token.value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, inFlight);
  }
  return inFlight;
}

/** Example call. */
export async function fetchReports(): Promise<unknown> {
  const token = await getServiceToken("https://api.example.com", "read:reports");
  const res = await fetch("https://api.example.com/reports", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API call failed with HTTP ${res.status}`);
  return res.json();
}
```

If the API answers `401`, drop the cached token and request a new one once. Never write the
token or the secret to a log.

## What the API sees

A machine token has `sub` = `client_<client_id>`, `client_id` and `azp` = the client ID,
`gty` = `client_credentials`, the granted `scope`, and `aud` = the requested resource. The API
validates it exactly like a user token. To restrict a route to machines, or to some machines,
check `gty` and `client_id` in addition to the scope.

## Organization API keys versus OAuth access tokens

| | Organization API key | OAuth access token |
|---|---|---|
| Looks like | Starts with `lmk_` | A JWT (`eyJ...`) or an opaque string |
| Sent as | `Authorization: ApiKey lmk_...` or `X-API-Key: lmk_...`. Never as `Bearer` | `Authorization: Bearer <token>` |
| Issued by | An administrator, under **API keys** in the portal (`/orgs/{orgId}/portal/settings/api-keys`); shown once | The token endpoint, on every grant |
| Lifetime | Until its expiration date, rotation or revocation | Short; see `expires_in` |
| Scopes | Admin API scopes such as `admin:users:read`, `admin:clients:write`, plus `admin:clients:register` and `authz:check` | The scopes that the application requested and was granted |
| Accepted by | LumoAuth's own APIs only: the Admin API (`/orgs/{orgId}/api/v1/admin/...`), dynamic client registration and the authorization decision endpoints | Your APIs, and LumoAuth's APIs according to the token's scopes |
| Acts as | The organization integration; limited by the permissions of the admin who created the key | The user, the client application or the agent in `sub` |
| Verified by | LumoAuth | Any API, offline, with the public keys |

Rules that follow:

- Your API authenticates its callers with OAuth access tokens. An `lmk_` key is not a credential
  for your API, and your API cannot verify one.
- Your backend uses an `lmk_` key when it calls LumoAuth to manage the organization (users,
  roles, applications) or to ask for authorization decisions. See `lumoauth-admin-api` and
  `lumoauth-authorization`.
- A request to LumoAuth carries one credential. An API key together with an access token is
  refused with `400 invalid_request`.
- Neither credential belongs in browser or mobile code.
- Agent API keys (`agk_...`) are a third kind: they authenticate a registered AI agent on
  LumoAuth's agent routes. See `lumoauth-agent-identity`.

## Sources

- https://docs.lumoauth.dev/tracks/backend
- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/api-reference/authentication
- https://docs.lumoauth.dev/user-guide/security/credential-model
