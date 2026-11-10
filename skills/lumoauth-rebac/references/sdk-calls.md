# Relationship checks in every SDK

One verified relationship check per LumoAuth SDK, plus the helpers and `expand`. The SDKs call `POST /api/v1/authz/zanzibar/check` and `POST /api/v1/authz/zanzibar/expand`. These routes have no `/orgs/{orgId}` prefix: LumoAuth takes the organization from the credential.

## Who may ask what

| Call | Credential | Allowed |
|---|---|---|
| `check` with subject `user:<own LumoAuth ID>` | The user's own access token | Always |
| `check` with any other subject (another user, an agent, a userset) | User token | Only when the user holds the `authz.check` permission, or the token has the `authz:check` scope and the user holds `policies.view` |
| `check` with any subject | Organization API key (`lmk_...`) | When the key has the `authz:check` scope and its creator holds `policies.view`. Without the scope, only the key creator's own `user:<id>` |
| `expand` | Any | Only with the `authz.check` permission or the `authz:check` scope, as above. There is no "self" form |

A refused request gets `403` with `"code": "INSUFFICIENT_PERMISSIONS"`.

Rules for every SDK:

- `object` is `namespace:id`. `subject` is `namespace:id`. The SDKs validate this format before they send a request.
- Use the LumoAuth user ID (the `sub` claim) in `user:<id>`.
- An error is a denial. Never treat an exception as "allowed".
- Keep the API key on the server.
- No SDK caches relationship checks.

The examples read `LUMOAUTH_URL` (for example `https://app.lumoauth.dev`) and `LUMOAUTH_API_KEY` from the environment.

## TypeScript: `@lumoauth/backend` (server)

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!,
  secretKey: process.env.LUMOAUTH_API_KEY!,
});

const subject = 'user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20';

// check({ object, relation, subject }) -> boolean
const canEdit = await lumo.zanzibar.check({ object: 'document:q4-report', relation: 'editor', subject });

// Helpers: (object, subject) -> boolean, with the relation owner / editor / viewer / member / admin
const isOwner = await lumo.zanzibar.isOwner('document:q4-report', subject);
const isEditor = await lumo.zanzibar.isEditor('document:q4-report', subject);
const isViewer = await lumo.zanzibar.isViewer('document:q4-report', subject);
const isMember = await lumo.zanzibar.isMember('team:finance', subject);

// expand({ object, relation }) -> ZanzibarUsersetNode
const tree = await lumo.zanzibar.expand({ object: 'document:q4-report', relation: 'viewer' });
```

`checkDetailed` takes the same argument as `check` and returns `{ allowed, object, relation, subject }`.

## TypeScript: `@lumoauth/client` (browser, the signed-in user)

```ts
import { LumoAuth } from '@lumoauth/client';

declare function getAccessToken(): Promise<string>; // from the app's session code
declare const currentUserId: string; // the `sub` claim of the signed-in user

const client = new LumoAuth({
  baseUrl: 'https://app.lumoauth.dev',
  token: () => getAccessToken(),
});

const canEdit = await client.zanzibar.check({
  object: 'document:q4-report',
  relation: 'editor',
  subject: `user:${currentUserId}`,
});
```

## React: `@lumoauth/react`

```tsx
import { Protect, useUser, useZanzibar } from '@lumoauth/react';

export function EditLink({ documentId }: { documentId: string }) {
  return (
    <Protect zanzibar={{ object: `document:${documentId}`, relation: 'editor' }} fallback={null}>
      <a href={`/documents/${documentId}/edit`}>Edit</a>
    </Protect>
  );
}

export function DeleteButton({ documentId }: { documentId: string }) {
  const user = useUser();
  const { allowed, isLoading } = useZanzibar({
    object: `document:${documentId}`,
    relation: 'owner',
    subject: `user:${user?.sub ?? ''}`,
  });
  return (
    <button type="button" disabled={isLoading || !allowed}>
      Delete
    </button>
  );
}
```

`<Protect zanzibar>` fills in `user:<sub>` of the signed-in user when `subject` is left out. `useZanzibar` needs the subject. Both need `LumoAuthProvider` above them (see `lumoauth-react`) and return "not allowed" when the request fails. They are UI hints. The server must check again.

## Python: `lumoauth`

```python
import os

from lumoauth import LumoAuth

lumo = LumoAuth(
    base_url=os.environ["LUMOAUTH_URL"],
    api_key=os.environ["LUMOAUTH_API_KEY"],
)

subject = "user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"

# check(object, relation, subject) -> bool
can_edit = lumo.zanzibar.check("document:q4-report", "editor", subject)

# Helpers: (object, subject) -> bool
is_owner = lumo.zanzibar.is_owner("document:q4-report", subject)
is_editor = lumo.zanzibar.is_editor("document:q4-report", subject)
is_viewer = lumo.zanzibar.is_viewer("document:q4-report", subject)
is_member = lumo.zanzibar.is_member("team:finance", subject)

# expand(object, relation) -> dict (the root node of the tree)
tree = lumo.zanzibar.expand("document:q4-report", "viewer")
```

`check_detailed` returns the full response dict. `is_admin` also exists.

## Go: `github.com/lumoauth/lumo-auth-go`

```go
package main

import (
	"context"
	"log"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	client, err := lumoauth.New(
		lumoauth.WithBaseURL(os.Getenv("LUMOAUTH_URL")),
		lumoauth.WithAPIKey(os.Getenv("LUMOAUTH_API_KEY")),
	)
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	subject := "user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"

	// Check(ctx, object, relation, subject) (bool, error)
	canEdit, err := client.Zanzibar.Check(ctx, "document:q4-report", "editor", subject)
	if err != nil {
		canEdit = false // fail closed
	}

	// Helpers: (ctx, object, subject) (bool, error)
	isOwner, _ := client.Zanzibar.IsOwner(ctx, "document:q4-report", subject)
	isViewer, _ := client.Zanzibar.IsViewer(ctx, "document:q4-report", subject)

	// Expand(ctx, object, relation) (*ZanzibarUsersetNode, error)
	tree, err := client.Zanzibar.Expand(ctx, "document:q4-report", "viewer")
	if err == nil {
		log.Println(tree.Type, len(tree.Children), tree.Subjects)
	}
	log.Println(canEdit, isOwner, isViewer)
}
```

`IsEditor`, `IsMember`, `IsAdmin` and `CheckDetailed` also exist.

## PHP: `lumoauth/lumoauth`

```php
<?php

declare(strict_types=1);

use LumoAuth\LumoAuth;

$lumo = new LumoAuth(
    apiKey: getenv('LUMOAUTH_API_KEY') ?: null,
    baseUrl: getenv('LUMOAUTH_URL') ?: null,
);

$subject = 'user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20';

// check(string $object, string $relation, string $subject): bool
$canEdit = $lumo->zanzibar->check('document:q4-report', 'editor', $subject);

// Helpers: (string $object, string $subject): bool
$isOwner = $lumo->zanzibar->isOwner('document:q4-report', $subject);
$isViewer = $lumo->zanzibar->isViewer('document:q4-report', $subject);

// expand(string $object, string $relation): array (the root node of the tree)
$tree = $lumo->zanzibar->expand('document:q4-report', 'viewer');
```

`isEditor`, `isMember`, `isAdmin` and `checkDetailed` also exist.

## C#: `LumoAuth`

```csharp
using LumoAuth;
using LumoAuth.Models;

using var lumo = new LumoAuthClient(new LumoAuthOptions
{
    BaseUrl = Environment.GetEnvironmentVariable("LUMOAUTH_URL"),
    ApiKey = Environment.GetEnvironmentVariable("LUMOAUTH_API_KEY"),
});

var subject = "user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20";

// CheckAsync(string @object, string relation, string subject, CancellationToken ct = default) -> Task<bool>
bool canEdit = await lumo.Zanzibar.CheckAsync("document:q4-report", "editor", subject);

// Helpers: (string @object, string subject, CancellationToken ct = default) -> Task<bool>
bool isOwner = await lumo.Zanzibar.IsOwnerAsync("document:q4-report", subject);
bool isViewer = await lumo.Zanzibar.IsViewerAsync("document:q4-report", subject);

// ExpandAsync(string @object, string relation, CancellationToken ct = default) -> Task<ZanzibarUsersetNode>
ZanzibarUsersetNode tree = await lumo.Zanzibar.ExpandAsync("document:q4-report", "viewer");
IReadOnlyList<string> everyone = tree.AllSubjects();
```

`IsEditorAsync`, `IsMemberAsync`, `IsAdminAsync` and `CheckDetailedAsync` also exist.

## Java: `io.lumoauth:lumo-auth-java`

```java
import io.lumoauth.LumoAuth;
import io.lumoauth.model.ZanzibarUsersetNode;

public class RelationshipExample {
    public static void main(String[] args) {
        LumoAuth lumo = LumoAuth.builder()
            .baseUrl(System.getenv("LUMOAUTH_URL"))
            .apiKey(System.getenv("LUMOAUTH_API_KEY"))
            .build();

        String subject = "user:0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20";

        // check(String object, String relation, String subject) -> boolean
        boolean canEdit = lumo.zanzibar().check("document:q4-report", "editor", subject);

        // Helpers: (String object, String subject) -> boolean
        boolean isOwner = lumo.zanzibar().isOwner("document:q4-report", subject);
        boolean isViewer = lumo.zanzibar().isViewer("document:q4-report", subject);

        // expand(String object, String relation) -> ZanzibarUsersetNode
        ZanzibarUsersetNode tree = lumo.zanzibar().expand("document:q4-report", "viewer");
        System.out.println(tree.type() + " " + tree.subjects());
    }
}
```

`isEditor`, `isMember`, `isAdmin` and `checkDetailed` also exist.

## The expand tree

Every node has the same fields:

| Field | Type | Meaning |
|---|---|---|
| `type` | `union`, `intersection` or `leaf` | How the children combine. A leaf has no children |
| `object` | string | The object that the node was expanded for |
| `relation` | string | The relation that the node was expanded for |
| `children` | array of nodes | Empty for a leaf |
| `subjects` | array of strings | On a leaf: `user:<id>`, `agent:<id>` or a userset such as `team:finance#member`, as stored |

To collect everyone, walk the tree and gather the `subjects` of every leaf. For each userset, call `expand` again on its object and relation. Under an `intersection` node a subject has the relation only when it appears under every child.

## Raw HTTP

| Route | Body | Answer |
|---|---|---|
| `POST /api/v1/authz/zanzibar/check` | `{"object": "document:q4-report", "relation": "editor", "subject": "user:<id>"}` | `{"allowed": true, "object": "...", "relation": "...", "subject": "..."}` |
| `POST /api/v1/authz/zanzibar/expand` | `{"object": "document:q4-report", "relation": "viewer"}` | `{"tree": { ... }}` |
| `POST /orgs/{orgId}/api/v1/zanzibar/check` | `{"object": "...", "relation": "...", "user": "user:<id>"}` | `{"allowed": true, "object": "...", "relation": "...", "user": "..."}` |
| `POST /orgs/{orgId}/api/v1/zanzibar/expand` | `{"object": "...", "relation": "..."}` | `{"tree": { ... }}` |

The two pairs do the same work. The unscoped pair names the subject field `subject`, and the organization-scoped pair names it `user`. The organization in the path must be the organization of the credential, or the request is refused.

Send an API key in the `X-API-Key` header and a user token as `Authorization: Bearer <token>`. Never send both in one request.

Errors on the unscoped routes: `400 MISSING_FIELDS`, `400 MALFORMED_OBJECT` (expand: the object is not `namespace:id`), `400 ZANZIBAR_CHECK_FAILED`, `403 INSUFFICIENT_PERMISSIONS`. An organization without the relationships feature gets `allowed: false` from every check, not an error.
