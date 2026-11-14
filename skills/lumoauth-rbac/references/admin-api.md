# Admin API routes for permissions, roles and groups

Use these routes when the task must use HTTP instead of the `lumo` CLI, for example in a seed script or a pipeline. For API keys, pagination and error shapes in general use `lumoauth-admin-api`.

- Base path: `{base}/orgs/{orgId}/api/v1/admin`, for example `https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin`.
- Credential: an organization API key in the `X-API-Key` header, or a user access token as `Authorization: Bearer <token>` that carries the scope in the table.
- Every route needs the scope **and** the permission. For an API key, the permission is checked against the user who created the key.
- `{roleId}` and `{groupId}` accept the slug or the numeric ID. `{userId}` is the user's UUID.
- Show every request that creates, changes or deletes something to the user before you send it.

## Permissions

| Method and path | Scope | Permission | Body |
|---|---|---|---|
| `GET /permissions` | `admin:permissions:read` | `roles.view` | Query: `page`, `limit`, `search`, `resource` |
| `GET /permissions/{permissionId}` | `admin:permissions:read` | `roles.view` | |
| `POST /permissions` | `admin:permissions:write` | `roles.assign-permissions` | `name` and `slug` required. Optional `description`, `resource`, `action` |
| `PATCH /permissions/{permissionId}` | `admin:permissions:write` | `roles.assign-permissions` | `name`, `description` |
| `DELETE /permissions/{permissionId}` | `admin:permissions:write` | `roles.assign-permissions` | |
| `GET /permissions/{permissionId}/usage` | `admin:permissions:read` | `roles.view` | |

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/permissions" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Edit reports","slug":"reports.edit","resource":"reports","action":"edit"}'
```

Answers: `201` with `data` (the permission, including its numeric `id`), `400` for an invalid or reserved slug, `409` when the slug exists.

## Roles

| Method and path | Scope | Permission | Body |
|---|---|---|---|
| `GET /roles` | `admin:roles:read` | `roles.view` | Query: `page`, `limit`, `search`, `isSystem` |
| `GET /roles/{roleId}` | `admin:roles:read` | `roles.view` | |
| `POST /roles` | `admin:roles:write` | `roles.create` | `name` required. Optional `slug`, `description`, `permissions` (permission slugs) |
| `PATCH /roles/{roleId}` | `admin:roles:write` | `roles.edit` | `name`, `description` only |
| `DELETE /roles/{roleId}` | `admin:roles:write` | `roles.delete` | |
| `GET /roles/{roleId}/permissions` | `admin:roles:read` | `roles.view` | |
| `PUT /roles/{roleId}/permissions` | `admin:roles:write` | `roles.assign-permissions` and `roles.edit` | `{"permissions": ["reports.view", "reports.edit"]}`: replaces the full set, values are slugs |
| `POST /roles/{roleId}/permissions` | `admin:roles:write` | `roles.assign-permissions` and `roles.edit` | `{"permissionId": 12}` or `{"permissionIds": [12, 13]}`: adds, values are numeric IDs |
| `DELETE /roles/{roleId}/permissions/{permissionId}` | `admin:roles:write` | `roles.assign-permissions` and `roles.edit` | |
| `GET /roles/{roleId}/users` | `admin:roles:read` | `roles.view` | |
| `POST /roles/{roleId}/users` | `admin:roles:write` | `roles.edit` | `{"userId": "<uuid>"}` |
| `DELETE /roles/{roleId}/users/{userId}` | `admin:roles:write` | `roles.edit` | |

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/roles" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Editor","description":"Read and edit reports","permissions":["reports.view","reports.edit"]}'

curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/roles/editor/permissions" \
  -H "X-API-Key: $LUMO_API_KEY"
```

Behaviour to plan for:

- Without `slug`, the server derives it from `name`. A reserved role slug gets `400`, an existing one `409`.
- A permission that the acting administrator does not hold is not attached, and the response is still a success. On `PUT`, permissions that the administrator cannot grant and that the role already has are kept. Always read the role's permissions back and compare.
- The permissions of a system role cannot be changed.

## User roles and groups

| Method and path | Scope | Permission | Body |
|---|---|---|---|
| `GET /users/{userId}/roles` | `admin:users:read` | `users.view` | |
| `PUT /users/{userId}/roles` | `admin:users:write` | `users.edit` | `{"roles": ["editor", "auditor"]}`: replaces the full set, values are role slugs |
| `POST /users/{userId}/roles` | `admin:users:write` | `users.edit` | `{"roleSlug": "editor"}` or `{"roleId": "12"}`: adds one role |
| `DELETE /users/{userId}/roles/{roleId}` | `admin:users:write` | `users.edit` | |
| `GET /users/{userId}/groups` | `admin:users:read` | `users.view` | |
| `PUT /users/{userId}/groups` | `admin:users:write` | `users.edit` | `{"groups": ["finance"]}`: replaces the full set |
| `POST /users/{userId}/groups` | `admin:users:write` | `users.edit` | `{"groupSlug": "finance"}` or `{"groupId": "7"}` |
| `DELETE /users/{userId}/groups/{groupId}` | `admin:users:write` | `users.edit` | |
| `GET /users/{userId}/permissions` | `admin:users:read` | `users.view` | |

The server answers `403` when the assignment would give more than the acting administrator holds: the administrator must hold every permission in the role.

## Groups

| Method and path | Scope | Permission | Body |
|---|---|---|---|
| `GET /groups` | `admin:groups:read` | `groups.view` | Query: `page`, `limit`, `search` |
| `GET /groups/{groupId}` | `admin:groups:read` | `groups.view` | |
| `POST /groups` | `admin:groups:write` | `groups.create` | `name` required. Optional `slug`, `description`, `roles` (role slugs) |
| `PATCH /groups/{groupId}` | `admin:groups:write` | `groups.edit` | `name`, `description` |
| `DELETE /groups/{groupId}` | `admin:groups:write` | `groups.delete` | |
| `GET /groups/{groupId}/members` | `admin:groups:read` | `groups.view` | |
| `POST /groups/{groupId}/members` | `admin:groups:write` | `groups.edit` | `{"userId": "<uuid>"}` or `{"userIds": ["<uuid>", "<uuid>"]}`. A value can be a user's email |
| `DELETE /groups/{groupId}/members/{userId}` | `admin:groups:write` | `groups.edit` | |
| `GET /groups/{groupId}/roles` | `admin:groups:read` | `groups.view` | |
| `PUT /groups/{groupId}/roles` | `admin:groups:write` | `groups.edit` | `{"roles": ["editor"]}`: replaces the full set, values are role slugs |
| `POST /groups/{groupId}/roles` | `admin:groups:write` | `groups.edit` | `{"roleId": 12}`: adds one role, numeric ID |
| `DELETE /groups/{groupId}/roles/{roleId}` | `admin:groups:write` | `groups.edit` | |

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/groups" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Finance","description":"Finance team","roles":["editor"]}'
```

## How permissions resolve

A user's effective permissions are the union of:

1. Permissions granted to the user directly.
2. Permissions of the roles that the user holds.
3. Permissions of the roles of every group that the user is in.

Custom permission slugs cannot contain `*`. Write each permission out.

## Errors

| Status | Meaning |
|---|---|
| `400` | A required field is missing, or the slug is invalid or reserved |
| `403 forbidden` with `details.required_scopes` | The credential lacks the scope |
| `403 forbidden` with `details.required_permissions` | The user (or the API key's creator) lacks the permission |
| `403` on an assignment | The assignment would give more access than the acting administrator holds |
| `404` | The role, group, permission or user is not in this organization |
| `409` | A role, group or permission with this slug exists |
