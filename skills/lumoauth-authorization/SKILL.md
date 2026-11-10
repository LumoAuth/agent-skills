---
name: lumoauth-authorization
description: >-
  Entry point for adding authorization (access control, permissions) to an application with
  LumoAuth. Helps choose between roles (RBAC), attribute rules (ABAC) and relationships (ReBAC,
  Zanzibar), explains the decision APIs (POST /api/v1/authz/check, check-bulk, check-any,
  check-all, the AuthZEN evaluation API, the relationship check and the ABAC check), who may call
  them (the user's own token versus a backend API key with the authz:check scope, the authz.check
  permission, authz:read, abac:read), where to enforce (UI hints versus the server-side check),
  caching and fail-closed behaviour, the portal's Test access page and AI policy authoring, then
  routes to lumoauth-rbac, lumoauth-abac and lumoauth-rebac. Use when the user asks to add
  authorization, access control, permissions or "who can do what" to an app, asks which
  authorization model to use, wants one permission check for a backend, or gets 403
  INSUFFICIENT_PERMISSIONS, SUBJECT_NOT_FOUND or required_scopes errors from a check call.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth authorization: choose a model and enforce it

Authentication says who the user is. Authorization says what that user may do. LumoAuth stores the rules (roles, attribute policies, relationships) and answers yes or no at request time. The application asks the question on the server and refuses the request when the answer is no.

This skill picks the model, sets up the credential for the check, and adds one enforcement point. The three model skills hold the details.

## When to use

- The user wants access control and has not named a model.
- The user wants to know which call to make from a backend, with which credential.
- A check call fails with a scope or permission error.

Go straight to the model skill when the model is already clear:

| The user says | Skill |
|---|---|
| Roles, permissions, groups, "admins can ..." | `lumoauth-rbac` |
| Rules on department, classification, time, IP address, MFA status | `lumoauth-abac` |
| Per-object access, sharing, folders, teams owning resources | `lumoauth-rebac` |
| The subject is an AI agent, or a human must approve an action | `lumoauth-agent-identity`, `lumoauth-agent-approvals` |
| Validate the access token of an incoming request | `lumoauth-api-protection` |
| OAuth scopes on a token (`read:reports`) | `lumoauth-oauth-oidc` |

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL, for example `acme-corp` |
| What must be protected | From the user: the actions, the kinds of object, and what decides access |
| Where the check will run | The backend language and framework, and whether a browser UI needs hints |
| Organization API key with the `authz:check` scope | Portal: `/orgs/{orgId}/portal/settings/api-keys`. The administrator who creates it must hold `policies.view`. Store it in an environment variable on the server |

Sign-in must already work, and the backend must already verify the access token of each request (`lumoauth-api-protection`). The check needs the user's LumoAuth ID, which is the `sub` claim of that token.

## Steps

### 1. Choose the model

Ask these questions in order and stop at the first "yes". Start with roles. Add another model only when the user can name a rule that roles cannot express.

| Question | Model |
|---|---|
| Does access follow from a person's job or team, the same for every object? ("Admins manage billing.") | Roles and permissions (RBAC), with groups for many users |
| Does the decision depend on a field of the user or resource, or on the time or request? ("Finance reads confidential reports." "No deletes at the weekend.") | Attribute rules (ABAC), usually on top of roles |
| Does the decision depend on a link between this user and this object? ("Members of the team that owns the project can edit it.") | Relationships (ReBAC) |

Signs that roles are no longer enough: one role per customer, project or document; role names that carry conditions (`editor-eu-weekdays`).

Facts that affect the choice:

- Roles and permissions are part of every organization. Attribute rules and relationships depend on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix). Without the feature, relationship checks answer `allowed: false` and allow policies grant nothing.
- Relationship tuples are entered by administrators in the portal. No API writes them. Relationships that end users create at run time (user-to-user sharing) stay in the application's database.
- Attribute values on resources are written through the ABAC API with an administrator's access token, not with an API key.
- The models combine. A common setup is roles for capability and deny policies for conditions.

The portal page **Access control → How access works** (`/orgs/{orgId}/portal/access`) shows the three models with live counts and marks the ones that the organization's plan does not include.

### 2. Know the decision calls

| Call | Decides from | Subject | SDK |
|---|---|---|---|
| `POST /api/v1/authz/check` (also `check-bulk`, `check-any`, `check-all`) | Permission grants and roles, plus attribute policies when the organization has any | The caller, or `subject: {type, id}` | `permissions.check` and siblings |
| `POST /api/v1/authz/v1/evaluation` (AuthZEN, also `evaluations`) | Attribute policies, a relationship on the named object, and the permission `<type>.<action>` | `subject: {type, id}`, required | None: raw HTTP |
| `POST /api/v1/authz/zanzibar/check` | Relationships only | `subject: "user:<id>"`, required | `zanzibar.check` |
| `POST /orgs/{orgId}/api/v1/abac/check` | Attribute policies only | Always the caller | `abac.check` |

The first three have no `/orgs/{orgId}` prefix. LumoAuth takes the organization from the credential.

How the permission check (`/authz/check`) combines its inputs for a user:

1. An inactive user is denied.
2. A matching `deny` policy denies. The permission slug is read as `resourceType.action`, split at the first dot, and `context.resource_id` names the resource.
3. A permission that the user holds directly, through a role or through a group's role allows.
4. A matching `allow` policy allows.
5. Otherwise the answer is denied.

It does not look at relationships on application objects. Use the AuthZEN evaluation or the relationship check for those. The AuthZEN evaluation asks the relationship engine for the relation named like the action (`document:42#read@user:<id>`), so that call fits a model whose relation names are the action names.

For request and response bodies, limits and error codes of each call, read [references/check-api.md](references/check-api.md).

### 3. Pick the credential for the check

| Who asks | Credential | May ask about |
|---|---|---|
| The backend, about the user of the current request | Organization API key with scope `authz:check` (creator holds `policies.view`) | Any user or agent of the organization. Name the user in the call |
| The browser, about the signed-in user | The user's own access token | The user itself. No extra scope |
| A user token, about someone else | The token has scope `authz:check` and the user holds `policies.view`, or the user holds the `authz.check` permission (the built-in Tenant Admin role has it) | Any subject |

Rules:

- A check without a subject answers for the caller. For an API key the caller is the administrator who created the key, so a backend must always name the user. Forgetting this makes every check return `true`.
- A request with an API key and a bearer token together is refused (`400`). Send one credential.
- LumoAuth's own API refuses an access token that was issued for another resource server (requested with `resource=https://api.example.com`). A backend that receives such tokens cannot forward them to the check. It uses the API key and the `sub` claim.
- Listing all permissions of the caller (`GET /api/v1/authz/permissions`) needs a user token with the `authz:read` scope. The ABAC check needs a user token with `abac:read`. An API key cannot hold either scope.
- The API key is a server secret. Never put it in browser or mobile code, in a public environment variable (`NEXT_PUBLIC_*`, `VITE_*`) or in a log.

### 4. Enforce on the server

Put one check in front of every protected action: in the route handler, a middleware, or the service function that performs the action. Check the specific permission or relation for that action. Return `403` when the answer is no.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!, // https://app.lumoauth.dev
  secretKey: process.env.LUMOAUTH_API_KEY!, // lmk_..., scope authz:check
});

export class ForbiddenError extends Error {}

/** Throws unless LumoAuth allows the permission for this user. Errors count as "no". */
export async function requirePermission(userId: string, permission: string, resourceId?: string): Promise<void> {
  let allowed = false;
  try {
    allowed = await lumo.permissions.check(
      permission,
      resourceId ? { resource_id: resourceId } : undefined,
      { userId },
    );
  } catch (error) {
    console.error('LumoAuth check failed', error); // never log tokens or the API key
  }
  if (!allowed) throw new ForbiddenError(`Missing permission: ${permission}`);
}

// Usage in a handler, after the access token was verified:
//   await requirePermission(claims.sub, 'reports.edit', req.params.id);
```

The same call exists in Python, Go, PHP, .NET and Java. The model skills show it per language: `lumoauth-rbac` for `permissions.check`, `lumoauth-rebac` for `zanzibar.check`, `lumoauth-abac` for `abac.check`.

Without an SDK, or for the AuthZEN evaluation:

```bash
curl -s -X POST "https://app.lumoauth.dev/api/v1/authz/v1/evaluation" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "type": "user", "id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20" },
    "action": { "name": "read" },
    "resource": { "type": "document", "id": "42" }
  }'
```

The answer is `{"decision": true}` or `{"decision": false}`. An unknown subject is a `false` decision, not an error.

### 5. Add UI hints

Hide or disable controls that the user cannot use. Do this for usability only. Anyone can call the API without the UI, so every hint needs the server check of step 4 behind it.

- React: `<Protect permission="reports.edit">`, `<Protect zanzibar={{ object, relation }}>`, `<Protect abac={{ resourceType, action, resourceId }}>`, and the hooks `usePermission`, `useZanzibar`, `useAbac` from `@lumoauth/react`. They use the signed-in user's token and treat a failed request as "not allowed".
- Other front ends: `client.permissions.checkBulk([...])` from `@lumoauth/client` returns `{ results: { 'reports.edit': true, ... } }` in one request for a whole page.
- Or let the backend return the decisions with the page data, so the browser makes no check calls.

### 6. Plan caching and failure

- **Fail closed.** A timeout, a network error, a `5xx` or an unexpected body is a denial. Never default to "allowed". Decide with the user whether a denial from an outage shows as `403` or `503`.
- `@lumoauth/backend` and `@lumoauth/client` cache `permissions.check` and `checkBulk` results in memory for 5 minutes by default, per permission, context and subject. Relationship and ABAC checks are not cached. Set `cache: false` or `cache: { ttl: 30_000 }` when a role change must show sooner, or when attribute policies depend on time or stored attributes. The other SDKs do not cache.
- If the application adds its own cache, key it by user, action and object, keep the lifetime short, and never cache across users.
- Use the bulk call to cut round trips: at most 100 permissions per `check-bulk` request.
- Set a request timeout on the check that fits the latency budget of the route.

### 7. Let an administrator test and draft rules

- **Access control → Test access** has one tester per model: roles and permissions (`/orgs/{orgId}/portal/permissions/tester`), attribute rules (`/orgs/{orgId}/portal/abac/tester`) and relationships (`/orgs/{orgId}/portal/zanzibar/tester`). Each shows the decision and where it comes from. Ask the user to test one allowed and one denied case before the code relies on a rule.
- **AI policy authoring** (`/orgs/{orgId}/portal/policies/author`, also reached through **Draft with AI** on the roles page) turns a plain description into a draft of roles, permissions and relationship namespaces. The administrator reviews the draft and applies it. It does not write attribute policies, and it attaches only permissions that the administrator holds. The page shows a notice when AI features are not available to the organization.

### 8. Continue with the model skill

Hand over to `lumoauth-rbac`, `lumoauth-abac` or `lumoauth-rebac` to create the roles, policies or relationship model and to write the check in the project's language.

## Verify

1. With the API key, ask about a user who should be allowed and one who should not:

```bash
curl -s -X POST "https://app.lumoauth.dev/api/v1/authz/check" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"permission":"reports.edit","subject":{"type":"user","id":"0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"}}'
```

Expected: `"allowed": true` and `"subject_id"` equal to the ID that you sent. If `subject_id` is another ID, the check answered for the caller.

2. Call the protected route as both users. Expect success for the first and `403` for the second.
3. Call the protected route with the UI bypassed (curl with the second user's token). It must still return `403`.
4. Stop the check from succeeding (for example with a wrong base URL in a test) and confirm that the route denies.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Every check returns `true` | No subject in the call, so the answer is about the API key's creator | Pass `{ userId }` (`subject` in raw HTTP) |
| `403` with code `INSUFFICIENT_PERMISSIONS` | The call names another subject, and the credential has neither the `authz:check` scope (with `policies.view` for its owner) nor the `authz.check` permission | Create the API key with `authz:check` as an administrator who holds `policies.view` |
| `404` with code `SUBJECT_NOT_FOUND` | The ID is not a user of this organization | Send the `sub` claim, not an email or an application ID |
| `403 forbidden` with `details.required_scopes` | The route needs a user scope: `authz:read` for the permission list, `abac:read` or `abac:write` for ABAC | Add the scope to the application's allowed scopes and request it at sign-in. An API key cannot hold these scopes |
| `401` when a backend forwards the user's token to the check | The token was issued for the application's own API (`resource=...`) | Check with the API key and the user ID |
| `400` on a check | An API key and a bearer token in one request, or more than 100 permissions | Send one credential. Split the list |
| The UI hides a button but the API still performs the action | Only the browser checks | Add the server check |
| Access stays for minutes after a role is removed | The JS SDK cache (5 minutes) or the application's own cache | Lower the lifetime or disable the cache |
| An outage lets every request through | The code treats an exception as allowed | Deny on every error |
| A relationship is ignored by `permissions.check` | That call does not read object relationships | Use `zanzibar.check` or the AuthZEN evaluation |
| An allow policy gives access to users without the role | An allow policy grants on its own in the permission check | Put the role or permission in the policy's conditions, or use a deny policy |

## Related skills

- `lumoauth-rbac`: roles, permissions, groups.
- `lumoauth-abac`: attributes and policies.
- `lumoauth-rebac`: relationships, check and expand.
- `lumoauth-api-protection`: verify the access token before any check.
- `lumoauth-admin-api`: API keys and their scopes.
- `lumoauth-agent-identity` and `lumoauth-agent-approvals`: AI agents as subjects, and human approval of agent actions.

## References

- [references/check-api.md](references/check-api.md): every decision route with its body, answer, credential rule, limits and error codes. Read it when you call the API without an SDK or debug an error from a check.
- https://docs.lumoauth.dev/authorization
- https://docs.lumoauth.dev/authorization/check
- https://docs.lumoauth.dev/authorization/permissions
- https://docs.lumoauth.dev/user-guide/access-control/overview
- https://docs.lumoauth.dev/user-guide/access-control/choosing-a-model
- https://docs.lumoauth.dev/user-guide/access-control/ai-policy-authoring
