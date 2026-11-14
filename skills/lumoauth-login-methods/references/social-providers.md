# Social login providers

Reference for adding and managing social login providers in a LumoAuth organization. The main path is in `SKILL.md` step 4.

## Contents

- [Provider keys](#provider-keys)
- [Callback URL](#callback-url)
- [Admin API](#admin-api)
- [Provider object and writable fields](#provider-object-and-writable-fields)
- [Console setup per provider](#console-setup-per-provider)
- [Default roles](#default-roles)
- [How a social sign-in maps to an account](#how-a-social-sign-in-maps-to-an-account)
- [Changing where a provider points](#changing-where-a-provider-points)
- [Per-application social login](#per-application-social-login)
- [User-facing URLs](#user-facing-urls)

## Provider keys

The portal offers these provider types. The key is the value of `provider` in the API and of `{provider}` in URLs.

| Provider | Key | Default requested scopes |
|---|---|---|
| Google | `google` | `openid`, `profile`, `email` |
| GitHub | `github` | `read:user`, `user:email` |
| Microsoft | `microsoft` | `openid`, `profile`, `email`, `User.Read` |
| Facebook | `facebook` | `email`, `public_profile` |
| Apple | `apple` | `name`, `email` |
| LinkedIn | `linkedin` | `r_liteprofile`, `r_emailaddress` |
| X | `x` | `users.read`, `tweet.read` |
| Discord | `discord` | `identify`, `email` |
| Twitch | `twitch` | `user:read:email` |
| Slack | `slack` | `openid`, `profile`, `email` |

The portal form fills in these defaults when a provider type is chosen. The Admin API does not: when `requestedScopes` is left out of a `POST`, it stores `openid`, `profile`, `email`. Send `requestedScopes` explicitly for providers whose scopes differ, such as GitHub.

The portal list shows the key with a capital first letter, so GitHub appears as **Github** and LinkedIn as **Linkedin**.

Any other OpenID Connect provider is added as an OIDC identity provider, not as a social provider. Use `lumoauth-enterprise-sso`.

## Callback URL

```text
{base}/orgs/{orgId}/auth/social/{provider}/callback
```

Example: `https://app.lumoauth.dev/orgs/acme-corp/auth/social/github/callback`.

LumoAuth generates this URL. Register it as the redirect URI in the provider's console. A `callbackUrl` in a request body is ignored.

Read the URLs of all configured providers:

```bash
lumo api GET /social-providers/callback-urls
```

## Admin API

Base path: `{base}/orgs/{orgId}/api/v1/admin/social-providers`.

| Method | Path | Permission | Scope |
|---|---|---|---|
| `GET` | `/` | `idps.view` | `admin:social:read` |
| `GET` | `/types` (alias `/available`) | `idps.view` | `admin:social:read` |
| `GET` | `/callback-urls` | `idps.view` | `admin:social:read` |
| `GET` | `/{providerId}` | `idps.view` | `admin:social:read` |
| `POST` | `/` | `idps.create` | `admin:social:write` |
| `PUT` | `/{providerId}` | `idps.edit` (and `idps.create` when the provider does not exist yet) | `admin:social:write` |
| `PATCH` | `/{providerId}` | `idps.edit` | `admin:social:write` |
| `DELETE` | `/{providerId}` | `idps.delete` | `admin:social:write` |
| `POST` | `/{providerId}/enable` | `idps.edit` | `admin:social:write` |
| `POST` | `/{providerId}/disable` | `idps.edit` | `admin:social:write` |

`{providerId}` is the numeric `id` or the provider key such as `google`.

Each call needs the scope on the credential and the permission on the caller. For an API key, the creator of the key must hold the permission.

Behaviour to rely on:

- `POST` requires `provider`, `displayName`, `clientId` and `clientSecret`. It answers `201`, or `409` when the provider type is already configured.
- `PUT` is an upsert. It requires `clientId`. When the provider does not exist it is created (`201`), with `displayName` defaulting to the capitalised key.
- `PATCH` changes only the fields that are sent. It answers `404` for an unknown provider.
- `enabled` defaults to `false` on create.
- `clientSecret` is write-only. Responses never contain it.

CLI commands that work against this API:

```bash
lumo social list -o json          # use -o json: the table view reads `name` and `isActive`, but the API returns `displayName` and `enabled`
lumo social get google
lumo social delete google
lumo api GET /social-providers/types
lumo api PATCH /social-providers/google --data '{"enabled":false}'
```

`lumo social create` is not usable at present: it sends `name` and `scopes`, and the API requires `displayName` and reads `requestedScopes`. Create with `lumo api POST /social-providers` as shown in `SKILL.md`.

## Provider object and writable fields

A detailed response (`GET /{providerId}`, and the result of a create or update) contains:

```json
{
  "id": 12,
  "provider": "google",
  "displayName": "Google",
  "enabled": true,
  "brandColor": null,
  "iconUrl": null,
  "jitProvisioningEnabled": true,
  "clientId": "1234567890.apps.googleusercontent.com",
  "callbackUrl": "https://app.lumoauth.dev/orgs/acme-corp/auth/social/google/callback",
  "requestedScopes": ["openid", "profile", "email"],
  "customClaims": null,
  "claimMapping": null,
  "providerConfig": null,
  "authorizationUrl": null,
  "tokenUrl": null,
  "userInfoUrl": null,
  "defaultRoles": []
}
```

The list response contains only `id`, `provider`, `displayName`, `enabled`, `brandColor`, `iconUrl` and `jitProvisioningEnabled` for each provider.

| Writable field | Type | Notes |
|---|---|---|
| `provider` | string | Provider key. `POST` only. |
| `displayName` | string | Text of the "Sign in with ..." button |
| `clientId` | string | From the provider console |
| `clientSecret` | string | From the provider console. Stored encrypted. |
| `enabled` | boolean | Shows or hides the button |
| `requestedScopes` | string array | Request the minimum that the app needs |
| `providerConfig` | object | Provider-specific values. Google: `{"hosted_domain": "example.com"}`. Microsoft: `{"tenant_id": "<directory id>"}`. Secret values inside it are stored encrypted and returned redacted. |
| `claimMapping` | object | Maps provider claims to the user profile |
| `customClaims` | object | Deprecated. Accepted and ignored; the response always returns `null`. To get more profile data, add a scope to `requestedScopes`. |
| `brandColor`, `iconUrl` | string | Button appearance |
| `authorizationUrl`, `tokenUrl`, `userInfoUrl` | string | Override the provider endpoints. Each must be a public `https://` URL. When one changes on an existing provider, send `clientSecret` again in the same request. |
| `defaultRoles` | array of role slugs | `POST` only through this API. See [Default roles](#default-roles). To change the default roles of an existing provider, use the portal form. |

Google `hosted_domain` is enforced. The `hd` claim of the verified ID token must equal it and the email must be in that domain. Otherwise the sign-in is refused and no account is created.

## Console setup per provider

In every case, replace the host with `eu.app.lumoauth.dev` for an EU organization and `acme-corp` with the organization slug.

### Google

1. Open the Google Cloud Console → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID**, type **Web application**.
3. Add the authorized redirect URI `https://app.lumoauth.dev/orgs/acme-corp/auth/social/google/callback`.
4. Copy the client ID and client secret.

### GitHub

1. Open GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the authorization callback URL to `https://app.lumoauth.dev/orgs/acme-corp/auth/social/github/callback`.
3. Copy the client ID and generate a client secret.

### Microsoft

1. Open the Azure portal → **App registrations → New registration**.
2. Add the redirect URI `https://app.lumoauth.dev/orgs/acme-corp/auth/social/microsoft/callback`.
3. Under **Certificates & secrets**, create a client secret.
4. Copy the **Application (client) ID** and the secret value.
5. For work or school accounts, add `xms_edov` as an optional claim to the app registration. LumoAuth treats a work or school address as verified only when the ID token carries `xms_edov` with the value `true`. Without the claim, each person receives a sign-up link by email on the first sign-in. Personal Microsoft accounts are not affected.

To limit sign-in to one directory, set the **Tenant ID** field in the portal form, or `providerConfig.tenant_id` in the API.

### Apple and the other providers

Create the OAuth or "Sign in with" app in the provider's developer console and register the callback URL for that provider key. Add Apple in the portal (`/orgs/{orgId}/portal/integrations` → **Social login** → **Add provider**), where the form shows the fields that Apple needs. Ask the user for the values. Do not guess them.

## Default roles

`defaultRoles` is a list of role slugs. Every account that the provider creates on first sign-in receives those roles. The rules:

- A system role is refused. A role that opens the organization portal is refused. That includes roles with view-only LumoAuth permissions such as `users.view`. A default role can hold the application's own permissions only.
- The caller must hold every permission in each role. For an API key, the creator of the key is the caller.
- Unknown slugs are ignored. A refused role fails the whole request with `400` and nothing is written.

To give a person who signs up through a social provider admin rights, let the account be created first and then assign the role (`lumoauth-rbac`).

## How a social sign-in maps to an account

| Situation | Result |
|---|---|
| New address, provider confirmed the email | An account is created and signed in. Default roles are assigned. |
| New address, provider did not confirm the email | Nothing is created. The person receives a sign-up link by email and continues from that link. |
| Address of an existing account | Linked only when the provider confirmed the email, the account's email is verified, and the account has no local password and no other sign-in source. An account that holds a role, can open the portal, or has a second factor or a passkey is never linked by email. Otherwise the sign-in is refused with "An account with this email already exists." |
| Signed-in user links a provider at `/account/security` | Linked when the provider returns the same email as the account, or no email at all. Refused when the identity already belongs to another user. |

A social sign-in runs the same account checks as a password sign-in. A blocked, inactive or locked account is refused. When the account has MFA, the second factor is still required. Each social sign-in creates a normal session.

Completing a password reset or confirming a verification link on an account whose address was not verified removes the social link, MFA factors, passkeys and push devices that were added before that point.

## Changing where a provider points

Some fields decide who can sign in as the accounts that are bound to a provider: `tokenUrl`, `userInfoUrl`, the `issuer`, `expected_issuer`, `jwks_uri` and `tenant_id` keys of `providerConfig`, and a `claimMapping` that changes the user identifier. A request that changes one of them is accepted only when the caller holds every permission that those accounts hold. Otherwise the API answers `403`. Ask an organization owner to make the change.

## Per-application social login

One application can show its own set of social buttons. This is configured in the portal only:

```text
/orgs/{orgId}/portal/applications/oidc/{clientId}/social-login
```

Open the application under **Applications**, go to the **Security** tab and click **Configure social login** in the **Authentication** section.

## User-facing URLs

| URL | Purpose |
|---|---|
| `GET /orgs/{orgId}/auth/social/{provider}` | Start a social sign-in from the organization's login page |
| `/orgs/{orgId}/auth/social/{provider}/callback` | Callback that the provider redirects to |
| `POST /orgs/{orgId}/auth/social/{provider}/link` | Link a provider to the signed-in user (form post from the account page) |
| `POST /orgs/{orgId}/auth/social/{provider}/unlink` | Unlink a provider (form post from the account page) |
| `/account/security` | The user's **Sign-in & security** page with **Link** and **Unlink** buttons |

From an OAuth app, start a social sign-in with the `provider` parameter on the authorization request (see `SKILL.md` step 5), not with these URLs.

Docs: https://docs.lumoauth.dev/user-guide/authentication/social-login and https://docs.lumoauth.dev/api-reference/social-providers
