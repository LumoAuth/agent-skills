# Decision API reference

Every LumoAuth route that answers an authorization question, with its body, answer, credential rule, limits and errors.

Base URL: `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU).

## Credentials

| Credential | Header | Principal of the request |
|---|---|---|
| User access token | `Authorization: Bearer <token>` (`DPoP <token>` for a DPoP-bound token, with its proof) | The user |
| Organization API key | `X-API-Key: lmk_...` | The administrator who created the key |
| Agent credential | `Authorization: Bearer <token>` | The agent (see `lumoauth-agent-identity`) |

- One credential per request. An API key together with a bearer token is refused with `400`.
- An API key is accepted on the permission-check family, the AuthZEN routes and the relationship routes. It is not accepted on the ABAC check and attribute-value routes.
- A user access token must be one for LumoAuth's own API. A token requested with `resource=<another server>` is refused.
- An API key stops working when its creator is deactivated or blocked.

## Who may ask about whom

| Question | Requirement |
|---|---|
| About the caller itself | Any authenticated user or agent |
| About another user, an agent or a userset, and every `expand` | One of: (a) an API key with scope `authz:check` whose creator holds `policies.view`; (b) a user access token with scope `authz:check` whose user holds `policies.view`; (c) a user who holds the `authz.check` permission through a role, a group or a direct grant |

The `authz.check` permission counts only from roles, groups and direct grants. An attribute policy cannot give it. The built-in Tenant Admin role has it.

A refused question gets:

```json
{
  "error": "insufficient_permissions",
  "error_description": "Checking authorization for a subject other than yourself requires the \"authz.check\" permission or the \"authz:check\" scope",
  "code": "INSUFFICIENT_PERMISSIONS"
}
```

## Scopes at a glance

| Scope | Held by | Opens |
|---|---|---|
| `authz:check` | API key, user token | Questions about other subjects, and `expand` |
| `authz:read` | User token | `GET /api/v1/authz/permissions`, and the roles and groups in `GET /orgs/{orgId}/api/v1/me` |
| `abac:read` | User token | ABAC check, bulk check, attribute reads |
| `abac:write` | User token | Setting user and resource attribute values (the user also needs `abac.manage`) |
| `admin:abac:read`, `admin:abac:write` | API key, user token | Attribute definitions and policies |
| `admin:roles:*`, `admin:permissions:*`, `admin:groups:*`, `admin:users:*` | API key, user token | Roles, permissions, groups and user assignments in the Admin API |
| `admin` | User token | Satisfies every `required_scopes` check (`authz:read`, `abac:*`, `admin:*`). The user's own permissions still apply. It does not replace `authz:check` |

A missing scope gets `403` with `"error": "forbidden"`, `details.required_scopes` and `details.granted_scopes`.

## Permission check family

No `/orgs/{orgId}` prefix. The organization comes from the credential.

### `POST /api/v1/authz/check`

```json
{
  "permission": "reports.edit",
  "context": { "resource_id": "q4-2026" },
  "subject": { "type": "user", "id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20" }
}
```

| Field | Required | Meaning |
|---|---|---|
| `permission` | Yes | Permission slug |
| `context` | No | Object. `resource_id` (string) names the resource for attribute policies. LumoAuth sets `ip`, `userAgent`, `requestMethod` and `requestPath` from the request that it receives |
| `subject` | No | `{"type": "user" or "agent", "id": "<user UUID or agent ID>"}`. Default: the caller |

```json
{
  "allowed": true,
  "permission": "reports.edit",
  "subject_type": "user",
  "subject_id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20",
  "user_id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20",
  "context": { "resource_id": "q4-2026" }
}
```

`user_id` is present only for a user subject. `context` echoes the request.

Context values never grant access by themselves. A caller cannot claim ownership or an attribute through `context`.

### `POST /api/v1/authz/check-bulk`

Body: `{"permissions": ["reports.view", "reports.edit"], "context": {}, "subject": {}}`. Answer: `{"results": {"reports.view": true, "reports.edit": false}, "subject_type": "...", "subject_id": "...", "context": {}}`.

### `POST /api/v1/authz/check-any` and `POST /api/v1/authz/check-all`

Same body as `check-bulk`. Answer: `{"allowed": true, "permissions": [...], "subject_type": "...", "subject_id": "...", "context": {}}`. `check-any` allows when at least one permission is held. `check-all` allows only when all are held.

### `GET /api/v1/authz/permissions`

User token with `authz:read`. Lists the caller's permissions from roles, including roles from groups:

```json
{
  "user_id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20",
  "permissions": [
    { "slug": "reports.edit", "description": "Edit reports", "source": "role:Editor" }
  ],
  "count": 1
}
```

The answer also carries the same list as `data` with `pagination`. A permission that two roles give appears once per role.

### Limits and errors

| Status | Code | Meaning |
|---|---|---|
| `400` | `MISSING_PERMISSION` | `permission` is missing or not a string |
| `400` | `INVALID_PERMISSIONS` | `permissions` is missing, empty or not an array |
| `400` | `TOO_MANY_PERMISSIONS` | More than 100 permissions in one request |
| `400` | `INVALID_SUBJECT` | `subject` is not `{type: "user" or "agent", id}` |
| `403` | `INSUFFICIENT_PERMISSIONS` | Another subject without the privilege |
| `404` | `SUBJECT_NOT_FOUND` | No such user or agent in the caller's organization |
| `500` | `CHECK_FAILED`, `BULK_CHECK_FAILED`, `CHECK_ANY_FAILED`, `CHECK_ALL_FAILED` | Treat as a denial |

## AuthZEN evaluation

The OpenID AuthZEN Authorization API 1.0 shape. One call evaluates attribute policies, relationships and permissions for a subject, an action and one resource.

### `POST /api/v1/authz/v1/evaluation`

```json
{
  "subject": { "type": "user", "id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20" },
  "action": { "name": "read" },
  "resource": { "type": "document", "id": "42" },
  "context": {}
}
```

`subject.type` is `user` or `agent`. `subject.id`, `action.name`, `resource.type` and `resource.id` are required strings.

Answer: `{"decision": true}` or `{"decision": false}`. On a denial, a caller who holds `policies.view` also gets a `context` object with the reason.

Order of evaluation for a user:

1. An inactive user is denied.
2. A matching `deny` attribute policy for `resource.type` and `action.name` denies.
3. A relationship `<resource.type>:<resource.id>#<action.name>@user:<subject.id>` allows.
4. The permission `<resource.type>.<action.name>` allows (grants and roles).
5. A matching `allow` attribute policy allows.
6. Otherwise denied.

An unknown subject is a `false` decision, not `404`. A subject other than the caller needs the privilege from "Who may ask about whom".

### `POST /api/v1/authz/v1/evaluations`

Batch form: top-level `subject`, `action`, `resource` and `context` are defaults, and `evaluations` is a list of objects that override them. Answer: `{"evaluations": [{"decision": true}, {"decision": false}]}` in request order.

## Relationship routes

| Route | Body | Answer |
|---|---|---|
| `POST /api/v1/authz/zanzibar/check` | `{"object": "document:42", "relation": "editor", "subject": "user:<id>"}` | `{"allowed": true, "object": "...", "relation": "...", "subject": "..."}` |
| `POST /api/v1/authz/zanzibar/expand` | `{"object": "document:42", "relation": "viewer"}` | `{"tree": {"type", "object", "relation", "children", "subjects"}}` |
| `POST /orgs/{orgId}/api/v1/zanzibar/check` | Same, with the field `user` in place of `subject` | Same, with `user` |
| `POST /orgs/{orgId}/api/v1/zanzibar/expand` | `{"object", "relation"}` | `{"tree": {...}}` |

A subject of `user:<the caller's own ID>` is a question about the caller. Any other subject, and every `expand`, needs the privilege. Details and modelling: `lumoauth-rebac`.

## ABAC routes

Base `/orgs/{orgId}/api/v1/abac`. User access token only.

| Route | Scope | Body | Answer |
|---|---|---|---|
| `POST /check` | `abac:read` | `{"resourceType": "report", "action": "read", "resourceId": "q4-2026"}` | `{"allowed", "reason", "matchedPolicies", "user_id", "resourceType", "action", "resourceId"}` |
| `POST /check-bulk` | `abac:read` | `{"checks": [{"resourceType", "action", "resourceId"}]}` (at most 100) | `{"results": [{"index", "resourceType", "action", "resourceId", "allowed", "reason"}], "user_id"}` |

The ABAC check always decides for the caller. Details, attributes and policies: `lumoauth-abac`.

## Which call for which need

| Need | Call |
|---|---|
| "May this user do this action?" (roles, plus policies) | `POST /api/v1/authz/check` |
| Several actions for one page | `POST /api/v1/authz/check-bulk` |
| "May this user do this action on this object?" across all three models | `POST /api/v1/authz/v1/evaluation` |
| "Is this user related to this object?" | `POST /api/v1/authz/zanzibar/check` |
| "Who has access to this object?" | `POST /api/v1/authz/zanzibar/expand` |
| "Why was this denied by a policy?" for the signed-in user | `POST /orgs/{orgId}/api/v1/abac/check` |
| "What can the signed-in user do?" | `GET /api/v1/authz/permissions` |
