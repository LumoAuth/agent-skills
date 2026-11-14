# Admin API: users, sessions and tokens

All paths are relative to `{base}/orgs/{orgId}/api/v1`. `{base}` is `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Authenticate with `Authorization: ApiKey lmk_...` (or `X-API-Key: lmk_...`), or with a Bearer access token that carries the listed scope. Call these endpoints from a server only.

Each endpoint checks the scope of the credential and a permission. For an API key, the user who created the key must still hold the permission.

## Users

| Method | Path | Permission | Scope | Notes |
|---|---|---|---|---|
| GET | `/admin/users` | `users.view` | `admin:users:read` | List. Query parameters below. |
| GET | `/admin/users/{userId}` | `users.view` | `admin:users:read` | Detailed user object. |
| POST | `/admin/users` | `users.create` | `admin:users:write` | `email` required. Returns `201`. |
| PUT, PATCH | `/admin/users/{userId}` | `users.edit` | `admin:users:write` | Only the fields that are sent change. |
| DELETE | `/admin/users/{userId}` | `users.delete` | `admin:users:write` | Irreversible. |
| POST | `/admin/users/{userId}/block` | `users.edit` | `admin:users:write` | |
| POST | `/admin/users/{userId}/unblock` | `users.edit` | `admin:users:write` | |
| PUT, POST | `/admin/users/{userId}/password` | `users.edit` | `admin:users:write` | Body `{"password": "..."}`. Must meet the password policy. A person calling it needs a recent sign-in (Bearer token from the last 10 minutes, `X-MFA-Challenge` with an approved step-up challenge when they hold a second factor); API keys are exempt. |
| POST | `/admin/users/{userId}/password-reset` | `users.edit` | `admin:users:write` | Sends the reset email. |
| POST | `/admin/users/{userId}/verify-email` | `users.edit` | `admin:users:write` | Sends a new verification link. Sends nothing when the address is already verified, and still returns `200`. |
| POST | `/admin/users/{userId}/mark-verified` | `users.edit` | `admin:users:write` | Marks the address verified without an email. |
| GET | `/admin/users/{userId}/roles` | `users.view` | `admin:users:read` | |
| PUT | `/admin/users/{userId}/roles` | `users.edit` | `admin:users:write` | Replaces the set. Body `{"roles": ["slug", ...]}`. |
| POST | `/admin/users/{userId}/roles` | `users.edit` | `admin:users:write` | Adds one. Body `{"roleId": 17}` or `{"roleSlug": "viewer"}`. |
| DELETE | `/admin/users/{userId}/roles/{roleId}` | `users.edit` | `admin:users:write` | `{roleId}` is the integer ID. |
| GET | `/admin/users/{userId}/groups` | `users.view` | `admin:users:read` | |
| PUT | `/admin/users/{userId}/groups` | `users.edit` | `admin:users:write` | Replaces the set. Body `{"groups": ["slug", ...]}`. |
| POST | `/admin/users/{userId}/groups` | `users.edit` | `admin:users:write` | Adds one. Body `{"groupId": 5}` or `{"groupSlug": "engineering"}`. |
| DELETE | `/admin/users/{userId}/groups/{groupId}` | `users.edit` | `admin:users:write` | |
| GET | `/admin/users/{userId}/permissions` | `users.view` | `admin:users:read` | Direct permissions. |
| POST | `/admin/users/{userId}/permissions` | `users.edit` | `admin:users:write` | Body `{"permissionId": 12}`. |
| DELETE | `/admin/users/{userId}/permissions/{permissionId}` | `users.edit` | `admin:users:write` | |
| POST | `/admin/users/{userId}/mfa/reset` | - | - | Removed. Always returns `410 Gone`. Use `lumoauth-mfa-passkeys`. |

Role, group and permission design belongs to `lumoauth-rbac`. Federated identities of a user (`/admin/users/{userId}/identities`) belong to `lumoauth-enterprise-sso`.

### List query parameters

| Parameter | Description |
|---|---|
| `page` | Page number, default 1 |
| `limit` | Rows per page, default 25, maximum 100 |
| `search` | Matches email, name or username |
| `active` | `true` or `false` |
| `blocked` | `true` or `false` |
| `emailVerified` | `true` or `false` |
| `mfaEnabled` | `true` or `false` |
| `role` | Role slug |
| `group` | Group slug |
| `sortBy` | `email`, `name`, `username`, `createdAt` or `lastLoginAt` |
| `sortDir` | `ASC` or `DESC` (default `DESC`) |

List response:

```json
{
  "data": [
    {
      "id": "019d6190-9bba-7b5f-a0a5-07a6d10184d2",
      "email": "jane@example.com",
      "username": "jane@example.com",
      "name": "Jane Smith",
      "givenName": "Jane",
      "familyName": "Smith",
      "picture": null,
      "emailVerified": true,
      "phoneNumber": null,
      "phoneNumberVerified": false,
      "isActive": true,
      "blocked": false,
      "mfaEnabled": false,
      "isAdmin": false,
      "createdAt": "2026-01-15T10:30:00Z",
      "lastLoginAt": "2026-04-10T09:15:00Z",
      "loginCount": 12
    }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "limit": 25,
    "totalPages": 6,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

The single-user response (`GET /admin/users/{userId}`) wraps the object in `data` and adds `roles` and `groups` (arrays of `{ "id", "name", "slug" }` objects), `locale`, `zoneinfo`, `updatedAt`, `blockedAt`, `isJitProvisioned`, `jitProvisionedBy` and `socialProvider`.

`mfaEnabled` is read-only. It is `true` when the user holds one or more active sign-in methods.

### Create body

| Field | Type | Notes |
|---|---|---|
| `email` | string | Required. Stored in lower case. |
| `username` | string | Defaults to the email. |
| `name`, `givenName`, `familyName` | string | |
| `phoneNumber` | string | Profile phone number. Text-message MFA uses the number that the user verified at enrollment, not this field. |
| `password` | string | Optional. Must meet the organization's password policy. |
| `isActive` | boolean | Default `true`. |
| `emailVerified` | boolean | Default `false`. |
| `roles` | string[] | Role slugs. |
| `groups` | string[] | Group slugs. |

### Update body

`name`, `givenName`, `familyName`, `phoneNumber`, `picture`, `locale`, `zoneinfo`, `isActive`, `email`, `emailVerified`, `password`.

- A changed `email` or `password` signs the user out of every session and revokes the user's tokens.
- A changed `email` is unverified unless the same request sends `"emailVerified": true`.
- `409`: the new email belongs to another user, or the target is the account that created the organization.
- `403`: the target holds a permission that the caller does not hold (applies to `email`, `password` and `isActive`).

### Error format

```json
{
  "error": "forbidden",
  "message": "…",
  "status": 403,
  "details": { "required_permissions": ["users.edit"] }
}
```

## Sessions

Session and token IDs are integers (for example `1544`).

| Method | Path | Permission | Scope | Notes |
|---|---|---|---|---|
| GET | `/admin/sessions` | `users.view` | `admin:sessions:read` | Active sessions only. Query: `page`, `limit`, `userId` (user ID or email). |
| GET | `/admin/users/{userId}/sessions` | `users.view` | `admin:sessions:read` | All active sessions of one user in one page. |
| DELETE | `/admin/sessions/{sessionId}` | `users.edit` | `admin:sessions:write` | Revokes one session. |
| DELETE | `/admin/users/{userId}/sessions` | `users.edit` | `admin:sessions:write` | Revokes all sessions of one user. |
| POST | `/admin/users/{userId}/sessions/revoke` | `users.edit` | `admin:sessions:write` | Same as the DELETE form. |
| POST | `/admin/sessions/revoke-all` | `users.edit` | `admin:sessions:write` | Every session in the organization. Body `{"confirm": true}` is required. |
| GET | `/admin/sessions/stats` | `users.view` | `admin:sessions:read` | `data.total`, `data.active`, `data.inactive`. |
| GET | `/admin/sessions/count` | `users.view` | `admin:sessions:read` | `data.count`. |

Session object:

```json
{
  "id": 1544,
  "userId": "019d6190-9bba-7b5f-a0a5-07a6d10184d2",
  "userEmail": "jane@example.com",
  "ipAddress": "203.0.113.45",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "createdAt": "2026-03-01T08:00:00Z",
  "lastActivityAt": "2026-03-01T09:30:00Z",
  "expiresAt": "2026-03-02T08:00:00Z",
  "isActive": true
}
```

## OAuth tokens

| Method | Path | Permission | Scope | Notes |
|---|---|---|---|---|
| GET | `/admin/tokens` | `users.view` | `admin:sessions:read` | Query: `page`, `limit`, `userId`, `clientId`, `revoked`. |
| DELETE | `/admin/tokens/{tokenId}` | `users.edit` | `admin:sessions:write` | Revokes one token. |
| DELETE | `/admin/users/{userId}/tokens` | `users.edit` | `admin:sessions:write` | Revokes all tokens of one user. |
| POST | `/admin/users/{userId}/tokens/revoke` | `users.edit` | `admin:sessions:write` | Same as the DELETE form. |
| DELETE | `/admin/clients/{clientId}/tokens` | `clients.edit` | `admin:sessions:write` | Revokes all tokens of one application. |
| POST | `/admin/clients/{clientId}/tokens/revoke` | `clients.edit` | `admin:sessions:write` | Same as the DELETE form. |

CLI: `lumo tokens list [--user <id>] [--client <id>]`, `lumo tokens revoke <token-id>`.

## Session timeout

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/settings/authentication` | `settings.view` | `admin:settings:read` |
| PATCH, PUT | `/admin/settings/authentication` | `settings.manage` | `admin:settings:write` |

```bash
curl -s -X PATCH "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/settings/authentication" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_timeout": 86400}'
```

`session_timeout` is the number of seconds without activity after which a login session ends. Range 300 to 2592000. The same timeout ends "Remember me": after that much inactivity on all of the user's sessions, the remembered browser asks for a sign-in again.

## What each action revokes

| Action | Sessions | Remember-me cookies | OAuth access and refresh tokens |
|---|---|---|---|
| User signs out of a browser that used "Remember me" | That browser's session | All of the user's | Kept |
| User revokes one session at `/account/sessions` | The chosen one | All of the user's | Kept |
| User signs out of all other devices | All other sessions | All of the user's | All of the user's |
| Admin revokes one session | The chosen one | All of the affected user's | Kept |
| Admin revokes a user's sessions or all organization sessions | All of the affected users' | All | All of the affected users' |
| Password change, password reset, or an admin sets the password | Other sessions (all after a reset or an admin set) | All | All of the user's |
| Admin blocks, deactivates or deletes the user; SCIM deprovisions the user | All (ended on the next request) | All | All of the user's |
| Recovery code used at sign-in | Every other session and trusted device | All | All of the user's |

"All of the user's tokens" includes access tokens that are already issued: LumoAuth's own APIs reject them, introspection returns `{"active": false}` and userinfo rejects them. A blocked, deactivated or deleted user cannot redeem a refresh token (`invalid_grant`).

## CLI summary

```text
lumo users list [--search] [--role] [--group] [--blocked] [--page] [--limit] [--sort]
lumo users get <user-id-or-email>
lumo users create --email <email> [--name] [--given-name] [--family-name] [--username]
                  [--password] [--phone] [--roles a,b] [--groups a,b] [--verified]
lumo users update <user-id> [--name] [--email] [--given-name] [--family-name] [--phone]
                  [--picture] [--active=true|false] [--verified=true|false]
lumo users delete <user-id>
lumo users block <user-id>
lumo users unblock <user-id>
lumo users set-password <user-id> --password <password>
lumo users roles get <user-id>
lumo users roles set <user-id> --roles a,b        # replaces the set
lumo users groups get <user-id>
lumo users groups set <user-id> --groups a,b      # replaces the set
lumo sessions list [--user <user-id>] [--page]
lumo sessions revoke <session-id>
lumo sessions revoke-all --user <user-id>
lumo tokens list [--user <user-id>] [--client <client-id>]
lumo tokens revoke <token-id>
```

Global flags: `--org`, `--profile`, `-o table|json|yaml`. For an endpoint without a command, use `lumo api`, where the path is relative to the Admin API:

```bash
lumo api POST /users/019d6190-9bba-7b5f-a0a5-07a6d10184d2/password-reset
lumo api POST /sessions/revoke-all --data '{"confirm": true}'
```
