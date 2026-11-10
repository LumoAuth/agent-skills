---
name: lumoauth-users-sessions
description: >-
  Manages the people in a LumoAuth organization: create, invite, update, block, unblock and
  delete users; set passwords and send reset or verification emails; list and revoke sessions
  (one session, one user, the whole organization); change the session timeout; read the
  current principal with the /me API; store custom user traits; configure progressive
  profiling and sign-up fields; and explain the account self-service pages. Covers the portal
  Users pages, the Admin API users and sessions endpoints, and the lumo users and lumo
  sessions CLI commands. Use when the user asks to add or invite users, deactivate or
  offboard a user, force sign-out, log a user out everywhere, build a user-management or
  admin screen in their own app, show "who am I", add profile fields, or asks about user
  states (active, inactive, blocked). Not for roles and groups (lumoauth-rbac), MFA factors
  (lumoauth-mfa-passkeys), customer organizations (lumoauth-b2b-saas) or SCIM
  (lumoauth-scim).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth users and sessions

Create and manage the users of one LumoAuth organization, control their sessions, and read the signed-in principal. Three surfaces do the same work: the portal, the Admin API and the `lumo` CLI. This skill says which surface supports which action.

## When to use

- Create, invite, update, block, unblock or delete users.
- Set a password, send a password reset email, send or skip email verification.
- List sessions and sign users out (one session, one user, every user).
- Change the session timeout.
- Call `GET /orgs/{orgId}/api/v1/me` to read the current user or agent.
- Add custom traits to users, ask for profile fields at sign-in (progressive profiling) or at sign-up.
- Build a user-management screen in the customer's own app.

Do not use this skill for:

- Role, group and permission design: use `lumoauth-rbac`.
- MFA factors, temporary access codes, passkeys: use `lumoauth-mfa-passkeys`.
- Customer organizations (companies inside the organization) and their invitations: use `lumoauth-b2b-saas`.
- Provisioning from an identity provider or HR system: use `lumoauth-scim`.
- API key creation, pagination and error format in general: use `lumoauth-admin-api`.

## Before you start

Collect these values. Ask the user for a value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask which region the organization is in. |
| Organization slug (`{orgId}`) | The slug in the portal URL: `/orgs/acme-corp/portal/`. |
| Admin credential | An API key (`lmk_...`) from the portal page `/orgs/{orgId}/portal/settings/api-keys`, or a CLI sign-in with `lumo login --org acme-corp`. |

API key scopes that this skill needs (grant only the ones that the task needs):

| Scope | Allows |
|---|---|
| `admin:users:read` | List and read users |
| `admin:users:write` | Create, update, delete, block and unblock users; set passwords |
| `admin:sessions:read` | List sessions |
| `admin:sessions:write` | Revoke sessions |
| `admin:settings:write` | Change the session timeout |

The Admin API checks two things: the scope of the credential and a permission (`users.view`, `users.create`, `users.edit`, `users.delete`). For an API key, the user who created the key must still hold the permission. A missing permission returns `403` with `details.required_permissions`.

Availability of the Admin API depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

Send the API key in one of these headers. Never send it from a browser or a mobile app.

```http
Authorization: ApiKey lmk_...
X-API-Key: lmk_...
```

Show the user every command that creates, changes or deletes something before you run it.

## Which surface supports what

| Task | Portal | Admin API | CLI |
|---|---|---|---|
| List, search users | `/orgs/{orgId}/portal/users` | `GET /admin/users` | `lumo users list` |
| Create a user | **Create user** on the Users page | `POST /admin/users` | `lumo users create` |
| Invite users by email | `/orgs/{orgId}/portal/users/invite` | Not available | Not available |
| Update profile, activate, deactivate | **Edit** in the row menu | `PATCH /admin/users/{userId}` | `lumo users update` |
| Block, unblock | **Block** / **Unblock** in the row menu | `POST /admin/users/{userId}/block`, `/unblock` | `lumo users block`, `lumo users unblock` |
| Delete | **Delete** in the row menu | `DELETE /admin/users/{userId}` | `lumo users delete` |
| Set a password | **Edit** page | `PUT /admin/users/{userId}/password` | `lumo users set-password` |
| List a user's sessions | Not available (no Sessions tab) | `GET /admin/users/{userId}/sessions` | `lumo sessions list --user` |
| Revoke sessions | Not available | `DELETE /admin/sessions/{sessionId}` and others | `lumo sessions revoke`, `revoke-all` |
| Session timeout | `/orgs/{orgId}/portal/settings/authentication`, **Auth lifecycle** | `PATCH /admin/settings/authentication` | `lumo settings update authentication` |
| Self-registration on or off | `/orgs/{orgId}/portal/settings/login-page`, **General** | Portal only in this skill | - |
| Progressive profiling, sign-up fields | `/orgs/{orgId}/portal/settings/authentication` | Portal only | - |
| User traits | **Customer 360 view** of a user | `PUT /abac/users/{userId}/attributes/{slug}` (user token) | - |

All Admin API paths in this skill are relative to `{base}/orgs/{orgId}/api/v1`.

Invitations to the organization are a portal feature only. Do not invent an invitations endpoint. If the app must create accounts from code, create the user without a password and send a reset email (step 3 below), or send the user to the portal page.

## Steps

### 1. Check access

The CLI reads `LUMO_ORG` and `LUMO_API_KEY` from the environment (or uses the profile that `lumo login` stored). Set `LUMO_BASE_URL=https://eu.app.lumoauth.dev` for an EU organization. Keep the key in a secret store, not in a file that is committed.

```bash
export LUMO_ORG=acme-corp
lumo users list --limit 5 -o json
```

`lumo users list` flags: `--search`, `--role`, `--group`, `--blocked`, `--page`, `--limit`, `--sort` (`email`, `name`, `createdAt`, `lastLoginAt`). Use `-o json` in scripts.

The same request over HTTP is `GET /admin/users?search=jane&limit=25&page=1` with the `Authorization: ApiKey` header.

The response has `data` (the rows) and `meta` (`total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPreviousPage`). `limit` defaults to 25 and has a maximum of 100. Filters: `search`, `active`, `blocked`, `emailVerified`, `mfaEnabled`, `role`, `group`, `sortBy`, `sortDir`.

### 2. Create a user

```bash
lumo users create \
  --email jane@example.com \
  --name "Jane Smith" --given-name Jane --family-name Smith \
  --roles viewer \
  --verified
```

Other flags: `--username`, `--password`, `--phone`, `--groups`.

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/users" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "name": "Jane Smith",
    "givenName": "Jane",
    "familyName": "Smith",
    "emailVerified": true,
    "roles": ["viewer"]
  }'
```

- Only `email` is required. Other body fields: `username` (defaults to the email), `phoneNumber`, `password`, `isActive` (default `true`), `emailVerified` (default `false`), `roles` and `groups` (arrays of slugs).
- A `password` must meet the organization's password policy, or the call returns `400` with the policy errors in `message`. Leave `password` out and let the user choose one through a reset link.
- The response is `201` with `{ "data": { ...user }, "message": "User created successfully" }`. A duplicate email returns `409`.
- The call does not send a welcome email.

### 3. Let the new user set a password

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/users/$USER_ID/password-reset" \
  -H "Authorization: ApiKey $LUMO_API_KEY"
```

This sends the password reset email to the user. To send a verification email instead, call `POST /admin/users/{userId}/verify-email`. To mark the address verified without an email, call `POST /admin/users/{userId}/mark-verified`.

Do not set a password for a user and send it over chat or email. If an admin must set one, use `lumo users set-password <user-id> --password "$NEW_PASSWORD"` and read the value from the environment. Setting a password signs the user out of every session and revokes the user's tokens.

### 4. Invite users (portal)

1. Open `/orgs/{orgId}/portal/users/invite`.
2. Enter one or more email addresses (one per line or comma-separated).
3. Optional: add a **Personal message** and select **Roles** to assign on acceptance.
4. Click **Send invitations**.

Each address gets one invitation link. The link is valid for 7 days. A new invitation to an address that has a pending invitation revokes the earlier one. Manage them at `/orgs/{orgId}/portal/users/invitations` (tabs **Pending**, **Accepted**, **Revoked**; actions **Resend** and **Revoke**). Groups cannot be assigned at invitation time.

To make invitations the only way to get an account, turn **Enable self registration** off in the **General** section of `/orgs/{orgId}/portal/settings/login-page` and click **Publish**.

### 5. Update, deactivate, block, delete

```bash
lumo users update <user-id> --given-name Jane --family-name Doe
lumo users update <user-id> --active=false     # deactivate: the account stays, sign-in is refused
lumo users block <user-id>                     # block until an admin unblocks
lumo users unblock <user-id>
lumo users delete <user-id>                    # irreversible
```

`lumo users update` flags: `--name`, `--email`, `--given-name`, `--family-name`, `--phone`, `--picture`, `--active`, `--verified`. The API equivalent is `PATCH /admin/users/{userId}` with `name`, `givenName`, `familyName`, `phoneNumber`, `picture`, `locale`, `zoneinfo`, `isActive`, `email`, `emailVerified`.

Know these rules before you run a change:

- **State is three flags, not one status.** `isActive`, `blocked` and `emailVerified`. Active = `isActive: true` and `blocked: false`. Inactive = `isActive: false`. Blocked = `blocked: true`.
- **Block, deactivate and delete end access.** The user's sessions end on the next request, and access and refresh tokens are revoked.
- **Delete is permanent.** It erases the user's tokens, sessions, consents and invitations, and pseudonymises the audit rows. Confirm with the user first. To suspend access and keep the account, block or deactivate.
- **Changing `email` through the API** signs the user out everywhere and sets `emailVerified` to `false` unless the request also sends `"emailVerified": true`. The account that created the organization cannot be given a new email this way (`409`).
- **Privilege check.** Setting a password, changing the email, activating, deactivating, blocking and deleting return `403` when the target user holds a permission that the caller (or the creator of the API key) does not hold.
- **MFA cannot be switched off for a user.** `POST /admin/users/{userId}/mfa/reset` returns `410 Gone`. For a locked-out user see `lumoauth-mfa-passkeys` (`lumo users tap`, `lumo users authenticators`).

### 6. Sessions

```bash
lumo sessions list                      # every active session in the organization
lumo sessions list --user <user-id>     # one user's sessions
lumo sessions revoke <session-id>       # one session; the ID is an integer such as 1544
lumo sessions revoke-all --user <user-id>
```

Sign out every user in the organization (for example after an incident). The body must contain `"confirm": true`:

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/sessions/revoke-all" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

Revoking one session keeps the user's OAuth tokens. Revoking all sessions of a user or of the organization, and blocking, deactivating or deleting a user, also revokes the access and refresh tokens. The full table is in [references/admin-api.md](references/admin-api.md).

A resource server that only verifies the JWT signature locally keeps accepting a revoked access token until the token expires. Where this matters, introspect the token (see `lumoauth-api-protection`).

Session timeout (seconds of inactivity, 300 to 2592000, default 1209600):

```bash
lumo settings update authentication --set session_timeout=86400
```

Access and refresh token lifetimes are set per application, not here (see `lumoauth-oauth-oidc`).

### 7. The current principal: `GET /me`

Use this from an app that holds the user's access token. It does not accept an API key.

```ts
type Me =
  | { subject_type: "user"; id: string; email?: string; name?: string; roles?: string[]; tenant: { id: string; slug: string; name: string } }
  | { subject_type: "agent"; id: string; agent_id: string; name: string; capabilities: string[]; tenant: { id: string; slug: string; name: string } };

export async function getMe(accessToken: string): Promise<Me> {
  const res = await fetch("https://app.lumoauth.dev/orgs/acme-corp/api/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
  return (await res.json()) as Me;
}
```

`subject_type`, `id` and `tenant` are always present. A user token gets only the fields that its scopes cover: `profile` (names, `picture`, `locale`, `zoneinfo`, `created_at`, `updated_at`), `email` (`email`, `email_verified`), `phone` (`phone_number`), `authz:read` (`roles`, `groups`, `mfa_enabled`, `last_login_at`).

### 8. Build a user-management screen in the customer's app

Put the Admin API key on the server. The browser calls the app's own backend, and the backend calls LumoAuth.

```ts
// server/lumo-admin.ts  (server-only module; never import it from client code)
const BASE = process.env.LUMOAUTH_URL ?? "https://app.lumoauth.dev";
const ORG = process.env.LUMOAUTH_ORG_ID;
const KEY = process.env.LUMOAUTH_API_KEY;

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!ORG || !KEY) throw new Error("LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY must be set");
  const res = await fetch(`${BASE}/orgs/${ORG}/api/v1/admin${path}`, {
    method,
    headers: {
      Authorization: `ApiKey ${KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error}: ${json.message}`);
  return json as T;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  blocked: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

export const listUsers = (search: string, page: number) =>
  admin<{ data: UserRow[]; meta: { total: number; page: number; totalPages: number } }>(
    "GET",
    `/users?${new URLSearchParams({ search, page: String(page), limit: "25" })}`,
  );

export const blockUser = (userId: string) => admin("POST", `/users/${encodeURIComponent(userId)}/block`);
export const unblockUser = (userId: string) => admin("POST", `/users/${encodeURIComponent(userId)}/unblock`);
export const signOutUser = (userId: string) => admin("POST", `/users/${encodeURIComponent(userId)}/sessions/revoke`);
```

Rules for this screen:

1. Authenticate the caller of each backend route with the app's own sign-in, then check a permission before the Admin API call (for example with `lumoauth-rbac`). The API key can reach every user in the organization; the backend route is the only gate.
2. Use a key with the smallest scope set: `admin:users:read` for a read-only list, add `admin:users:write` and `admin:sessions:write` only for the actions that the screen offers.
3. Never return the API key, and never pass user input into the path without `encodeURIComponent`.
4. Do not log request headers.

## Verify

- `lumo users get <user-id-or-email> -o json` shows the expected `isActive`, `blocked`, `emailVerified`, `roles` and `groups`.
- After a block: a sign-in attempt by that user is refused, and `lumo users get` shows `"blocked": true`.
- After a session revoke: the user's browser asks for a sign-in on the next request.
- `GET /me` with a user access token returns `subject_type: "user"` and the expected `tenant.slug`.
- The audit log has the matching entries (`lumo logs list --user <user-id>`); see `lumoauth-audit-compliance`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `401` on `GET /me` with an `lmk_` key | `/me` accepts OAuth access tokens only | Send the user's or agent's access token as `Bearer` |
| `403` with `details.required_scopes` | The API key lacks the scope | Create a key with the scope from the table above |
| `403` on block, delete or set password | The target holds permissions that the caller lacks | Use a credential whose owner holds the same permissions |
| `400` on create with a password | Password policy or breached-password check failed | Leave `password` out and send a reset email |
| `400 confirm: true is required` | Organization-wide revoke without the confirmation body | Send `{"confirm": true}` |
| `/me` returns no `email` or `roles` | The token lacks `email` or `authz:read` | Request the scopes at sign-in |
| Code reads `user.status` or `isBlocked` | The user object has `isActive` and `blocked` | Derive the state from the two flags |
| Looking for a sessions tab in the portal | Admins list sessions through the API or CLI | Use `lumo sessions list --user` |
| Revoked user still calls an API | The API verifies JWTs locally and does not see the revocation | Introspect tokens, or use short access token lifetimes |
| API key in frontend code | Any visitor can read it and manage every user | Move the call to the backend and rotate the key |

## Related skills

- `lumoauth-admin-api`: API keys, scopes, pagination, errors, generated clients.
- `lumoauth-cli`: install and sign in to `lumo`, profiles, `lumo api`.
- `lumoauth-rbac`: roles, groups and permissions that users receive.
- `lumoauth-mfa-passkeys`: authenticators, temporary access codes, MFA policy.
- `lumoauth-b2b-saas`: customer organizations, their members and invitations.
- `lumoauth-scim`: create and remove users from an identity provider.
- `lumoauth-audit-compliance`: audit log of user and session events, data export and erasure.

## References

- [Admin API endpoints for users and sessions](references/admin-api.md): open it when you need an endpoint, scope, body field or the user object that is not shown above.
- [Account self-service pages](references/self-service.md): open it when the user asks what end users can do in their own account, or where a self-service page is.
- [Progressive profiling, sign-up fields and traits](references/profiling-and-traits.md): open it when the task is to collect extra profile data or to store custom attributes on users.
- https://docs.lumoauth.dev/user-guide/user-management/overview
- https://docs.lumoauth.dev/user-guide/user-management/invitations
- https://docs.lumoauth.dev/user-guide/user-management/sessions
- https://docs.lumoauth.dev/api-reference/users
- https://docs.lumoauth.dev/api-reference/sessions
- https://docs.lumoauth.dev/api-reference/me
