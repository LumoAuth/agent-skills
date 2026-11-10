# Admin API: customer organizations

All paths are relative to `{base}/orgs/{orgId}/api/v1`.

- `{orgId}`: slug of the LumoAuth organization (the SaaS vendor's), for example `acme-corp`.
- `{organizationId}`: UUID or slug of the customer organization, for example `globex`.
- `{userId}`: ID of a user of the LumoAuth organization.

Authenticate with `Authorization: ApiKey lmk_...` or `X-API-Key: lmk_...`, from a server only. Each endpoint checks the scope of the credential and a permission. For an API key, the user who created the key must still hold the permission.

## Endpoints

### Customer organizations

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/organizations` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations` | `organizations.create` | `admin:users:write` |
| GET | `/admin/organizations/{organizationId}` | `organizations.view` | `admin:users:read` |
| PUT, PATCH | `/admin/organizations/{organizationId}` | `organizations.edit` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}` | `organizations.delete` | `admin:users:write` |

List query parameters: `page`, `limit` (default 25, maximum 100), `search`, `isActive` (`true` or `false`).

Create and update body:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required on create |
| `slug` | string | Optional on create |
| `displayName` | string | Shown to users; used for the `org_name` claim when set |
| `description` | string | |
| `logoUrl` | string | |
| `metadata` | object | Free-form JSON for the app's own references |
| `isActive` | boolean | `false` deactivates the customer organization |

Customer organization object (inside `data`):

```json
{
  "id": "0193b7c2-5d1e-7c44-9a3e-1f6f0f2d9b11",
  "slug": "globex",
  "name": "Globex",
  "displayName": null,
  "description": null,
  "logoUrl": null,
  "isActive": true,
  "memberCount": 3,
  "metadata": { "customer_ref": "cus_1042" },
  "createdAt": "2026-10-01T09:00:00+00:00",
  "updatedAt": null
}
```

Responses: create returns `201` with `data` and `"message": "Organization created"`. Delete returns `{ "message": "Organization deleted" }`. `409` on create or update means that the data is invalid or conflicts with an existing record (for example a slug that is taken).

Deleting a customer organization removes its memberships, roles and invitations. The user accounts stay. Confirm with the user before a delete; prefer `{"isActive": false}` when the customer may come back.

### Members

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/organizations/{organizationId}/members` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations/{organizationId}/members` | `organizations.members.manage` | `admin:users:write` |
| PUT, PATCH | `/admin/organizations/{organizationId}/members/{userId}` | `organizations.members.manage` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}/members/{userId}` | `organizations.members.manage` | `admin:users:write` |

List query parameters: `page`, `limit`, `search` (substring of the member's email or name), `status` (`active` or `suspended`).

Add body: `{"userId": "<user id>", "roleId": <role id>}`. `userId` is required. Without `roleId` the member gets the default role of the customer organization.

Update body: `{"roleId": <role id>}` and/or `{"status": "active" | "suspended"}`.

Member object:

```json
{
  "id": 41,
  "user": { "id": "019d6190-9bba-7b5f-a0a5-07a6d10184d2", "email": "pat@example.com", "name": "Pat Lee" },
  "role": { "id": 12, "slug": "admin", "name": "Admin" },
  "status": "active",
  "joinedAt": "2026-10-01T09:05:00+00:00"
}
```

Errors:

| Status | Meaning |
|---|---|
| `403` | Missing permission, or an attempt to grant the owner role by a caller who is not an owner of that customer organization or an organization admin |
| `404` | Customer organization, user, member or role not found. A role of another customer organization counts as not found. |
| `409` | The user is already a member |
| `400` | Unknown `status` value |
| `422` | The change is not allowed, for example suspending the last owner |

Removing a member does not delete or change the user account.

### Member roles

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/organizations/{organizationId}/roles` | `organizations.view` | `admin:roles:read` |
| POST | `/admin/organizations/{organizationId}/roles` | `organizations.edit` | `admin:roles:write` |
| PUT, PATCH | `/admin/organizations/{organizationId}/roles/{roleId}` | `organizations.edit` | `admin:roles:write` |
| DELETE | `/admin/organizations/{organizationId}/roles/{roleId}` | `organizations.edit` | `admin:roles:write` |

Create body: `name` and `slug` are required; `description` and `isDefault` are optional. Update body: `name`, `description`, `isDefault`.

Role object:

```json
{
  "id": 12,
  "slug": "admin",
  "name": "Admin",
  "description": null,
  "isDefault": false,
  "isOwner": false,
  "isSystem": true
}
```

Every customer organization starts with the system roles `owner`, `admin` and `member`. `member` is the default. The role slug is the value of the `org_role` claim. `409` on create means that a role with this name or slug exists.

These roles are separate from the roles of the LumoAuth organization (`/admin/roles`, see `lumoauth-rbac`).

### Invitations

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/organizations/{organizationId}/invitations` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations/{organizationId}/invitations` | `organizations.invitations.manage` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}/invitations/{invId}` | `organizations.invitations.manage` | `admin:users:write` |
| POST | `/admin/organizations/{organizationId}/invitations/{invId}/resend` | `organizations.invitations.manage` | `admin:users:write` |

List query parameter: `status`.

Create body:

| Field | Type | Notes |
|---|---|---|
| `email` | string | Required |
| `roleId` | integer | Optional. Must be a role of this customer organization (`400` otherwise). |
| `message` | string | Optional personal message for the email |
| `skipEmail` | boolean | Optional. `true` creates the invitation without sending the email. |

Invitation object (create returns `201` with `"message": "Invitation sent"`):

```json
{
  "id": 7,
  "email": "pat@example.com",
  "role": { "id": 12, "slug": "admin" },
  "status": "pending",
  "invitedBy": "019d6190-9bba-7b5f-a0a5-07a6d10184d2",
  "createdAt": "2026-10-01T09:00:00+00:00",
  "expiresAt": "2026-10-08T09:00:00+00:00"
}
```

An invitation expires after 7 days.

## Membership lookup from the backend

Use this when the access token carries no `org_*` claims, or to re-check a membership before a sensitive action. The function reads the Admin API key from the environment and must run on the server only.

```ts
// membership.ts — server only. Reads the Admin API key from the environment.
const BASE = process.env.LUMOAUTH_URL ?? "https://app.lumoauth.dev";

export async function activeRole(organizationId: string, email: string): Promise<string | null> {
  const org = process.env.LUMOAUTH_ORG_ID;
  const key = process.env.LUMOAUTH_API_KEY;
  if (!org || !key) throw new Error("LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY must be set");

  const url =
    `${BASE}/orgs/${org}/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/members?` +
    new URLSearchParams({ search: email, status: "active" });
  const res = await fetch(url, { headers: { Authorization: `ApiKey ${key}` } });
  if (!res.ok) throw new Error(`Member lookup failed: ${res.status}`);

  const body = (await res.json()) as {
    data: { user: { id: string; email: string }; role: { slug: string } | null; status: string }[];
  };
  const match = body.data.find((m) => m.user.email.toLowerCase() === email.toLowerCase());
  return match?.role?.slug ?? null;
}
```

`search` matches a substring of the email or name, so the function compares the email exactly. A suspended member is filtered out by `status=active`. A deactivated customer organization still lists its members: check `isActive` on the customer organization as well (`GET /admin/organizations/{organizationId}`).

## Portal pages

| Page | Path |
|---|---|
| Customer organizations list | `/orgs/{orgId}/portal/organizations` |
| One customer organization (tabs **Members**, **Roles**, **Pending invitations**, **Settings**) | Opened from the list |
| Customer portal for members | `/b2b/{orgId}/{organizationSlug}/` |
| A user's own memberships | `/account/organizations` |

In the admin portal: **New organization** creates one; **Invite member** sends an invitation; the **Members** tab removes members; the **Roles** tab is read-only; the **Settings** tab holds the display name, logo URL, description and the **Active** switch. Adding an existing user directly, changing a member's role and creating roles are done in the customer portal or through the Admin API.

An owner can deactivate their customer organization from the customer portal (**Organization → Settings**, **Danger zone**). Only an admin of the LumoAuth organization can reactivate it, from the admin portal or the Admin API.

## Events

Webhook and audit events: `organization.created`, `organization.updated`, `organization.deleted`, `organization.member.added`, `organization.member.updated`, `organization.member.removed`, `organization.invitation.accepted`.

## Sign-in behaviour by application setting

| **Who can sign in** | User without a membership | User with one or more memberships |
|---|---|---|
| **Everyone** | Signs in; no customer organization is selected | One customer organization is selected (automatically, by `organization=<slug>`, or in the selector) |
| **Individual users only** | Signs in | Refused ("Access denied") |
| **Customer organization members only** | Refused ("Access denied") | One customer organization is selected |

Only active memberships of active customer organizations count.
