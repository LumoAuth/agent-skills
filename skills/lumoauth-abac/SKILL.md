---
name: lumoauth-abac
description: >-
  Adds attribute-based access control (ABAC) with LumoAuth: attribute definitions for users and
  resources, policies with an effect (allow or deny), a resource type, an action and a tree of
  conditions (equals, in, contains, gt, lte, matches, exists, AND, OR), deny-overrides
  evaluation, environment attributes (hour, weekday, IP address, device posture), stored
  attribute values, and the decision calls. Covers the /abac/attributes and /abac/policies routes
  (admin:abac:write), /abac/check and /abac/check-bulk (abac:read, abac:write scopes),
  abac.check, abac.isAllowed, setUserAttribute and setResourceAttribute in @lumoauth/backend,
  @lumoauth/client, @lumoauth/react (Protect abac, useAbac), Python, Go, PHP, .NET and Java, how
  policies join the unified /authz/check, and the portal policy tester. Use when access depends
  on department, clearance, classification, business hours, IP address, MFA status or other
  attributes, or when the user asks for policies or context-aware authorization.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth attribute rules (ABAC)

Decide access from facts about the user, the resource and the request: "finance users may read confidential reports", "nobody deletes records at the weekend". This skill defines the attributes, writes the policies, stores attribute values and adds the evaluation call to the application code.

## When to use

- A rule depends on a field of the user (department, clearance, MFA enabled) or of the resource (classification, owner department).
- A rule depends on the time or the day, or on the IP address of the request.
- A role is too coarse and the user would otherwise create one role per condition.

Do not use this skill for:

- Plain "admins may do X" rules: use `lumoauth-rbac`.
- Access to one object through sharing, teams or parents: use `lumoauth-rebac`.
- Choosing between the models: use `lumoauth-authorization`.
- Risk-based sign-in rules and adaptive MFA: use `lumoauth-mfa-passkeys`.
- Policies about AI agents (`agent.*` attributes) and approvals: use `lumoauth-agent-identity` and `lumoauth-agent-approvals`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL, for example `acme-corp` |
| The rules in plain words | From the user: who, which resource type, which action, under which condition, allow or deny |

Attribute rules are available when the organization's plan includes them. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix). Without the feature, allow policies grant nothing, existing deny policies still apply, and the ABAC check and attribute routes answer `403` with `"error": "feature_not_in_plan"`.

ABAC uses four kinds of credential. Each route accepts only the kind in this table.

| Task | Credential | Scope | Permission of the user behind it |
|---|---|---|---|
| Create attribute definitions and policies | Organization API key (`X-API-Key`) or user token | `admin:abac:write` (`admin:abac:read` to list) | `abac.manage` (`abac.view` to list) |
| Set attribute values on users and resources | **User access token only** | `abac:write` | `abac.manage` |
| Evaluate ABAC for the signed-in user (`abac.check`) | **User access token only** | `abac:read` | none |
| Evaluate roles and policies together for any user from a backend (`permissions.check`) | Organization API key | `authz:check` | `policies.view` (the key's creator) |

API keys are created at `/orgs/{orgId}/portal/settings/api-keys`. For a user token to carry `abac:read` or `abac:write`, add the scope to the application's allowed scopes (**Applications → the application → Configuration → Allowed scopes**) and request it at sign-in.

## How a decision is made

A policy targets one `resourceType` and one `action` (`*` matches all). Its `conditions` compare attributes with literal values.

1. LumoAuth collects the active policies whose resource type and action match the request.
2. A policy matches when its conditions hold.
3. Any matching `deny` policy wins: the answer is denied.
4. Otherwise one matching `allow` policy is enough: the answer is allowed.
5. With no match the answer is denied.

`priority` sets the order of evaluation and of the reported policies. It does not change the outcome.

Two entry points use the policies:

- `POST /orgs/{orgId}/api/v1/abac/check` evaluates policies only, for the caller.
- `POST /api/v1/authz/check` (the unified check, `permissions.check` in the SDKs) evaluates roles, permission grants and policies together. It reads the permission slug as `resourceType.action`, split at the first dot: `document.read` is resource type `document`, action `read`. A matching deny policy overrides a role. A matching allow policy grants the permission to a user who has no role for it.

That last rule decides how to write a policy:

- To **restrict** what roles give, write a `deny` policy for the forbidden case ("deny `document.edit` at the weekend").
- To **grant** by attribute, write an `allow` policy and put every requirement in its conditions. An allow policy "during business hours" with no other condition grants the action to every user during business hours.

## Steps

### 1. Break each rule into a policy

For every rule write down: effect, resource type, action, and the conditions with the attribute each one reads.

```
Rule:      Finance staff may read confidential reports.
Effect:    allow
Target:    resourceType "report", action "read"
Condition: user.department equals "finance"
           AND resource.classification equals "confidential"

Rule:      Nobody edits reports at the weekend.
Effect:    deny
Target:    resourceType "report", action "edit"
Condition: environment.isWeekend equals true
```

Attribute paths start with `user.`, `resource.` or `environment.`. Built-in attributes need no definition: `user.id`, `user.email`, `user.roles`, `user.groups`, `user.permissions`, `user.emailVerified`, `user.mfaEnabled`, `environment.hour`, `environment.dayOfWeek`, `environment.isWeekend`, `environment.ip` and more. For the full list, the operators and their type rules, read [references/policy-reference.md](references/policy-reference.md).

Name the resource type and the action exactly as the application will send them. If the application checks through `permissions.check('report.read')`, the resource type is `report` and the action is `read`.

### 2. Define the custom attributes

Show each request to the user before you send it. These requests change the organization.

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/attributes" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Department",
    "slug": "department",
    "attributeType": "user",
    "dataType": "string",
    "validationRules": { "enum": ["engineering", "finance", "sales"] }
  }'

curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/attributes" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Classification",
    "slug": "classification",
    "attributeType": "resource",
    "dataType": "string",
    "validationRules": { "enum": ["public", "internal", "confidential"] }
  }'
```

- Required: `name`, `attributeType` (`user`, `resource` or `environment`), `dataType` (`string`, `number`, `boolean`, `array`, `date` or `datetime`).
- Optional: `slug`, `description`, `validationRules`, `defaultValue`, `isRequired`. Send `slug` yourself, in lowercase with underscores. It is the name that conditions use (`user.department`).
- Do not reuse the name of a built-in attribute such as `email` or `roles` as a slug. Policies keep reading the built-in value.
- In the portal the same form is **Access control → Attribute rules → New attribute** (`/orgs/{orgId}/portal/abac/attributes/create`).

### 3. Create the policies

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/policies" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Finance reads confidential reports",
    "resourceType": "report",
    "action": "read",
    "effect": "allow",
    "priority": 100,
    "conditions": {
      "operator": "AND",
      "conditions": [
        { "subject": "user.department", "operator": "equals", "value": "finance" },
        { "subject": "resource.classification", "operator": "equals", "value": "confidential" }
      ]
    }
  }'

curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/policies" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "No report edits at the weekend",
    "resourceType": "report",
    "action": "edit",
    "effect": "deny",
    "priority": 200,
    "conditions": {
      "operator": "AND",
      "conditions": [
        { "subject": "environment.isWeekend", "operator": "equals", "value": true }
      ]
    }
  }'
```

- Required: `name`, `resourceType`, `action`, `effect`, `conditions`. Optional: `slug`, `description`, `priority` (integer), `isActive` (default `true`).
- `conditions` is a group: `operator` is `AND` or `OR`, and `conditions` is a list with at least one entry. An entry is a leaf `{ "subject", "operator", "value" }` or another group.
- The answer is `201` with the policy in `data`, including its numeric `id`. `400` lists the condition errors. `409` means that the slug exists.
- Other routes: `GET /abac/policies`, `GET|PUT|PATCH|DELETE /abac/policies/{id}`, `POST /abac/policies/{id}/toggle` (switch a policy on or off).
- In the portal: **Access control → Attribute rules → Create policy**.

### 4. Store the attribute values

Policies read stored values. A check cannot pass user or resource attributes inline.

These calls need a **user access token** with the `abac:write` scope, and the user must hold `abac.manage`. An API key is refused. Run them from an admin tool or a job that holds such a token.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const admin = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!, // https://app.lumoauth.dev
  orgId: 'acme-corp',
  secretKey: process.env.LUMOAUTH_ADMIN_ACCESS_TOKEN!, // user token, scope abac:write
});

await admin.abac.setUserAttribute('0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20', 'department', 'finance');
await admin.abac.setResourceAttribute('report', 'q4-2026', 'classification', 'confidential');
```

- `setUserAttribute(userId, attributeSlug, value)` and `setResourceAttribute(resourceType, resourceId, attributeSlug, value)` set one value per call.
- A resource attribute needs a definition of type `resource` first, or the answer is `400 VALIDATION_ERROR`. The value must pass the definition's type and validation rules.
- Define every user attribute that a policy reads. A value without a definition is visible to policies only as `user.trait_<slug>`, as text.
- Call `setResourceAttribute` when the application creates or reclassifies a resource. A resource without stored values has only `resource.id` and `resource.type`.

### 5. Test in the portal

**Access control → Test access → Attribute rules** (`/orgs/{orgId}/portal/abac/tester`): pick a user, enter the resource type, action and resource ID, and run the test. The result lists the policies that matched. Attributes typed into the tester override the stored values for that run, so the administrator can ask "what if". Test one allowed and one denied case for each policy.

### 6. Evaluate in code, on the server

Choose one of the two calls. Both are server-side checks. Treat an error as a denial.

**A. Roles and policies together, for any user (recommended for a backend).** Uses an API key with the `authz:check` scope. The permission slug carries the resource type and action. `context.resource_id` (a string) names the resource whose stored attributes the policies read.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!,
  secretKey: process.env.LUMOAUTH_API_KEY!, // lmk_..., scope authz:check
  cache: false, // policies depend on time and stored attributes: do not cache decisions
});

export async function userMay(userId: string, permission: string, resourceId: string): Promise<boolean> {
  try {
    return await lumo.permissions.check(permission, { resource_id: resourceId }, { userId });
  } catch (error) {
    console.error('LumoAuth check failed', error);
    return false; // fail closed
  }
}

// if (!(await userMay(claims.sub, 'report.read', 'q4-2026'))) return res.status(403).end();
```

**B. Policies only, for the signed-in user.** Uses the user's own access token, which must carry `abac:read` and must be a token for LumoAuth's API (not one requested for another `resource`). The decision includes the reason and the matched policies.

```python
import os

from lumoauth import LumoAuth
from lumoauth.errors import LumoAuthError


def user_may(access_token: str, resource_type: str, action: str, resource_id: str) -> bool:
    lumo = LumoAuth(
        base_url=os.environ["LUMOAUTH_URL"],
        org_id="acme-corp",
        token_provider=lambda: access_token,
    )
    try:
        decision = lumo.abac.check(resource_type, action, resource_id)
    except LumoAuthError:
        return False  # fail closed
    return bool(decision.get("allowed"))
```

`abac.isAllowed` / `is_allowed` returns only the boolean. `abac.checkBulk` evaluates up to 100 resource and action pairs in one request. For every SDK read [references/sdk-calls.md](references/sdk-calls.md).

Facts about the request context:

- `environment.ip`, `userAgent`, `requestMethod` and `requestPath` describe the request that LumoAuth receives. When a backend makes the check, `environment.ip` is the backend's address, not the end user's. An IP rule therefore works for checks that the user's browser makes, and not for checks that a server makes on the user's behalf.
- The policy engine reads a fixed set of `environment.*` attributes (see the reference). Do not build a rule on a custom value that the caller sends with the check.
- `environment.hour` and `dayOfWeek` come from LumoAuth's clock. Test an hour rule in the policy tester before you rely on its timezone.

### 7. Hide UI by policy (hint only)

In a React app that already has `LumoAuthProvider` (see `lumoauth-react`), with `abac:read` among the requested scopes:

```tsx
import { Protect } from '@lumoauth/react';

export function ReportLink({ reportId }: { reportId: string }) {
  return (
    <Protect abac={{ resourceType: 'report', action: 'read', resourceId: reportId }} fallback={null}>
      <a href={`/reports/${reportId}`}>Open report</a>
    </Protect>
  );
}
```

It renders a small loading indicator while the check runs and the fallback when the check denies or fails. The server check of step 6 must exist for the same action.

## Verify

1. `GET /orgs/{orgId}/api/v1/abac/policies` with the API key lists the policies as active.
2. The portal tester gives the expected answer for an allowed and a denied case.
3. With a user token that has `abac:read`:

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/check" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"report","action":"read","resourceId":"q4-2026"}'
```

Expected: `{"allowed": true, "reason": "Access allowed by policy: Finance reads confidential reports", "matchedPolicies": [{"id": 12, "name": "..."}], "user_id": "...", "resourceType": "report", "action": "read", "resourceId": "q4-2026"}`. A caller without `policies.view` sees only `id` and `name` of each matched policy.

4. `GET /orgs/{orgId}/api/v1/abac/my-attributes` with the same token shows the attributes that policies see for that user.
5. Call the protected route as a user who matches and as one who does not. Expect `403` for the second.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `/abac/check` refuses an API key | The check and attribute-value routes accept user access tokens only | Use the user's token with `abac:read`, or use `permissions.check` with the API key (step 6A) |
| `403 forbidden` with `details.required_scopes: ["abac:read"]` | The token lacks the scope | Add the scope to the application's allowed scopes and request it at sign-in |
| `403` with `"error": "feature_not_in_plan"` | The organization does not have attribute rules | See https://docs.lumoauth.dev/pricing-matrix |
| An allow policy gives access to users who have no role | In the unified check an allow policy grants on its own | Add the role or permission to the conditions (`user.roles contains "editor"`), or write the rule as a deny policy |
| `equals true` or `gte 3` never matches | The stored value is text because the attribute has no definition, or the condition value is the string `"true"` / `"3"` | Define the attribute with `dataType` `boolean` or `number` and write the condition value in that type |
| `in` never matches | `value` is not an array, or the attribute is a list | Use `in` for "attribute is one of these values" and `contains` for "the list attribute has this entry" |
| `400` on a `matches` condition | The pattern has no delimiter | Write a delimited pattern, at most 256 characters: `"/^.+@example\\.com$/"`. Anchor it with `^` and `$` |
| `400 VALIDATION_ERROR` on `setResourceAttribute` | No `resource` attribute definition with that slug, or the value fails validation | Create the definition first |
| The policy on `resource.classification` never matches through `permissions.check` | The check has no `context.resource_id`, or it is a number | Pass `{ resource_id: "<id as string>" }` |
| An IP rule denies every user when the backend checks | `environment.ip` is the backend's address | Evaluate IP rules at sign-in (`lumoauth-mfa-passkeys`) or in the application |
| Decisions lag behind attribute changes | The JS SDK caches `permissions.check` for 5 minutes | Construct the client with `cache: false` |
| A policy with an empty condition list | The API refuses it. A stored one never matches as allow and always applies as deny | Give every group at least one condition |

## Related skills

- `lumoauth-authorization`: choose the model, the unified check, where to enforce.
- `lumoauth-rbac`: roles and permissions that the policies refine.
- `lumoauth-rebac`: per-object access through relationships.
- `lumoauth-admin-api`: API keys, scopes and errors of the management routes.
- `lumoauth-integrations`: device posture, which adds the `device.*` attributes.
- `lumoauth-oauth-oidc`: request the `abac:read` scope at sign-in.

## References

- [references/policy-reference.md](references/policy-reference.md): every attribute namespace, every operator with its type rules, the condition JSON, worked policies and the management routes. Read it when you write a policy.
- [references/sdk-calls.md](references/sdk-calls.md): `check`, `isAllowed`, `checkBulk` and the attribute calls in every SDK. Read it when the code is not TypeScript or Python.
- https://docs.lumoauth.dev/user-guide/access-control/abac
- https://docs.lumoauth.dev/authorization/abac
- https://docs.lumoauth.dev/authorization/policies
- https://docs.lumoauth.dev/authorization/attributes
