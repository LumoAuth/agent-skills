# Creating OAuth applications

Three ways to create an OAuth client: the portal, the Admin API, and dynamic client registration.
Show the user any command from this file before you run it: each one creates or changes an
application in the organization.

## Client types

| Client type | Has a secret | Typical app | Token endpoint authentication | PKCE |
|---|---|---|---|---|
| Confidential | Yes | Web app with a backend, backend-for-frontend, service | `client_secret_basic` or `client_secret_post` (or `private_key_jwt`) | Recommended. Required when **Require PKCE** is on for the application (**Configuration → Client options**); the Admin API turns it on by default |
| Public | No | Single-page app, mobile app, desktop app, CLI | `none`: `client_id` alone | Required |

- A public client that sends a client secret gets `invalid_client`. Send `client_id` alone.
- The client secret is shown once, at creation or rotation. It is stored hashed and cannot be read
  again. Regenerating it makes the old secret stop working at once.
- The `client_credentials` grant needs a confidential client.
- An application whose **Application type** is **Native** is meant for installed apps: loopback
  `http` redirects and private-use schemes.

## Portal

1. Open **Applications → New application** (`/orgs/{orgId}/portal/applications`).
2. Keep **OpenID Connect**. Enter the **Application name**.
3. Under **What the application is**, choose:
   - **Web application**: confidential, grant types `authorization_code` and `refresh_token`,
     scopes `openid profile email`.
   - **Single-page or mobile app**: public (no secret), the same grant types and scopes.
   - **Machine to machine**: confidential, grant type `client_credentials`, default scopes
     `api:read api:write`.
4. Enter the **Redirect URI** (not asked for machine to machine) and click **Create application**.
5. Copy the **Client ID** and, for a confidential client, the **Client secret**. The secret is
   shown only on this page.
6. Click **Open application** to finish on the tabs:

| Tab | Settings |
|---|---|
| **Credentials** | Client ID, **Regenerate** for the secret, the organization's OAuth endpoints |
| **Configuration** | Grant types, redirect URIs, allowed scopes, resource indicators, browser CORS origins, application metadata (application type), logout URIs |
| **Security** | Access token format and lifetimes, JWT claims, refresh token rotation, MFA requirement, FAPI 2.0 and client authentication |
| **Branding** | Login page and consent page of this application |
| **Developer** | Test tokens and integration code |

Save each section with its own button (for example **Save configuration**).

## Redirect URI rules

| URI | Accepted |
|---|---|
| `https://app.example.com/callback` | Yes |
| `http://localhost:3000/callback`, `http://127.0.0.1:8400/callback`, `http://[::1]/cb` | Yes: loopback hosts only |
| `com.example.app:/callback` | Yes: private-use scheme for native apps |
| `http://app.example.com/callback` | No: `http` on a non-loopback host |
| `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`, `about:` | Never |

Matching at the authorization endpoint is an exact string comparison. Register every variant that
the app uses, including the port. If the application has exactly one registered redirect URI, the
authorization request may omit `redirect_uri`; send it anyway, because the token request needs it.

Post-logout redirect URIs follow the same rules.

## Admin API

Authenticate with an organization API key that holds `admin:clients:write` (reading needs
`admin:clients:read`). The key's creator must hold the `clients.create` permission. For API keys
and the rest of the Admin API use `lumoauth-admin-api`.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/clients \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example web app",
    "redirectUris": ["https://app.example.com/callback", "http://localhost:3000/callback"],
    "scopes": ["openid", "profile", "email"],
    "grantTypes": ["authorization_code", "refresh_token"],
    "isConfidential": true,
    "requiresPkce": true
  }'
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | required | Display name |
| `redirectUris` | array | `[]` | Allowed redirect URIs |
| `scopes` | array | `["openid", "profile", "email"]` | Scopes that the client may request |
| `grantTypes` | array | `["authorization_code", "refresh_token"]` | Allowed grant types |
| `isConfidential` | boolean | `true` | `false` creates a public client |
| `requiresPkce` | boolean | `true` | Require PKCE on the authorization code flow |

The `201` response returns the client under `data`, with `clientId` and `secret`. `secret` is
returned only here. Store it in the project's secret store, never in the repository.

Other operations on the same resource:

| Operation | Request |
|---|---|
| List | `GET /admin/clients?page=1&limit=25&search=...` |
| Read | `GET /admin/clients/{clientId}` |
| Update | `PUT` (replace) or `PATCH` (partial) `/admin/clients/{clientId}` |
| Rotate the secret | `POST /admin/clients/{clientId}/rotate-secret` |
| Disable / enable | `POST /admin/clients/{clientId}/disable`, `POST /admin/clients/{clientId}/enable` |
| Read / replace allowed scopes | `GET` / `PUT /admin/clients/{clientId}/scopes` with `{"scopes": [...]}` |
| Delete | `DELETE /admin/clients/{clientId}` |

Disabling an application revokes the tokens that were issued to it. Enabling it again does not
restore them. Deleting an application does not revoke its access tokens; revoke first when that
matters.

The `lumo` CLI has `lumo apps list`, `lumo apps get <client-id>`, `lumo apps create --name ...
--redirect-uris ... --grant-types ...` and `lumo apps rotate-secret <client-id>`. See
`lumoauth-cli`.

## Custom scopes

Create a scope in the organization, then allow it on each application that may request it.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/scopes \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "read:reports", "description": "Read reports"}'
```

This call needs the `admin:permissions:write` scope on the key. A name that already exists in the
organization, or that equals a system scope, returns `409`. In the portal, list the scopes that an
application may request under **Applications → your app → Configuration → Allowed scopes**.

## Dynamic client registration

Use it when applications must register themselves at run time. For one application that a
developer sets up once, use the portal or the Admin API.

**POST** `{base}/orgs/{orgId}/api/v1/connect/register` (the discovery `registration_endpoint`).

Requirements:

1. An administrator turns on **Dynamic client registration** under **Security → Sign-in settings**
   in the portal. While it is off, requests get `403 access_denied`, except requests that carry an
   API key with the `admin:clients:register` scope.
2. The request authenticates with one of:
   - an initial access token: `Authorization: Bearer <initial_access_token>` (required by default);
   - an organization API key with the `admin:clients:register` scope:
     `Authorization: ApiKey lmk_...`.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/connect/register \
  -H "Authorization: Bearer $LUMOAUTH_INITIAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Example desktop app",
    "application_type": "native",
    "redirect_uris": ["http://127.0.0.1:49152/callback", "com.example.app:/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "token_endpoint_auth_method": "none",
    "scope": "openid profile email"
  }'
```

| Request field | Notes |
|---|---|
| `redirect_uris` | Required. `application_type: "web"` (the default) requires `https`. `"native"` allows loopback `http` and private-use schemes |
| `client_name` | Optional. Markup and control characters are removed; at most 100 characters |
| `grant_types` | Default `["authorization_code", "refresh_token"]`. `client_credentials`, the device grant, token exchange and the JWT bearer grant cannot be self-assigned and are dropped |
| `response_types` | Default `["code"]` |
| `token_endpoint_auth_method` | `client_secret_basic` (default), `client_secret_post`, `private_key_jwt` (needs `jwks` or `jwks_uri`) or `none`. `client_secret_jwt` is refused |
| `scope` | A dynamically registered client receives only `openid`, `profile` and `email` from what it requests. An administrator adds further scopes afterwards |
| `post_logout_redirect_uris`, `frontchannel_logout_uri`, `backchannel_logout_uri` | Logout settings |
| `client_uri`, `logo_uri`, `policy_uri`, `tos_uri` | `http` or `https` URLs, shown on the consent page |
| `default_max_age`, `require_auth_time` | Sign-in freshness defaults |
| `audience_uris` | APIs that the client may request tokens for with `resource` |

The `201` response returns `client_id`, `client_secret` (confidential clients only, shown once),
`client_id_issued_at`, `client_secret_expires_at`, the registered metadata,
`registration_access_token` and `registration_client_uri`.

Read the registration back with the registration access token:

```bash
curl "$REGISTRATION_CLIENT_URI" -H "Authorization: Bearer $REGISTRATION_ACCESS_TOKEN"
```

The configuration endpoint is read-only. Updates and deletion go through the portal or the Admin
API. The registration access token works only on the issuer that it was created under
(organization path or custom domain).

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | The body is not valid JSON |
| 400 | `invalid_redirect_uri` | A redirect URI breaks the rules for its `application_type` |
| 400 | `invalid_client_metadata` | Unsupported metadata: `client_secret_jwt`, an encryption algorithm, a presentation URI that is not `http(s)` |
| 401 | `access_denied` | No valid initial access token |
| 403 | `access_denied` | Dynamic client registration is off, or the API key's creator lacks `clients.create` |
| 429 | `too_many_requests` | Too many registrations; back off |

Client ID Metadata Documents (a client that uses an `https` URL as its `client_id`) are a
different mechanism, used mostly by MCP clients. See `lumoauth-mcp-client`.

## Sources

- https://docs.lumoauth.dev/user-guide/applications/overview
- https://docs.lumoauth.dev/oauth/clients
- https://docs.lumoauth.dev/oauth/register
- https://docs.lumoauth.dev/oauth/scopes
