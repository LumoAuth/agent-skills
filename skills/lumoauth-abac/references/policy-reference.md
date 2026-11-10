# ABAC policy reference

Attribute namespaces, operators, the condition JSON, worked policies and the management routes for LumoAuth attribute rules.

## Policy object

```json
{
  "id": 12,
  "name": "Finance reads confidential reports",
  "slug": "finance-reads-confidential-reports",
  "description": null,
  "resourceType": "report",
  "action": "read",
  "effect": "allow",
  "priority": 100,
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "subject": "user.department", "operator": "equals", "value": "finance" }
    ]
  },
  "isActive": true,
  "isSystem": false,
  "createdAt": "2026-01-15T10:30:00+00:00",
  "updatedAt": null
}
```

| Field | Rule |
|---|---|
| `resourceType` | One type, compared exactly with the type in the check. `*` matches every type |
| `action` | One action, compared exactly. `*` matches every action |
| `effect` | `allow` or `deny` |
| `priority` | Integer. Higher is evaluated first. It orders evaluation and the reported policies and does not change the outcome |
| `conditions` | A group, see below |
| `isActive` | Only active policies are evaluated |

## Condition JSON

A group:

```json
{ "operator": "AND", "conditions": [ <leaf or group>, ... ] }
```

- `operator` is `AND` (every entry matches) or `OR` (at least one entry matches).
- `conditions` holds at least one entry. The API refuses an empty list.
- Groups nest. The root of a policy is always a group.

A leaf:

```json
{ "subject": "user.department", "operator": "equals", "value": "finance" }
```

- `subject` is a dotted attribute path. A path that does not resolve has no value (`null`).
- `value` is a literal. One attribute cannot be compared with another attribute.
- `value` is required for every operator except `exists` and `not_exists`.

## Operators

| Operator | Matches when | Notes |
|---|---|---|
| `equals` | The attribute equals the value, with the same type | `3` does not equal `"3"`, and `true` does not equal `"true"` |
| `not_equals` | The attribute differs from the value | Also matches when the attribute has no value |
| `in` | The attribute is one of the entries of the value | The value must be an array. Same-type comparison |
| `not_in` | The attribute is none of the entries of the value | The value must be an array. Also matches when the attribute has no value |
| `contains` | List attribute: the list has the value as an entry. Text attribute: the text includes the value | An empty value never matches |
| `not_contains` | List attribute: the list lacks the value. Text attribute: the text does not include the value | An empty value never matches. Does not match when the attribute has no value |
| `gt`, `gte`, `lt`, `lte` | Both sides are numeric and the comparison holds | A non-numeric side never matches |
| `matches` | The text attribute matches the regular expression | The pattern needs a `/`, `#` or `~` delimiter, only the modifiers `i s m u x U A D J S`, and at most 256 characters. Anchor it with `^` and `$` |
| `exists` | The attribute has a value | |
| `not_exists` | The attribute has no value | |

Fail-closed rules: when a policy's conditions cannot be evaluated (an empty group, an entry that is not an object, a pattern that cannot run), an `allow` policy does not match and a `deny` policy applies.

Take care with negative operators in `allow` policies. `user.department not_equals "contractor"` matches every user who has no department at all.

## Attributes

### `user.*`

| Attribute | Type | Meaning |
|---|---|---|
| `user.id` | string | LumoAuth user ID |
| `user.email`, `user.username`, `user.name` | string | Identity fields |
| `user.givenName`, `user.familyName`, `user.locale`, `user.zoneinfo` | string | Profile fields |
| `user.roles` | list of strings | Slugs of the roles assigned directly to the user |
| `user.groups` | list of strings | Slugs of the user's groups |
| `user.permissions` | list of strings | Effective permission slugs: direct, from roles and from group roles |
| `user.emailVerified`, `user.mfaEnabled`, `user.isActive`, `user.blocked` | boolean | Account status |
| `user.isAdmin` | boolean | Administrator flag |
| `user.tenantId`, `user.orgId` | integer, string | Organization ID and slug |
| `user.<slug>` | by definition | A custom attribute that has a definition of type `user`. Its stored value is converted to the definition's `dataType`. Without a stored value the definition's `defaultValue` applies |
| `user.trait_<key>` | text, or the defined type | A user trait that an administrator, an import or the ABAC API stored |
| `user.self_<key>` | text | A trait that the user entered on a progressive-profiling form. It never appears as `user.<slug>` or `user.trait_<key>`. A policy relies on it only by naming `self_` |

`user.roles` holds direct roles only. To test a role that can also come from a group, test the permission: `user.permissions contains "reports.edit"`.

### `resource.*`

| Attribute | Meaning |
|---|---|
| `resource.id` | The resource ID of the check |
| `resource.type` | The resource type of the check |
| `resource.<slug>` | A stored resource attribute. It needs a definition of type `resource` and a value set for this resource type and ID |

A check without a resource ID has no `resource.*` values.

### `environment.*`

The engine provides exactly these:

| Attribute | Type | Meaning |
|---|---|---|
| `environment.hour` | integer 0 to 23 | Current hour on LumoAuth's clock |
| `environment.dayOfWeek` | integer 1 to 7 | 1 is Monday, 7 is Sunday |
| `environment.isWeekend` | boolean | Saturday or Sunday |
| `environment.currentTime` | string `HH:MM:SS` | |
| `environment.currentDate` | string `YYYY-MM-DD` | |
| `environment.currentDateTime` | string, ISO 8601 | |
| `environment.ip` | string | Address of the client that called the check API |
| `environment.userAgent` | string | User-Agent header of that call |
| `environment.requestMethod`, `environment.requestPath` | string | Method and path of that call |

The four request attributes always come from the request that LumoAuth receives. A value that the caller sends under one of those names is not used for them.

### `device.*`

Present only when the organization has a device posture integration enabled (see `lumoauth-integrations`): `device.known`, `device.trusted`, `device.compliant`, `device.os`, `device.name`, `device.source`, `device.lastSeen`, `device.scope`. The values describe the managed device most recently seen for the user, not the device that makes the request.

## Evaluation

1. Collect the active policies where `resourceType` is the checked type or `*`, and `action` is the checked action or `*`.
2. Evaluate each policy's conditions.
3. A matching `deny` policy decides: denied. The reason is `Access denied by policy: <name>`.
4. Otherwise a matching `allow` policy decides: allowed. The reason is `Access allowed by policy: <name>`.
5. Otherwise denied. The reason is `No applicable ABAC policies found` (no policy targets this type and action) or `No matching policies - default deny`.

In the unified check (`POST /api/v1/authz/check`), for an organization with at least one active policy:

1. A matching deny policy denies, whatever roles the user has.
2. A permission grant or a role that carries the permission allows.
3. A matching allow policy allows.
4. Otherwise denied.

The unified check maps the permission slug to a policy target at the first dot: `report.read` is type `report` and action `read`. A slug without a dot is type `<slug>` and action `*`. It reads the resource ID from `context.resource_id` when that value is a string.

## Worked policies

Deny deletes for users without MFA:

```json
{
  "name": "Deletes need MFA",
  "resourceType": "*",
  "action": "delete",
  "effect": "deny",
  "priority": 200,
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "subject": "user.mfaEnabled", "operator": "equals", "value": false }
    ]
  }
}
```

Allow by clearance and classification:

```json
{
  "name": "Cleared staff read classified documents",
  "resourceType": "document",
  "action": "read",
  "effect": "allow",
  "priority": 100,
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "subject": "user.clearance_level", "operator": "gte", "value": 3 },
      { "subject": "resource.classification", "operator": "equals", "value": "classified" }
    ]
  }
}
```

`clearance_level` needs a `user` definition with `dataType` `number`.

Deny outside working hours on weekdays, for one resource type:

```json
{
  "name": "Payroll only in working hours",
  "resourceType": "payroll",
  "action": "*",
  "effect": "deny",
  "priority": 200,
  "conditions": {
    "operator": "OR",
    "conditions": [
      { "subject": "environment.hour", "operator": "lt", "value": 9 },
      { "subject": "environment.hour", "operator": "gte", "value": 18 },
      { "subject": "environment.isWeekend", "operator": "equals", "value": true }
    ]
  }
}
```

Allow a group, with a role exception (nested group):

```json
{
  "name": "Engineering or leads read internal APIs",
  "resourceType": "api",
  "action": "read",
  "effect": "allow",
  "priority": 100,
  "conditions": {
    "operator": "OR",
    "conditions": [
      { "subject": "user.groups", "operator": "contains", "value": "engineering" },
      {
        "operator": "AND",
        "conditions": [
          { "subject": "user.permissions", "operator": "contains", "value": "api.read" },
          { "subject": "user.emailVerified", "operator": "equals", "value": true }
        ]
      }
    ]
  }
}
```

Allow by email domain, with an anchored pattern:

```json
{
  "name": "Company addresses export data",
  "resourceType": "export",
  "action": "create",
  "effect": "allow",
  "priority": 100,
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "subject": "user.email", "operator": "matches", "value": "/^[^@]+@example\\.com$/" },
      { "subject": "user.emailVerified", "operator": "equals", "value": true }
    ]
  }
}
```

## Attribute definition object

| Field | Rule |
|---|---|
| `name` | Required. Display name |
| `slug` | The name that conditions use. Derived from `name` when left out: lowercase, every other character becomes `_`. Unique in the organization |
| `attributeType` | Required. `user`, `resource` or `environment` |
| `dataType` | Required. `string`, `number`, `boolean`, `array`, `date` or `datetime` |
| `defaultValue` | Used for a user who has no stored value |
| `isRequired` | When true, a `null` value is refused |
| `validationRules` | Optional object: `min`, `max` (numbers), `minLength`, `maxLength`, `pattern` (strings), `enum` (any) |

`attributeType` and `dataType` cannot be changed after creation through the update route. The update route takes `name`, `description`, `validationRules`, `defaultValue` and `isRequired`.

## Management routes

Base: `{base}/orgs/{orgId}/api/v1/abac`. Credential: an API key in `X-API-Key` or a user token as `Authorization: Bearer`. Scope `admin:abac:read` and permission `abac.view` for `GET`. Scope `admin:abac:write` and permission `abac.manage` for the others.

| Method and path | Purpose |
|---|---|
| `GET /attributes` | List attribute definitions |
| `POST /attributes` | Create a definition. `201`, or `409` when the slug exists |
| `GET /attributes/{id}` | Read one |
| `PUT` or `PATCH /attributes/{id}` | Update |
| `DELETE /attributes/{id}` | Delete |
| `GET /policies` | List policies |
| `POST /policies` | Create a policy. `201`, `400` with the condition errors, or `409` when the slug exists |
| `GET /policies/{id}` | Read one |
| `PUT` or `PATCH /policies/{id}` | Update: `name`, `description`, `resourceType`, `action`, `effect`, `priority`, `conditions`, `isActive` |
| `DELETE /policies/{id}` | Delete |
| `POST /policies/{id}/toggle` | Switch between active and inactive |

IDs are integers. Without the feature in the organization's plan, creating, editing and re-activating answer `403` with `"error": "feature_not_in_plan"`. Listing, reading, deactivating and deleting still work.

## Decision and attribute routes

Base: `{base}/orgs/{orgId}/api/v1/abac`. Credential: a user access token only.

| Method and path | Scope | Extra rule | Body |
|---|---|---|---|
| `POST /check` | `abac:read` | Decides for the caller | `{"resourceType", "action", "resourceId"?, "environment"?}` |
| `POST /check-bulk` | `abac:read` | At most 100 checks, one shared `environment` | `{"checks": [{"resourceType", "action", "resourceId"?}], "environment"?}` |
| `GET /my-attributes` | `abac:read` | | Answer: `{"user_id", "attributes": {...}}` |
| `GET /attribute-definitions?type=user` | `abac:read` | | Answer: `{"data": [...], "pagination": {...}}` |
| `GET /resources/{resourceType}/{resourceId}/attributes` | `abac:read` | The user holds `abac.view` or `abac.manage` | |
| `PUT /resources/{resourceType}/{resourceId}/attributes/{attributeSlug}` | `abac:write` | The user holds `abac.manage` | `{"value": <any JSON>}` |
| `PUT /users/{userId}/attributes/{attributeSlug}` | `abac:write` | The user holds `abac.manage` | `{"value": <any JSON>}` |

Errors: `400 MISSING_FIELDS`, `400 INVALID_CHECKS`, `400 TOO_MANY_CHECKS`, `400 VALIDATION_ERROR`, `403 FORBIDDEN` (missing `abac.manage` or `abac.view`), `403 forbidden` with `details.required_scopes`, `404 NOT_FOUND` (the user is not in the organization).
