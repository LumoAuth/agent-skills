---
name: lumoauth-migrate
description: >-
  Moves users and configuration to LumoAuth from Auth0, Clerk, Okta, AWS Cognito or Firebase
  Authentication. Covers the `lumo migrate auth0` command (the one automated importer), the
  manual route for the other providers (export, reshape with jq, create users through the
  Admin API with a repeat-safe loop), which user fields are kept, how password hashes are
  handled (they are not imported; users set a new password, use a magic link or sign in
  with a social or SSO provider), the mapping of applications, connections, roles, groups
  and organizations, ID mapping from the old user IDs, the switch of the app's SDK, a
  parallel run, and a cut-over and rollback checklist. Use when the user asks to migrate
  from Auth0, Clerk, Okta, Cognito or Firebase Auth to LumoAuth, to import or bulk-create
  users, to replace another identity provider, to keep Okta as the identity provider behind
  LumoAuth, or to plan an authentication cut-over.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# Migrate to LumoAuth

Move an application from another identity provider to LumoAuth: import the users, recreate
the configuration, switch the application code, run both providers side by side, cut over,
and keep a way back until the old provider is retired.

## When to use

- The user wants to leave Auth0, Clerk, Okta, AWS Cognito or Firebase Authentication.
- The user wants to import a list of users from any system into a LumoAuth organization.
- The user wants to keep the old provider (for example Okta) as the place where people
  sign in, and put LumoAuth in front of the applications.

Do not use this skill for:

- Ongoing provisioning from a directory or an HR system: use `lumoauth-scim`.
- A first integration without an old provider: use `lumoauth-getting-started`.
- Single commands of the CLI: use `lumoauth-cli`.

## What a migration can and cannot carry

| Data | Result |
|---|---|
| Email, email verification state, name, given name, family name, username, phone number, active state | Imported. These are the fields that the user creation endpoint stores |
| Roles and groups | Recreated in LumoAuth, then assigned by slug |
| Picture, locale | Set after creation with a user update |
| Old user ID, custom metadata, creation date, last sign-in | Not stored by LumoAuth. Keep a mapping table (old ID to LumoAuth user ID) and the extra data in the application's own database |
| Password hashes | **Not imported**, for any provider. Users are created without a password |
| MFA enrollments (authenticator apps, SMS, push) and passkeys | Not portable. Users enroll again in LumoAuth |
| Sessions and refresh tokens | Not honoured. Users sign in again |
| Rules, Actions, Lambda triggers, hooks | Not translated. Rebuild each one as application logic or as a webhook handler; LumoAuth does not run custom code inside the sign-in flow |

How a migrated user signs in the first time, without a password:

1. **Password reset** from the sign-in page ("forgot password"), or a reset email that an
   admin triggers.
2. **Magic link**, when the organization has magic link sign-in switched on.
3. **Social or enterprise SSO**, when the same provider is configured in LumoAuth (see the
   linking rule in step 5).

Tell the user this before any import: the choice decides the user communication.

## Before you start

| Value | Where it comes from |
|---|---|
| Source provider and an export of its users | The user. Each `references/{provider}.md` shows the export |
| LumoAuth organization slug and region base URL | Ask the user. `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| A credential for the organization | `lumo login`, or an API key with `admin:users:read` and `admin:users:write` (plus `admin:roles:*`, `admin:groups:*`, `admin:clients:*` for the configuration steps) |
| A test organization | A second organization, or a sandbox organization (`lumo dev start`) where the plan includes it. Rehearse there first |
| `lumo` CLI and `jq` | Installed locally. See `lumoauth-cli` |

Ask the user for a value that you cannot find. Never guess one.

Rules for the whole migration:

- An export holds personal data, and a Firebase export also holds password hashes. Keep
  exports out of the repository, restrict the file mode, and delete them when the
  migration is done.
- Show the user every command that creates, changes or deletes something in LumoAuth
  before you run it. For a bulk import, show the command and the number of users, run a
  small sample first, and get approval again for the full run.
- Set `emailVerified` to `true` only for an address that the source provider verified.
  A wrongly verified address lets another person take the account through a social
  sign-in.
- Do not change or delete anything at the source provider until the cut-over is complete.

## Steps

### 1. Take inventory

List what the source holds, with numbers. Ask the user for what you cannot read.

| Item | Question |
|---|---|
| Users | How many? How many sign in with a password, with a social provider, with enterprise SSO? |
| Applications | Which apps and APIs use the provider? Which SDK and which redirect URIs? |
| Connections | Which social providers, SAML or OIDC connections, directories? |
| Authorization | Roles, permissions, groups, organizations (B2B customers)? |
| Custom logic | Rules, Actions, triggers, custom claims in tokens? |
| Dependencies | Which systems store the old user ID? Which APIs validate the old tokens? |

### 2. Prepare the LumoAuth organization

Before any user is imported:

1. Check the connection: `lumo doctor -o json` must print `"ok": true`, and
   `lumo whoami -o json` must name the target organization.
2. Recreate permissions, roles and groups, so that the import can assign them:

```bash
lumo permissions create --slug invoices.approve --name "Approve invoices" -o json
lumo roles create --name "Finance" --permissions invoices.approve -o json
lumo groups create --name "Engineering" -o json
```

3. Set the sign-in methods that migrated users will need (magic link, social providers,
   password policy, MFA policy). Use `lumoauth-login-methods` and `lumoauth-mfa-passkeys`.
4. Recreate the applications (step 5), so that client IDs exist for the code change.

### 3. Import the users

**From Auth0**, use the importer. Open [references/auth0.md](references/auth0.md) for the
export, the field list and the steps after the run.

```bash
lumo migrate auth0 --file users.json --dry-run          # parses the file; sends nothing
lumo migrate auth0 --file users.json --limit 100 -o json   # a first batch
lumo migrate auth0 --file users.json -o json            # the full run
```

**From Clerk, Okta, Cognito or Firebase**, there is no importer. The route is the same for
all four: export, reshape each record with `jq` into the fields that LumoAuth stores, and
create one user per request. Open the provider file for the export and the `jq` filter,
and [references/import-loop.md](references/import-loop.md) for the tested loop:

- [references/clerk.md](references/clerk.md)
- [references/okta.md](references/okta.md)
- [references/cognito.md](references/cognito.md)
- [references/firebase.md](references/firebase.md)

```bash
jq -c -f clerk.jq clerk-users.json > lumo-users.ndjson   # provider-specific filter
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson                        # five users first
bash import-users.sh lumo-users.ndjson                    # then all
```

Both routes are safe to run again: a user whose email exists is skipped (HTTP 409), so a
second run creates only what is missing. Run the import again shortly before the cut-over
to pick up users who signed up at the source in the meantime.

The user creation endpoint (`POST /orgs/{orgId}/api/v1/admin/users`) takes one user per
request and stores `email`, `username`, `name`, `givenName`, `familyName`, `phoneNumber`,
`isActive`, `emailVerified`, `roles` and `groups` (slugs). It has no bulk form. An email is
required: accounts without one (phone-only, anonymous) cannot be imported.

### 4. Keep the ID mapping

LumoAuth assigns a new user ID. Every place that stores the old ID (`auth0|abc123`,
`user_2abc...`, `00u1abc...`, a Cognito `sub`, a Firebase UID) needs a mapping.

- The manual loop writes `mapping.csv` (`old_id,lumoauth_user_id`) while it runs.
- For Auth0, build the mapping after the run; `references/auth0.md` has the script.
- Load the mapping into the application's database, next to the metadata that LumoAuth
  does not store. Resolve users through it, or rewrite the stored IDs in one migration.

### 5. Recreate applications and connections

| Source concept | In LumoAuth | How |
|---|---|---|
| Application (web, server-side) | OAuth client with a secret | `lumo apps create --name "Acme Web" --redirect-uris https://app.example.com/callback -o json` |
| Application (single-page, native) | Public OAuth client, PKCE | `lumo api POST /clients --data '{"name":"Acme SPA","redirectUris":["https://app.example.com/callback"],"isConfidential":false}' -o json` |
| Machine-to-machine application | OAuth client with the client credentials grant | `lumoauth-api-protection` |
| Social connection (Google, GitHub, Microsoft, ...) | Social login provider | Portal: **Settings**, **Integrations**, **Social login**, **Add provider**. Register LumoAuth's callback URL at the provider |
| SAML connection | SAML identity provider | Portal: **Settings**, **Integrations**, **Enterprise SSO (SAML)** |
| OIDC enterprise connection | OIDC identity provider | Portal: **Settings**, **Integrations**, **Enterprise SSO (OIDC)** |
| Active Directory, LDAP | Directory connection | `lumoauth-enterprise-sso` |
| Roles, permissions | Roles, permissions | `lumo roles`, `lumo permissions`; assign with `lumo users roles set` |
| Groups | Groups | `lumo groups create`, `lumo groups members add` |
| Organizations (B2B customers) | Customer organizations | `POST /admin/organizations`, then members. Use `lumoauth-b2b-saas` |
| Rules, Actions, triggers | Webhooks or application code | `lumoauth-webhooks` |

Client IDs and secrets are new: the old ones cannot be carried over. A client secret is
returned once at creation; store it in the secret manager at that moment.

**Linking rule for social and SSO sign-in.** When a migrated user signs in with a social
provider for the first time, LumoAuth links the provider to the imported account only if
all of these hold: the account was imported with `emailVerified: true`; it has no
password; the provider states that the email is verified; and the account holds no role,
cannot open the admin portal and has no MFA factor or passkey. Otherwise the sign-in is
refused with "An account with this email already exists", and the user first signs in
another way (password reset or magic link) and links the provider from the account
pages. Plan for this: users who hold a role cannot rely on the automatic link.

An enterprise OIDC connection signs in only accounts that are already linked to it. For
the setup of connections use `lumoauth-enterprise-sso` and `lumoauth-login-methods`.

### 6. Switch the application code

Change the application behind a configuration switch (for example `AUTH_PROVIDER`), so
that the old path stays deployable.

| Application | Skill |
|---|---|
| Next.js | `lumoauth-nextjs` |
| React single-page app | `lumoauth-react` |
| Vue, Angular, React Native | `lumoauth-vue`, `lumoauth-angular`, `lumoauth-react-native` |
| Express, other Node.js backends | `lumoauth-express`, `lumoauth-node-backend` |
| FastAPI, Flask, Django | `lumoauth-fastapi`, `lumoauth-python` |
| Go, ASP.NET Core, Spring Boot | `lumoauth-go`, `lumoauth-aspnetcore`, `lumoauth-spring-boot` |
| Laravel, Symfony, plain PHP | `lumoauth-laravel`, `lumoauth-symfony`, `lumoauth-php` |
| Any OIDC library | `lumoauth-oauth-oidc` |
| APIs that validate access tokens | `lumoauth-api-protection` |

Points that every code change must cover:

- The issuer, the JWKS URL and the audience change. An API that validates tokens must
  accept both issuers during the parallel run, each with its own keys and audience.
- Claims differ. Replace reads of provider-specific claims (for example a namespaced
  roles claim) with the claims that LumoAuth issues, or with a permission check.
- The user ID (`sub`) changes. Resolve the application's user through the mapping.
- Webhook receivers point to LumoAuth events with LumoAuth's signature scheme.

### 7. Run in parallel, cut over, keep a way back

Open [references/cutover-checklist.md](references/cutover-checklist.md) and work through
it with the user. In short:

1. Import users; repeat the import until the cut-over.
2. Deploy the application so that it accepts sessions and tokens from both providers.
3. Send a first group of users (internal users, then a percentage) to LumoAuth.
4. Watch sign-in success, password resets and support requests.
5. Make LumoAuth the default. Keep the old provider read-only and reachable.
6. Retire the old provider only after an agreed period without traffic.

Rollback before step 6 is a configuration change: switch the default back. Nothing at
the source was changed.

## Verify

1. `lumo users list --limit 1 -o json` shows `meta.total` equal to the number of
   imported users plus the users that existed before.
2. Spot-check five users: `lumo users get <email> -o json` shows the right name,
   `emailVerified` and `isActive`.
3. `mapping.csv` (or the Auth0 mapping) has one line per imported user.
4. A test user without a password completes the first sign-in by password reset, by
   magic link and by each configured social provider.
5. A second run of the import creates nothing new.
6. The application, switched to LumoAuth in a test environment, signs a migrated user in
   and resolves the right application user through the mapping.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Migrated users cannot sign in with their old password | Password hashes are not imported | Tell users before the cut-over; offer password reset, magic link or social sign-in |
| `lumo migrate auth0 --send-reset` sends no email | The current CLI defines the flag but does not act on it | Trigger reset emails after the import; see `references/auth0.md` |
| Social sign-in fails with "An account with this email already exists" | The linking rule in step 5 is not met | Import with the correct `emailVerified`, without a password; users with roles sign in by reset or magic link first |
| Rows fail with HTTP 429 | Too many requests for the credential | Lower `--concurrent`, or let the loop wait; then run again |
| Rows fail with HTTP 403 | The key lacks `admin:users:write`, or its creator lacks `users.create` | Create a key with the scope, from an admin who holds the permission |
| The application cannot find users after the switch | Code still uses the old user ID | Load and use the mapping (step 4) |
| Custom metadata is gone | LumoAuth's user creation does not store it | Keep it in the application's database, keyed by the LumoAuth user ID |
| Users without an email are missing | An email is required | Collect an email in the application before or after the cut-over |
| Username sign-in stops working | Users sign in with their email address | Tell users; keep the username only as a profile field |
| Every user got a verified email | The filter set `emailVerified: true` for all | Map it from the source's verification flag |
| An SPA client has a secret | `lumo apps create --type spa` does not make a public client | Create it with `lumo api POST /clients` and `"isConfidential": false` |

## Related skills

- `lumoauth-cli`: `lumo migrate`, `lumo users`, `lumo api`, sandbox organizations.
- `lumoauth-admin-api`: the user endpoints, API key scopes, rate limits and retries.
- `lumoauth-users-sessions`: user fields, invitations, sessions after the import.
- `lumoauth-login-methods`, `lumoauth-mfa-passkeys`, `lumoauth-enterprise-sso`:
  recreate sign-in methods and connections.
- `lumoauth-rbac`, `lumoauth-b2b-saas`: roles, groups and customer organizations.
- `lumoauth-webhooks`: replace rules, actions and triggers.
- The framework skills in step 6 for the code change.

## References

- [references/auth0.md](references/auth0.md): `lumo migrate auth0`, the export, what is
  stored, and the scripts for the steps after the run.
- [references/clerk.md](references/clerk.md), [references/okta.md](references/okta.md),
  [references/cognito.md](references/cognito.md),
  [references/firebase.md](references/firebase.md): export, field mapping and `jq` filter
  per provider, and what does not carry over.
- [references/import-loop.md](references/import-loop.md): the repeat-safe import script
  for the four manual providers.
- [references/cutover-checklist.md](references/cutover-checklist.md): parallel run,
  cut-over, rollback and retirement.
- https://docs.lumoauth.dev/migrations/ and the provider pages
  https://docs.lumoauth.dev/migrations/auth0, https://docs.lumoauth.dev/migrations/clerk,
  https://docs.lumoauth.dev/migrations/okta, https://docs.lumoauth.dev/migrations/cognito,
  https://docs.lumoauth.dev/migrations/firebase
- https://docs.lumoauth.dev/cli/migrate
