---
name: lumoauth-login-methods
description: >-
  Configures how users sign in to a LumoAuth organization: email and password
  (password policy, breached-password check, email verification, password
  reset, self-registration), magic link (passwordless), email-first login, and
  social login with Google, GitHub, Microsoft, Apple, Facebook, LinkedIn, X,
  Discord, Twitch or Slack. Covers the portal pages, the Admin API
  (`/admin/settings/authentication`, `/admin/settings/branding`,
  `/admin/social-providers`), `lumo settings` and `lumo social`, the social
  callback URL, the `provider` hint, the SDK calls `requestMagicLink`,
  `checkEmailExists`, `useMagicLink` and `useEmailFirst`, and login
  troubleshooting ("Invalid credentials", redirect_uri mismatch,
  invalid_grant). Use when the user asks to enable or change a sign-in method,
  add "Sign in with Google" or another social provider, turn on passwordless
  or magic link login, set a password policy, or fix a failing login. Not for
  MFA, passkeys, SAML or OIDC enterprise SSO, or login page branding.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth login methods

Configure the first step of sign-in for an organization: password, magic link, email-first and social providers. Most of this is configuration, not code. An app that already redirects to the hosted login page needs no code change when a method is turned on.

## When to use

- Turn email + password, magic link or email-first login on or off, or change the password policy.
- Add, change, disable or remove a social login provider.
- Send a user straight to one social provider from the app.
- Diagnose a failed sign-in.

Do not use this skill for:

- A second factor, passkeys or push sign-in: use `lumoauth-mfa-passkeys`.
- SAML, enterprise OIDC or LDAP connections: use `lumoauth-enterprise-sso`.
- Logo, colours, texts, email templates or a custom domain: use `lumoauth-branding`.
- The redirect, callback and token code in the app: use the framework skill (`lumoauth-nextjs`, `lumoauth-react`, `lumoauth-express`, ...) or `lumoauth-oauth-oidc`.
- Creating and inviting users: use `lumoauth-users-sessions`.

## Before you start

Collect these values. Ask the user for any value that is missing. Do not guess.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`acme-corp` in the examples) | The portal URL: `/orgs/{orgId}/portal` |
| Admin access | A portal admin session, or the `lumo` CLI (`lumo login --org acme-corp`), or an API key (`lmk_...`) created at `/orgs/{orgId}/portal/settings/api-keys` |
| For social login: client ID and client secret | The provider's developer console. The user creates them. |

Scopes for an API key or CLI token:

| Task | Scope | Portal permission that the caller (or the creator of the key) must hold |
|---|---|---|
| Read `/settings/authentication` | `admin:settings:read` | `settings.view` |
| Change `/settings/authentication` | `admin:settings:write` | `settings.manage` |
| Read `/settings/branding` | `admin:settings:read` | `branding.view` |
| Change the sign-in keys in `/settings/branding` | `admin:settings:write` | `branding.edit` and `settings.manage` |
| Read social providers | `admin:social:read` | `idps.view` |
| Create, change, delete social providers | `admin:social:write` | `idps.create`, `idps.edit`, `idps.delete` |

Send an API key in the `X-API-Key` header. Keep the key and every provider client secret in environment variables on a server or in the shell. Never put them in browser or mobile code, and never commit them.

Show the user every command that creates, changes or deletes something in the organization before you run it.

## Where each setting is configured

| Feature | Portal page | Admin API | CLI |
|---|---|---|---|
| Password policy, breached-password check, password rotation, session timeout | **Security → Sign-in settings**, `/orgs/{orgId}/portal/settings/authentication` (sections **Password standards**, **Auth lifecycle**) | `GET` / `PATCH /admin/settings/authentication` | `lumo settings get authentication`, `lumo settings update authentication` |
| Magic link login, magic-link-only mode, link expiry, email-first login | Same page, section **Login flow** | `GET` / `PATCH /admin/settings/branding` (keys `magic_link_enabled`, `magic_link_only`, `magic_link_expiry`, `email_first_mode`) | `lumo settings get branding`, `lumo settings update branding` |
| Social providers for the organization | **Settings → Integrations**, `/orgs/{orgId}/portal/integrations`, section **Social login** | `/admin/social-providers` | `lumo social list`, `get`, `delete`; create with `lumo api` (see step 4) |
| Social providers for one application | Application → **Security** tab → **Configure social login**, `/orgs/{orgId}/portal/applications/oidc/{clientId}/social-login` | Portal only | None |
| Email verification on sign-up | No switch. A self-service sign-up always proves the mailbox first. | None | None |

Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`.

## Steps

### 1. Read the current state

```bash
export LUMO_ORG=acme-corp
lumo settings get authentication -o json
lumo settings get branding -o json
lumo social list -o json
```

For the EU region, also set `LUMO_BASE_URL=https://eu.app.lumoauth.dev`.

### 2. Set the password policy

In the portal, open **Security → Sign-in settings → Password standards**. Choose a template (**Fair**, **Moderate**, **Strict** or **Custom**). The single rules (minimum length, uppercase, lowercase, numbers, special characters) can be edited only after **Custom** is chosen. The breached-password check and password rotation are in **Auth lifecycle**.

With the CLI or the API, the update merges top-level keys only. `password_policy` is one key, so send the complete object. Read it first, change the fields, send all of it back:

```bash
lumo settings update authentication --data '{
  "password_policy": {
    "template": "custom",
    "min_length": 12,
    "require_uppercase": true,
    "require_lowercase": true,
    "require_numbers": true,
    "require_special": false,
    "reject_breached_passwords": true,
    "breached_password_min_count": 1,
    "check_breached_on_login": false
  }
}'
```

The server clamps numeric values to its allowed range, so read the settings back after the write. The policy applies to every way of setting a password: sign-up, reset, change, an admin who sets a password, `POST /admin/users` with a `password`, SCIM and invitations.

Brute-force protection (attempt limits and a temporary account lock) is always on and is not configurable.

### 3. Turn on email-first and magic link

In the portal, open **Security → Sign-in settings → Login flow**:

- **Email-first login**: the login page asks for the email address first and shows the other options on the next step.
- **Magic link login**: users can request a single-use sign-in link by email. Two more options appear: **Hide password login and show the magic link form only**, and **Link expiry** in seconds (60 to 86400, default 900).

With the CLI:

```bash
lumo settings update branding \
  --set magic_link_enabled=true \
  --set magic_link_only=false \
  --set magic_link_expiry=900 \
  --set email_first_mode=true
```

These four keys and `self_registration_enabled` are stored with the login page settings, but they are sign-in policy. The caller needs the `settings.manage` permission in addition to `branding.edit`. Without it the API answers `403` and names the keys in `details.rejected_keys`.

The magic link opens a confirmation page. The user is signed in only after pressing **Sign in** on that page, so mail scanners that fetch the link do not use it up. Turning **Magic link login** off also stops links that were already sent.

### 4. Add a social provider

1. Read the callback URL for the provider. It is always `{base}/orgs/{orgId}/auth/social/{provider}/callback`, for example `https://app.lumoauth.dev/orgs/acme-corp/auth/social/google/callback`. LumoAuth generates it. It cannot be changed, and the API ignores a `callbackUrl` in the request body.
2. Ask the user to create an OAuth app in the provider's developer console with that callback URL as the redirect URI, and to export the credentials, for example as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Per-provider steps are in [references/social-providers.md](references/social-providers.md).
3. Create the provider. `provider`, `displayName`, `clientId` and `clientSecret` are required. A provider is created disabled unless `enabled` is `true`.

```bash
curl -sS -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/social-providers" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"provider\": \"google\",
    \"displayName\": \"Google\",
    \"clientId\": \"$GOOGLE_CLIENT_ID\",
    \"clientSecret\": \"$GOOGLE_CLIENT_SECRET\",
    \"requestedScopes\": [\"openid\", \"profile\", \"email\"],
    \"enabled\": true
  }"
```

The same call with the CLI's stored credentials:

```bash
lumo api POST /social-providers --data "{\"provider\":\"google\",\"displayName\":\"Google\",\"clientId\":\"$GOOGLE_CLIENT_ID\",\"clientSecret\":\"$GOOGLE_CLIENT_SECRET\",\"enabled\":true}"
```

Use `lumo api` or `curl` to create a provider. `lumo social create` sends `name` and `scopes`, but the API requires `displayName` and reads `requestedScopes`, so that command is refused with `Missing required fields: displayName`.

In the portal the same is done at `/orgs/{orgId}/portal/integrations` → **Social login** → **Add provider**. The form shows the callback URL after a **Provider type** is chosen. Each provider type can be added once per organization.

Later changes:

```bash
lumo api POST /social-providers/google/disable
lumo api POST /social-providers/google/enable
lumo api PATCH /social-providers/google --data '{"displayName":"Google Workspace"}'
lumo social delete google
```

`{providerId}` in a path is the numeric ID or the provider key (`google`). Read [references/social-providers.md](references/social-providers.md) for every field, default roles, the rules for linking a social identity to an existing account, and Apple and Microsoft specifics.

### 5. App code

With the hosted login page, the app needs no change. The page shows the password form, the magic link button and one button per enabled provider.

To skip the login page and go straight to one provider, add `provider` to the authorization request that the app already builds. Keep `state` and PKCE as they are:

```text
https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize
  ?response_type=code
  &client_id=CLIENT_ID
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback
  &scope=openid%20profile%20email
  &state=STATE
  &code_challenge=CHALLENGE
  &code_challenge_method=S256
  &provider=google
```

The hint is accepted for `google`, `github`, `microsoft`, `facebook`, `apple` and `linkedin`. An unknown or unconfigured value shows the normal login page. Do not link to `/orgs/{orgId}/auth/social/{provider}` from an OAuth app: that route does not carry the PKCE challenge of the authorization request.

To pre-fill the email field on the hosted page, send the standard OIDC `login_hint` parameter with the email address.

Read [references/custom-login-ui.md](references/custom-login-ui.md) only when the user wants the app to render its own sign-in form with `requestMagicLink`, `checkEmailExists`, `useMagicLink`, `useEmailFirst` or `loginWithPassword`. Prefer the hosted page.

## Verify

1. Read the settings back: `lumo settings get branding -o json` and `lumo api GET /social-providers/google`. The provider shows `"enabled": true` and the generated `callbackUrl`. The client secret is never returned.
2. Open `{base}/orgs/{orgId}/login` in a private browser window. Check that the expected options appear: the email step, the magic link button, one button per provider.
3. In the portal, open **Test login** (under **Applications & developer tools**) and click **Start test login** to run a full sign-in.
4. Sign in once with each new method. For a social provider, check that the provider's consent page names the right app and that the browser returns to the app signed in.
5. Check **Security → Audit logs** for the sign-in event.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Provider page shows "redirect_uri mismatch" | The redirect URI in the provider console differs from the generated callback URL | Copy the URL from `GET /admin/social-providers/callback-urls` or from the portal form, character for character. Use the EU host for an EU organization. |
| The provider was created but no button appears | `enabled` was not sent, so the provider is disabled | `lumo api POST /social-providers/{provider}/enable` |
| `400 Missing required fields: displayName` | `lumo social create` was used, or `displayName` was left out | Create with `lumo api POST /social-providers` and send `displayName` |
| `409 This provider is already configured` | Each provider type exists once per organization | `PATCH` the existing provider |
| `403` with `rejected_keys` on `/settings/branding` | The caller lacks `settings.manage` | Use a caller that holds it, or change the keys in **Sign-in settings** |
| `400` on `defaultRoles` | The role is a system role, opens the portal, or holds permissions that the caller does not hold | Use a role that holds application permissions only |
| "An account with this email already exists" on a first social sign-in | The existing account has a password, a role, a second factor or another sign-in source, so it is not linked by email | The user signs in with the usual method and links the provider at `/account/security` |
| "Check your email to finish setting up your account" after a social sign-in | The provider did not confirm the email address | The user opens the emailed link. For Microsoft work accounts see the reference file. |
| Password policy fields disappeared after an API update | A partial `password_policy` object replaced the stored one | Send the complete object |
| `404` from `POST /orgs/{orgId}/magic-link` | Magic link login is off for the organization | Turn it on (step 3) |
| "Invalid credentials" right after sign-up | The account does not exist until the form behind the emailed link is submitted | Finish the sign-up form from the email |

More symptoms, including OAuth errors in the app (`invalid_client`, `invalid_grant`, `state` mismatch), are in [references/troubleshooting.md](references/troubleshooting.md).

## Related skills

- `lumoauth-mfa-passkeys`: second factors, passkeys, push sign-in, step-up.
- `lumoauth-enterprise-sso`: SAML and OIDC connections to a customer's identity provider.
- `lumoauth-branding`: login page appearance, email templates, custom domains.
- `lumoauth-oauth-oidc`: the authorization request, callback and token code.
- `lumoauth-users-sessions`: create and invite users, sessions, account self-service.
- `lumoauth-admin-api`: API keys, scopes, errors, pagination.
- `lumoauth-cli`: install and sign in to `lumo`.

## References

- [references/social-providers.md](references/social-providers.md): open when adding or changing a social provider (fields, provider keys, console setup, default roles, account linking).
- [references/custom-login-ui.md](references/custom-login-ui.md): open when the app renders its own sign-in form.
- [references/troubleshooting.md](references/troubleshooting.md): open when a sign-in fails.
- https://docs.lumoauth.dev/user-guide/authentication/overview
- https://docs.lumoauth.dev/user-guide/authentication/email-password
- https://docs.lumoauth.dev/user-guide/authentication/magic-link
- https://docs.lumoauth.dev/user-guide/authentication/social-login
- https://docs.lumoauth.dev/user-guide/authentication/troubleshooting
- https://docs.lumoauth.dev/api-reference/social-providers
- https://docs.lumoauth.dev/api-reference/settings
