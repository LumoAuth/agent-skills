---
name: lumoauth-rebac
description: >-
  Adds relationship-based access control (ReBAC, the Google Zanzibar model) with LumoAuth: object
  types (namespaces) and relations, relation tuples (object#relation@subject), usersets such as
  team:eng#member, the namespace schema (_this, computed_userset, tuple_to_userset, union,
  intersection), and the check and expand calls. Covers zanzibar.check, zanzibar.expand and the
  isOwner / isEditor / isViewer / isMember / isAdmin helpers in @lumoauth/backend,
  @lumoauth/client, @lumoauth/react (Protect zanzibar, useZanzibar), Python, Go, PHP, .NET and
  Java, the /api/v1/authz/zanzibar/check and /expand routes, the authz:check rule for asking about
  another subject, and modelling patterns for ownership, folders and parents, teams and sharing.
  Use when the user asks for per-object or per-resource permissions, document or folder sharing,
  "can this user view this document", inherited access through a parent, team access to
  resources, a Zanzibar or OpenFGA-style model, or "who has access to this object".
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth relationship-based access (ReBAC, Zanzibar)

Decide access to one specific object from stored relationships: "user U is an editor of document D", "team T can view folder F", "document D is in folder F". This skill designs the model, has the organization's administrator enter it in the portal, and adds the `check` and `expand` calls to the application code.

## When to use

- Access depends on the object: this document, this project, this folder.
- Access is inherited: viewers of a folder can view its documents.
- A team or group gets access to a resource as a whole.
- The application must show who has access to an object.

Do not use this skill for:

- Access that follows from a job role and is the same for every object: use `lumoauth-rbac`.
- Rules on time, IP address or attributes of the user or resource: use `lumoauth-abac`.
- Choosing between the models: use `lumoauth-authorization`.
- AI agents as the subject of a relationship (`agent:<agent id>`) and per-tool grants for MCP servers: use `lumoauth-agent-identity` and `lumoauth-mcp-server`.

**Read this limit before you design anything.** LumoAuth exposes `check` and `expand` through the API and the SDKs. It has no API, SDK method or CLI command that writes or deletes a relation tuple or a namespace. Administrators create them in the portal. An application therefore cannot record "Alice shared this document with Bob" in LumoAuth at run time. Use LumoAuth relationships for structure that administrators manage (teams, projects, folders, tenant-level resources). When end users create relationships at run time, keep those in the application's own database and check them there. Tell the user this before you write code.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL, for example `acme-corp` |
| Organization API key (`lmk_...`) with the `authz:check` scope | Portal: `/orgs/{orgId}/portal/settings/api-keys`. The administrator who creates it must hold `policies.view`. Store it in an environment variable on the server |
| The object types, relations and who should get access through what | From the user |

Check these conditions with the user:

1. Relationships are available to the organization. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix). Without the feature every relationship check answers `allowed: false`, with no error, and the portal does not let an administrator create a namespace or a tuple.
2. The administrator who enters the model holds `zanzibar.create` (and `zanzibar.edit`, `zanzibar.delete` for changes). The built-in Tenant Admin role has them.

## Steps

### 1. Write the model as tuples

A relation tuple is one stored fact:

```
object#relation@subject

document:q4-report#owner@user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20
document:q4-report#parent@folder:finance
folder:finance#viewer@team:finance#member
team:finance#member@user:0192f0d1-88aa-7c3e-b1f0-5d2a9c4e7a11
```

| Part | Form | Meaning |
|---|---|---|
| Object | `namespace:id` | The resource. The namespace is the object type |
| Relation | a name defined in the namespace | The kind of link: `owner`, `editor`, `viewer`, `member`, `parent` |
| Subject | `namespace:id` | One identity or object, for example `user:<id>` or `folder:finance` |
| Subject (userset) | `namespace:id#relation` | Everyone who has that relation on that object: `team:finance#member` |

Rules:

- For a user, write `user:<LumoAuth user ID>`. The ID is the UUID in the `sub` claim of the user's token. LumoAuth lets a user check "myself" only when the subject is exactly `user:<own ID>`.
- Namespace names use lowercase letters, digits and underscores and start with a letter. `permission` and `role` are reserved.
- Do not put `:`, `#` or `*` in an ID. The portal refuses `*`.
- Give access to a team with a userset subject (`team:finance#member`). A subject `team:finance` without `#member` names the team object itself, not its members.

Write the tuples that the user's requirements need, then derive the namespaces and relations from them. Start with few relations. For worked patterns (ownership, folders, teams, sharing, both-conditions) read [references/modelling.md](references/modelling.md).

### 2. Define the namespaces

Each namespace has a schema: a JSON object with one key, `relations`. Each relation says how it is computed.

| Rewrite | Meaning |
|---|---|
| `{"_this": {"relation": "viewer"}}` | The subjects stored in tuples for this relation. Name the relation itself |
| `{"computed_userset": {"relation": "editor"}}` | Everyone who has another relation on the same object |
| `{"tuple_to_userset": {"tupleset": {"relation": "parent"}, "computed_userset": {"relation": "viewer"}}}` | Follow the `parent` tuples of this object and take everyone who is `viewer` of each parent |
| `{"union": [ ... ]}` | Any of the listed rewrites |
| `{"intersection": [ ... ]}` | All of the listed rewrites |

Namespace `document`: owners can edit, editors can view, and viewers of the parent folder can view.

```json
{
  "relations": {
    "parent": { "_this": { "relation": "parent" } },
    "owner": { "_this": { "relation": "owner" } },
    "editor": {
      "union": [
        { "computed_userset": { "relation": "owner" } },
        { "_this": { "relation": "editor" } }
      ]
    },
    "viewer": {
      "union": [
        { "computed_userset": { "relation": "editor" } },
        { "_this": { "relation": "viewer" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "parent" },
            "computed_userset": { "relation": "viewer" }
          }
        }
      ]
    }
  }
}
```

Namespace `folder`:

```json
{
  "relations": {
    "owner": { "_this": { "relation": "owner" } },
    "editor": {
      "union": [
        { "computed_userset": { "relation": "owner" } },
        { "_this": { "relation": "editor" } }
      ]
    },
    "viewer": {
      "union": [
        { "computed_userset": { "relation": "editor" } },
        { "_this": { "relation": "viewer" } }
      ]
    }
  }
}
```

Namespace `team`:

```json
{ "relations": { "member": { "_this": { "relation": "member" } } } }
```

A check on a relation that the namespace does not define answers `allowed: false`. Every namespace that appears as an object, as a parent, or on the left of a userset needs a schema. The `user` namespace needs none.

### 3. Have an administrator enter the model in the portal

Give the user the schemas and the tuple list from steps 1 and 2 and these instructions. You cannot do this step through an API.

1. Open **Access control → Relationships** (`/orgs/{orgId}/portal/zanzibar/`).
2. **Create namespace** for each object type: enter the name and the schema. The form's **Document sharing** example produces the `document` schema above.
3. Open the **Tuples** tab, then **Add relationship** for each tuple: object namespace and object ID, relation, user namespace and user ID, and the optional user relation for a userset (`team`, `finance`, `member`).
4. **Revoke relationship** in the tuple list removes a tuple. The portal refuses a duplicate tuple.

The AI policy author (`/orgs/{orgId}/portal/policies/author`) can draft namespaces and seed tuples from a description when AI features are available to the organization. An administrator reviews the draft and applies it.

### 4. Test in the portal

On the **Tester** tab (`/orgs/{orgId}/portal/zanzibar/tester`) the administrator picks an object, a relation and a user and runs the check. The result shows where the access comes from. Test one case that must be allowed and one that must be denied before the code relies on the model.

### 5. Check in code, on the server

Put the check in the request handler of every action on the object, after the access token of the request has been verified (see `lumoauth-api-protection`). The backend uses an API key with the `authz:check` scope and names the user as the subject.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!, // https://app.lumoauth.dev
  secretKey: process.env.LUMOAUTH_API_KEY!, // lmk_..., scope authz:check
});

export async function userCan(
  userId: string,
  relation: 'viewer' | 'editor' | 'owner',
  documentId: string,
): Promise<boolean> {
  try {
    return await lumo.zanzibar.check({
      object: `document:${documentId}`,
      relation,
      subject: `user:${userId}`,
    });
  } catch (error) {
    console.error('LumoAuth relationship check failed', error);
    return false; // fail closed
  }
}

// In a handler: if (!(await userCan(claims.sub, 'editor', req.params.id))) return res.status(403).end();
```

```python
import os

from lumoauth import LumoAuth
from lumoauth.errors import LumoAuthError

lumo = LumoAuth(
    base_url=os.environ["LUMOAUTH_URL"],
    api_key=os.environ["LUMOAUTH_API_KEY"],  # lmk_..., scope authz:check
)


def user_can(user_id: str, relation: str, document_id: str) -> bool:
    try:
        return lumo.zanzibar.check(f"document:{document_id}", relation, f"user:{user_id}")
    except LumoAuthError:
        return False  # fail closed
```

The helpers `isOwner`, `isEditor`, `isViewer`, `isMember` and `isAdmin` take `(object, subject)` and call `check` with the relation `owner`, `editor`, `viewer`, `member` or `admin`. They work only when the namespace defines a relation with that exact name.

Rules for the check:

- Check the relation that the action needs (`editor` to save, `viewer` to read). The engine follows the schema, so an owner passes an `editor` check.
- Pass a concrete subject (`user:<id>`). Do not pass a userset as the subject of a check.
- Validate the object ID from the request before you build the object string. A malformed string is a denial, not an error to retry.
- The SDKs do not cache relationship checks. Each call is one request. Cache a result in the application only for a short time, and never across users.

For Go, PHP, .NET, Java, the browser client and `expand`, read [references/sdk-calls.md](references/sdk-calls.md).

### 6. Hide UI by relationship (hint only)

In a React app that already has `LumoAuthProvider` (see `lumoauth-react`):

```tsx
import { Protect } from '@lumoauth/react';

export function DocumentActions({ documentId }: { documentId: string }) {
  return (
    <Protect zanzibar={{ object: `document:${documentId}`, relation: 'editor' }} fallback={null}>
      <button type="button">Edit</button>
    </Protect>
  );
}
```

Without `subject`, `<Protect>` asks about the signed-in user (`user:<sub>`), which any signed-in user may do. It renders the fallback when nobody is signed in and when the request fails. The server check of step 5 must exist for the same action.

### 7. List who has access (optional)

`expand` returns every subject that has a relation on an object, as a tree that follows the schema. It always shows other subjects, so it needs the `authz:check` privilege. Call it from the server.

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!,
  secretKey: process.env.LUMOAUTH_API_KEY!,
});

const tree = await lumo.zanzibar.expand({ object: 'document:q4-report', relation: 'viewer' });
// { type: 'union', object, relation, children: [ { type: 'leaf', subjects: ['user:...', 'team:finance#member'], ... } ], subjects: [] }
```

Leaves carry `subjects`. Usersets are listed as written (`team:finance#member`) and are not resolved to their members. There is no call that lists the objects that a user can access.

## Verify

1. The portal Tester returns the expected result for an allowed and a denied case.
2. The API gives the same answers with the API key:

```bash
curl -s -X POST "https://app.lumoauth.dev/api/v1/authz/zanzibar/check" \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"object":"document:q4-report","relation":"viewer","subject":"user:0192f0d1-88aa-7c3e-b1f0-5d2a9c4e7a11"}'
```

Expected: `{"allowed": true, "object": "document:q4-report", "relation": "viewer", "subject": "user:0192f0d1-..."}`. The path has no `/orgs/{orgId}` prefix: LumoAuth takes the organization from the credential.

3. Call the protected route of the application as a user with access and as a user without. Expect `403` for the second.
4. Remove a tuple in the portal and confirm that the route now refuses the user.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Every check returns `allowed: false`, also for tuples that exist | The organization does not have the relationships feature | See https://docs.lumoauth.dev/pricing-matrix. The portal's Relationships page shows a notice |
| `allowed: false` for one relation | The namespace does not define that relation, or the relation lacks `{"_this": {"relation": "<its own name>"}}` | Fix the schema in the portal |
| A team's members do not get access | The tuple's subject is `team:finance` without the user relation `member`, or the `team` namespace has no `member` relation | Recreate the tuple with user relation `member`. Define the `team` namespace |
| A folder's viewers cannot view its documents | The document has no `parent` tuple, the `viewer` relation lacks the `tuple_to_userset` rewrite, or the `folder` namespace has no `viewer` relation | Add the tuple and the rewrite |
| `403` with code `INSUFFICIENT_PERMISSIONS` | The subject is not the caller, and the credential lacks the `authz:check` scope (or its owner lacks `policies.view`) and the caller lacks the `authz.check` permission | Use an API key with `authz:check` on the server |
| `403` for a user who checks itself in the browser | The subject is not `user:<the user's own LumoAuth ID>` (for example `user:alice` or an email) | Use the `sub` claim as the ID in tuples and in checks |
| `400` "Missing required fields" | The body uses `user` on `/api/v1/authz/zanzibar/check`, or `subject` on `/orgs/{orgId}/api/v1/zanzibar/check` | The unscoped route (the one that the SDKs call) takes `subject`. The organization-scoped route takes `user` |
| The agent looks for a "write tuple" call | None exists | Tuples are entered in the portal. See the limit under "When to use" |
| A deep or cyclic hierarchy is denied | A check stops with a denial after 2,000 graph nodes and at a nesting depth of 10 | Flatten the model. Avoid long parent chains |
| `expand` shows a team and not its people | Usersets are not resolved in the tree | Call `expand` again for `team:finance` and `member` |

## Related skills

- `lumoauth-authorization`: choose the model, the rules for who may ask about whom, where to enforce.
- `lumoauth-rbac`: roles and permissions for access that does not depend on the object.
- `lumoauth-abac`: conditions on attributes and context.
- `lumoauth-api-protection`: verify the access token before the relationship check.
- `lumoauth-node-backend`: set up `@lumoauth/backend`.

## References

- [references/modelling.md](references/modelling.md): modelling patterns with schemas and tuples, the schema rules and the engine limits. Read it when you design a model that is not the document and folder example.
- [references/sdk-calls.md](references/sdk-calls.md): `check`, the helpers and `expand` in every SDK, and the raw HTTP routes. Read it when the code is not TypeScript or Python, or when you call the API directly.
- https://docs.lumoauth.dev/user-guide/access-control/zanzibar
- https://docs.lumoauth.dev/authorization/zanzibar
- https://docs.lumoauth.dev/user-guide/access-control/ai-policy-authoring
