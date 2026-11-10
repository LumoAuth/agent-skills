---
name: lumoauth-rbac
description: >-
  Sets up role-based access control (RBAC) with LumoAuth: names permissions (resource.action
  slugs), creates custom permissions and roles, attaches permissions to roles, assigns roles to
  users and to groups, and checks a permission in application code. Covers the portal, the Admin
  API (/admin/permissions, /admin/roles, /admin/groups, /admin/users/{id}/roles), the lumo CLI
  (lumo permissions, lumo roles, lumo groups, lumo users roles set), the built-in Tenant Admin
  role, group inheritance, the roles claim in access tokens, and permissions.check / checkBulk /
  checkAny / checkAll in @lumoauth/backend, @lumoauth/client, @lumoauth/react (Protect,
  usePermission), Python, Go, PHP, .NET and Java. Use when the user asks for roles, permissions,
  admin versus member access, a role per team, group-based access, "can this user do X" checks,
  hiding buttons by permission, or a 403 for users who lack a role.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth roles, permissions and groups (RBAC)

Give users access by role. A permission names one action (`reports.edit`). A role is a named set of permissions. A user holds the permissions of every role that the user has, directly or through a group. This skill creates the permissions, roles and groups, assigns them, and adds the permission check to the application code.

## When to use

- The user wants roles such as admin, editor and viewer, or wants to check "may this user do X".
- The user wants to give a whole team the same access (groups).
- The application must hide or disable UI by permission and refuse the request on the server.

Do not use this skill for:

- Choosing between roles, attribute rules and relationships, or the rules of the check API: use `lumoauth-authorization` first.
- Rules that depend on time, IP address or a field on the user or resource: use `lumoauth-abac`.
- Access to one specific object (this document, this folder): use `lumoauth-rebac`.
- AI agents as the subject of a check: use `lumoauth-agent-identity` and `lumoauth-agent-approvals`.
- Roles inside a customer organization of a B2B product: use `lumoauth-b2b-saas`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL, for example `acme-corp` |
| Organization API key (`lmk_...`) | Portal: `/orgs/{orgId}/portal/settings/api-keys`. Shown once. Store it in an environment variable on the server |
| The list of actions that the application protects | From the user or from the application's routes |

The API key needs these scopes. Ask the user to create the key with only the scopes that the task needs.

| Task | API key scope | Permission that the key's creator must hold |
|---|---|---|
| Create permissions | `admin:permissions:write` | `roles.assign-permissions` |
| Create roles, set a role's permissions | `admin:roles:write` | `roles.create`, `roles.assign-permissions` |
| Assign roles to users | `admin:users:write` | `users.edit` |
| Create groups, add members and roles | `admin:groups:write` | `groups.create`, `groups.edit` |
| Check a permission for a user from a backend | `authz:check` | `policies.view` |

An API key acts as the user who created it. The key stops working for a task when its creator loses the permission for that task.

The `lumo` CLI reads `LUMO_ORG`, `LUMO_API_KEY` and `LUMO_BASE_URL`, or the `--org`, `--api-key` and `--base-url` flags. For installation and login use `lumoauth-cli`.

## Steps

### 1. Name the permissions

Write one permission per action, in the form `resource.action`:

```
reports.view
reports.edit
reports.delete
invoices.approve
```

Rules that the server applies to a custom permission slug:

- Lowercase letters and digits, with single dots, hyphens or underscores between them. At most 100 characters. No colon, no `*`.
- The slug cannot be changed after creation.
- The resource part must be the application's own. A slug that starts with one of these built-in resource names and a dot is reserved, and the API answers `400`: `abac`, `agents`, `analytics`, `audit`, `authz`, `billing`, `branding`, `clients`, `gdpr`, `groups`, `idps`, `jit`, `organizations`, `policies`, `roles`, `scim`, `settings`, `signing_keys`, `tenants`, `users`, `webhooks`, `zanzibar`. For example, name an application permission `workspaces.invite`, not `organizations.invite`.

Keep the list short. Start with the actions that the application really checks.

### 2. Create the permissions

Show these commands to the user before you run them. They change the organization.

```bash
lumo permissions create --slug reports.view --name "View reports"
lumo permissions create --slug reports.edit --name "Edit reports"
lumo permissions create --slug reports.delete --name "Delete reports"
lumo permissions list -o json
```

`--slug` is required. `--name` defaults to the slug. `--description` is optional. A new permission is held by nobody until a role carries it.

### 3. Create roles and attach permissions

```bash
lumo roles create --name "Viewer" --description "Read reports" --permissions reports.view
lumo roles create --name "Editor" --description "Read and edit reports" --permissions reports.view,reports.edit
lumo roles get editor -o json
```

The server derives the role slug from the name (`Editor` becomes `editor`). Read the slug from the JSON output. `lumo roles get` takes the slug or the numeric ID.

**Read the role back and compare its permissions with the list that you sent.** The API attaches a permission only when the administrator behind the credential holds that permission. A permission that this administrator cannot grant is left out, and the response is still a success. If a permission is missing, stop and tell the user that an administrator who holds the permission must attach it.

To change the permissions of a role later, replace the full set. `lumo roles update --permissions` does not change them (the server reads only the name and description on that call), so use the Admin API route through `lumo api`:

```bash
lumo api PUT /roles/editor/permissions --data '{"permissions":["reports.view","reports.edit","reports.delete"]}'
lumo api GET /roles/editor/permissions
```

Changing the permissions of a role needs the `roles.assign-permissions` permission. System roles cannot be changed.

### 4. Assign roles to users

```bash
lumo users roles get 0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20
lumo users roles set 0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20 --roles editor
```

`lumo users roles set` replaces the user's full set of roles with the role slugs that you pass. Read the current roles first and include the ones that must stay. To add one role without touching the others:

```bash
lumo api POST /users/0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20/roles --data '{"roleSlug":"editor"}'
```

Find a user ID with `lumo users list --search` or `lumo users get <user-id-or-email>`. `lumo users create` also takes `--roles` and `--groups`.

The server refuses an assignment that gives more access than the administrator holds: the administrator must hold every permission in the role (`403`). The built-in Tenant Admin role (slug `tenant_admin`) can be assigned only by an administrator who already holds a system role.

### 5. Use groups for teams (optional)

A group gives every member the roles of the group. Use a group when several users need the same roles.

```bash
lumo groups create --name "Finance" --description "Finance team"
lumo groups list -o json
lumo api PUT /groups/finance/roles --data '{"roles":["editor"]}'
lumo groups members add finance --users 0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20
lumo groups members list finance
```

- `PUT /groups/{group}/roles` replaces the group's roles with the role slugs that you pass.
- `lumo groups members add` takes user IDs or emails, comma-separated.
- To remove one member, call `lumo api DELETE /groups/finance/members/{userId}`. The `lumo groups members remove` command does not send the user to the server.
- Read the group slug from the JSON output of `lumo groups create` or `lumo groups list`.

A group that carries the Tenant Admin role makes every member an administrator. Do not put that role on a group that an identity provider or SCIM manages. The server refuses it.

### 6. Check the permission on the server

The server check is the real one. Put it in the request handler or middleware of every protected action, after the access token of the request has been verified (see `lumoauth-api-protection`).

The backend asks LumoAuth about the signed-in user with an API key that has the `authz:check` scope. Pass the user's LumoAuth ID, which is the `sub` claim of the verified access token.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!, // https://app.lumoauth.dev
  secretKey: process.env.LUMOAUTH_API_KEY!, // lmk_..., scope authz:check
});

export async function userMay(userId: string, permission: string): Promise<boolean> {
  try {
    return await lumo.permissions.check(permission, undefined, { userId });
  } catch (error) {
    console.error('LumoAuth permission check failed', error);
    return false; // fail closed
  }
}

// In a handler: if (!(await userMay(claims.sub, 'reports.edit'))) return res.status(403).end();
```

```python
import os

from lumoauth import LumoAuth
from lumoauth.errors import LumoAuthError

lumo = LumoAuth(
    base_url=os.environ["LUMOAUTH_URL"],
    api_key=os.environ["LUMOAUTH_API_KEY"],  # lmk_..., scope authz:check
)


def user_may(user_id: str, permission: str) -> bool:
    try:
        return lumo.permissions.check(permission, user_id=user_id)
    except LumoAuthError:
        return False  # fail closed
```

Without `userId` / `user_id`, the check is about the caller. For an API key the caller is the administrator who created the key, not the end user. Always pass the user.

For Go, PHP, .NET, Java, the browser client and the bulk, any and all variants, read [references/sdk-calls.md](references/sdk-calls.md).

`@lumoauth/backend` and `@lumoauth/client` cache `check` and `checkBulk` results in memory for 5 minutes by default. A role change can take that long to show. Pass `cache: false` or `cache: { ttl: 30_000 }` to the constructor when the application needs a shorter delay.

### 7. Hide UI by permission (hint only)

In a React app that already has `LumoAuthProvider` (see `lumoauth-react`), gate the UI with the signed-in user's own token:

```tsx
import { Protect, usePermission } from '@lumoauth/react';

export function ReportToolbar() {
  const { allowed, isLoading } = usePermission('reports.delete');

  return (
    <div>
      <Protect permission="reports.edit" fallback={null}>
        <button type="button">Edit</button>
      </Protect>
      <button type="button" disabled={isLoading || !allowed}>
        Delete
      </button>
    </div>
  );
}
```

`usePermission` returns `allowed: false` while the check loads and when the check fails. `<Protect>` shows a small loading indicator while the check runs and the fallback when the check denies or fails. A user can bypass any check in the browser, so the server check in step 6 must exist for the same action.

### 8. Roles in tokens (optional)

Access tokens carry no permissions. They can carry a `roles` claim, and only when the application has **User roles** enabled under its **Security → JWT claims** settings in the portal. The same setting adds `roles` to the UserInfo response.

The claim holds role identifiers, not permission slugs: `ROLE_USER` for every user, `ROLE_TENANT_ADMIN` for organization administrators, and `ROLE_TENANT_ROLE_<SLUG>` with the role slug in upper case (for example `ROLE_TENANT_ROLE_EDITOR`), for direct roles and roles from groups. Decode one token in development and confirm the values before you match on them.

Prefer the permission check of step 6. Role names in a token are as old as the token, and a role-name test breaks when the roles are reorganized. To read the user's role slugs and groups at run time, call `GET /orgs/{orgId}/api/v1/me` with a user access token that has the `authz:read` scope.

## Verify

1. `lumo roles get editor -o json` lists the permissions that you attached.
2. `lumo users roles get <user-id>` lists the role.
3. Ask the check API with the API key, for a user who has the role and for one who does not:

```bash
curl -s -X POST "https://app.lumoauth.dev/api/v1/authz/check" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"permission":"reports.edit","subject":{"type":"user","id":"0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"}}'
```

The answer is `{"allowed": true, "permission": "reports.edit", "subject_type": "user", "subject_id": "...", "user_id": "...", "context": {}}`. The path has no `/orgs/{orgId}` prefix. LumoAuth takes the organization from the credential.

4. In the portal, **Access control → Test access** (`/orgs/{orgId}/portal/permissions/tester`) shows the decision for a user and which role, group or direct grant gives it.
5. Call the protected route of the application as both users. Expect `403` for the user without the role.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The check returns `true` for every user | The check has no subject, so it answers for the API key's creator, who is an administrator | Pass `userId` / `user_id` (or `subject` in the raw request) |
| `403` with code `INSUFFICIENT_PERMISSIONS` on a check that names a user | The API key lacks the `authz:check` scope, or its creator does not hold `policies.view` | Create a key with `authz:check` as an administrator who holds `policies.view` |
| `404` with code `SUBJECT_NOT_FOUND` | The ID is not a user ID of this organization (an email, or an ID from another system) | Pass the `sub` claim of the LumoAuth token |
| A role was created but has fewer permissions than requested | The administrator behind the credential does not hold the missing permissions | Read the role back. An administrator who holds the permission must attach it |
| `lumo roles update --permissions` reports success and nothing changes | The update route reads only name and description | Use `lumo api PUT /roles/{slug}/permissions` |
| `400` "This slug is reserved for a system permission" | The slug is in a built-in namespace such as `users.` or `settings.` | Use a resource name of the application |
| A user lost roles after `lumo users roles set` | The command replaces the full set | Read the roles first and pass all of them, or add one role with `POST /users/{id}/roles` |
| A role change does not show in the app for some minutes | The JS SDK caches check results for 5 minutes | Lower the cache `ttl` or pass `cache: false` |
| The code tests `roles.includes('editor')` and never matches | The `roles` claim is off for the application, or the value is `ROLE_TENANT_ROLE_EDITOR` | Enable **User roles** for the application and match the real value, or use a permission check |
| `403 forbidden` with `details.required_scopes: ["authz:read"]` on `permissions.list()` | The route needs a user access token with `authz:read`. An API key cannot hold that scope | Request `authz:read` at sign-in and call `list()` with the user's token |

## Related skills

- `lumoauth-authorization`: choose the model, the check API rules, where to enforce.
- `lumoauth-abac`: add conditions (time, IP address, attributes) on top of roles.
- `lumoauth-rebac`: access to single objects through relationships.
- `lumoauth-api-protection`: verify the access token before the permission check.
- `lumoauth-admin-api`: API keys, scopes, pagination and errors of the Admin API.
- `lumoauth-cli`: install and configure `lumo`.
- `lumoauth-scim`: groups and roles that an identity provider manages.

## References

- [references/sdk-calls.md](references/sdk-calls.md): the permission check in every SDK, with bulk, any and all variants. Read it when the backend is not TypeScript or Python.
- [references/admin-api.md](references/admin-api.md): every Admin API route for permissions, roles, groups and user roles with its scope, permission and body. Read it when the task must use HTTP instead of the CLI.
- https://docs.lumoauth.dev/user-guide/access-control/roles-permissions
- https://docs.lumoauth.dev/user-guide/access-control/groups
- https://docs.lumoauth.dev/authorization/check
- https://docs.lumoauth.dev/authorization/permissions
- https://docs.lumoauth.dev/api-reference/roles
- https://docs.lumoauth.dev/api-reference/groups
- https://docs.lumoauth.dev/api-reference/permissions
