# Admin API access and machine-to-machine credentials

Read this page when a Node.js service, worker or script acts without a signed-in user: it manages users or other resources in the organization, or it calls another service of yours.

## Which credential

| Job | Credential | How |
|---|---|---|
| Call the LumoAuth Admin API (`/orgs/{orgId}/api/v1/admin/...`) | Organization API key (`lmk_...`) with the narrowest `admin:<resource>:<read\|write>` scopes | `lumo.api`, below |
| Check a permission or a relation about a user | Organization API key with the `authz:check` scope | `lumo.permissions.check(slug, undefined, { userId })`, see `SKILL.md` |
| Call your own API or service as a service | Access token from the client-credentials grant | Below |

An API key belongs to the organization and to the admin who created it. LumoAuth checks on every request that this admin is still active and still holds the permission that the endpoint needs. A key never opens the portal and never creates a session.

## Create an organization API key

Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`).

1. Click **Create API key**. The portal may ask you to confirm your sign-in first.
2. Enter a **Name** that says which service uses the key. Choose an **Expiration**.
3. Under **Permissions**, tick only the scopes that the service needs. A read (`GET`) needs `admin:<resource>:read` or `admin:<resource>:write`. A write needs `admin:<resource>:write`. Permission checks about other users need `authz:check`.
4. Click **Create API key** and copy the key. It starts with `lmk_` and is shown once.

Store the key in the server's environment or secrets manager as `LUMOAUTH_API_KEY`. If the key is lost or exposed, use **Rotate** on the same page: the old key stops working at once.

The SDK sends an `lmk_` key in the `X-API-Key` header. LumoAuth does not accept an API key as `Authorization: Bearer`.

## `lumo.api`: the generated client

`LumoAuthBackend` wraps the authorization calls. Every other REST operation (users, roles, groups, OAuth clients, webhooks, audit logs and more) is in the generated OpenAPI client `@lumoauth/api-client`. `lumo.api` loads that package on first use and configures it with the base URL and the credential of the backend client.

```bash
npm install @lumoauth/backend @lumoauth/api-client
```

`@lumoauth/api-client` is an optional peer dependency of `@lumoauth/backend`. If the registry does not have the package, install it from the `typescript/` directory of the `LumoAuth/api-clients` repository on GitHub. Without the package, `lumo.api` throws `LumoAuthConfigError`.

```ts
// scripts/list-users.ts
import { LumoAuthBackend } from '@lumoauth/backend';
import { AdminUsersApi } from '@lumoauth/api-client';

const orgId = process.env.LUMOAUTH_ORG_ID;
const apiKey = process.env.LUMOAUTH_API_KEY; // lmk_..., with admin:users:read
if (!orgId || !apiKey) throw new Error('LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY must be set');

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev',
  orgId,
  secretKey: apiKey,
});

async function main(organization: string): Promise<void> {
  const users = lumo.api.create(AdminUsersApi);
  const response = await users.listUsers({ orgId: organization });
  console.log(response.data);
}

main(orgId).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

- `lumo.api.create(ApiClass)` returns an instance of a generated API class with the right base URL and credential.
- `lumo.api.module` is the whole `@lumoauth/api-client` module, and `lumo.api.configuration` is its `Configuration` object.
- Each generated method takes one request object that includes `orgId`, and returns an Axios response; the body is in `.data`.
- The generated client throws Axios errors, not the `LumoAuth*Error` classes. Read `error.response?.status` and `error.response?.data`. A missing scope gives `403` with `details.required_scopes` and `details.granted_scopes`.
- An `lmk_` credential is sent as `X-API-Key`. Any other `secretKey` is sent as `Authorization: Bearer`.

Show the user every call that creates, changes or deletes something in the organization before you run it. For the endpoints, pagination and scopes use `lumoauth-admin-api`.

## Client-credentials tokens for service-to-service calls

Use this when one of your services calls another one and no user is involved. The calling service gets an access token for itself; the receiving service validates it.

1. Create the application. Portal: **Applications → New application**, choose **Machine to machine**, click **Create application**. The next page shows the client secret once. The preset gives the application the `client_credentials` grant type. Adjust its scopes on the **Configuration** tab.
2. Request a token and cache it until shortly before it expires. `@lumoauth/backend` has no helper for this grant, so call the token endpoint with `fetch`:

```ts
// src/service-token.ts
const baseUrl = process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev';
const orgId = process.env.LUMOAUTH_ORG_ID;
const clientId = process.env.SERVICE_CLIENT_ID;
const clientSecret = process.env.SERVICE_CLIENT_SECRET;
if (!orgId || !clientId || !clientSecret) {
  throw new Error('LUMOAUTH_ORG_ID, SERVICE_CLIENT_ID and SERVICE_CLIENT_SECRET must be set');
}

let cached: { token: string; expiresAt: number } | null = null;

/** Access token for this service. Requests a new one 60 seconds before the old one expires. */
export async function serviceToken(scope?: string): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId!,
    client_secret: clientSecret!,
  });
  if (scope) body.set('scope', scope);

  const res = await fetch(`${baseUrl}/orgs/${orgId}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Do not log the request body: it holds the client secret.
    throw new Error(`Token request failed with HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}
```

```ts
// src/call-billing.ts
import { serviceToken } from './service-token';

export async function fetchInvoices(): Promise<unknown> {
  const res = await fetch('https://api.example.com/invoices', {
    headers: { Authorization: `Bearer ${await serviceToken()}` },
  });
  if (!res.ok) throw new Error(`Billing API answered HTTP ${res.status}`);
  return res.json();
}
```

The cache above assumes one scope set for the process. Keep one cache entry for each scope set if the service requests several.

3. On the receiving service, validate the token locally: signature, issuer, audience, expiry and scopes. A client-credentials token has no user, so the UserInfo check from `SKILL.md` rejects it. Use `lumoauth-api-protection`, or the verifier in [token-validation.md](token-validation.md).

Without a `scope` parameter, LumoAuth issues the scopes that are registered on the application. Request only the scopes that the call needs.

## Rules

- One credential for each service. Name it after the service, so that it can be revoked alone.
- Least privilege: a reporting job holds only `:read` scopes.
- Secrets come from the environment or a secrets manager. Never commit them, never log them, never send them to a browser.
- Set an expiration on API keys and rotate them on a schedule.
