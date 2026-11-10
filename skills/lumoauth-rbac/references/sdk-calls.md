# Permission checks in every SDK

One verified permission check per LumoAuth SDK, plus the bulk, any and all variants. All calls go to `POST /api/v1/authz/check` and its sibling routes. These routes have no `/orgs/{orgId}` prefix: LumoAuth takes the organization from the credential.

## Which credential, which subject

| Credential in the SDK | A check without a subject is about | To check another user |
|---|---|---|
| User access token (browser, or a backend that forwards the user's token) | The user of the token | Not possible unless the user holds the `authz.check` permission or the token has the `authz:check` scope and the user holds `policies.view` |
| Organization API key (`lmk_...`, backend) | The administrator who created the key | Pass the user ID. The key needs the `authz:check` scope and its creator must hold `policies.view` |

Rules that apply to every SDK:

- The user ID is the LumoAuth user ID (a UUID): the `sub` claim of the user's access token. An email does not work.
- Pass a user ID or an agent ID, not both.
- A check that fails with an error is a denial. Never treat an exception as "allowed".
- Keep the API key on the server. Never ship it in browser or mobile code.
- A user access token that was issued for another resource server (a token requested with `resource=https://api.example.com`) is refused by LumoAuth's own API. A backend that receives such tokens checks permissions with an API key and the user ID.

The examples read `LUMOAUTH_URL` (for example `https://app.lumoauth.dev`) and `LUMOAUTH_API_KEY` from the environment.

## TypeScript: `@lumoauth/backend` (server)

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL!,
  secretKey: process.env.LUMOAUTH_API_KEY!,
});

const userId = '0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20';

// check(permission, context?, { userId } | { agentId }) -> boolean
const canEdit = await lumo.permissions.check('reports.edit', undefined, { userId });

// checkBulk(permissions, context?, subject?) -> { results: Record<string, boolean>, ... }
const { results } = await lumo.permissions.checkBulk(
  ['reports.view', 'reports.edit', 'reports.delete'],
  undefined,
  { userId },
);

// checkAny / checkAll(permissions, context?, subject?) -> boolean
const canOpen = await lumo.permissions.checkAny(['reports.view', 'reports.edit'], undefined, { userId });
const canPublish = await lumo.permissions.checkAll(['reports.edit', 'reports.publish'], undefined, { userId });
```

`checkDetailed`, `checkAnyDetailed` and `checkAllDetailed` take the same arguments and return the full response. `@lumoauth/backend` throws when it is constructed in a browser. Requires Node.js 18 or later.

Cache: `check` and `checkBulk` results are kept in memory for 5 minutes (at most 1,000 entries) unless the constructor gets `cache: false` or `cache: { ttl: 30_000, maxSize: 500 }`. `lumo.permissions.clearCache()` empties it.

## TypeScript: `@lumoauth/client` (browser, the signed-in user)

```ts
import { LumoAuth } from '@lumoauth/client';

declare function getAccessToken(): Promise<string>; // from the app's session code

const client = new LumoAuth({
  baseUrl: 'https://app.lumoauth.dev',
  token: () => getAccessToken(),
});

const canEdit = await client.permissions.check('reports.edit');
const { results } = await client.permissions.checkBulk(['reports.edit', 'reports.delete']);
```

In a browser the client throws when it is given an `lmk_` API key. The same cache options apply. Call `client.clearCache()` after the user's roles change.

To list every permission of the signed-in user, the token needs the `authz:read` scope:

```ts
const slugs = await client.permissions.listSlugs(); // Set<string>
```

Without the scope the call throws `LumoAuthPermissionDeniedError`, and `error.requiredScopes` is `['authz:read']`.

## React: `@lumoauth/react`

```tsx
import { Protect, usePermission } from '@lumoauth/react';

export function EditButton() {
  const { allowed, isLoading } = usePermission('reports.edit');
  if (isLoading || !allowed) return null;
  return <button type="button">Edit</button>;
}

export function DeletePanel() {
  return (
    <Protect permission="reports.delete" fallback={<p>You cannot delete reports.</p>}>
      <button type="button">Delete</button>
    </Protect>
  );
}
```

Both need `LumoAuthProvider` above them (see `lumoauth-react`). Both check the signed-in user and return "not allowed" when the request fails. They are UI hints. The server must check again.

## Python: `lumoauth`

```python
import os

from lumoauth import LumoAuth

lumo = LumoAuth(
    base_url=os.environ["LUMOAUTH_URL"],
    api_key=os.environ["LUMOAUTH_API_KEY"],
)

user_id = "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"

# check(permission, context=None, *, user_id=None, agent_id=None) -> bool
can_edit = lumo.permissions.check("reports.edit", user_id=user_id)

# check_bulk(permissions, context=None, *, user_id=None, agent_id=None) -> dict with "results"
results = lumo.permissions.check_bulk(["reports.view", "reports.edit"], user_id=user_id)["results"]

can_open = lumo.permissions.check_any(["reports.view", "reports.edit"], user_id=user_id)
can_publish = lumo.permissions.check_all(["reports.edit", "reports.publish"], user_id=user_id)
```

To check as the user with the user's own token, build the client with `token_provider=lambda: access_token` and omit `user_id`. Errors derive from `lumoauth.errors.LumoAuthError`. Requires Python 3.9 or later.

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
	opts := &lumoauth.CheckOptions{UserID: "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20"}

	// Check(ctx, permission, opts) (bool, error)
	canEdit, err := client.Permissions.Check(ctx, "reports.edit", opts)
	if err != nil {
		canEdit = false // fail closed
	}

	// CheckBulk(ctx, permissions, opts) (*PermissionBulkCheck, error)
	bulk, err := client.Permissions.CheckBulk(ctx, []string{"reports.view", "reports.edit"}, opts)
	if err == nil {
		log.Println(bulk.Results["reports.view"])
	}

	canOpen, _ := client.Permissions.CheckAny(ctx, []string{"reports.view", "reports.edit"}, opts)
	canPublish, _ := client.Permissions.CheckAll(ctx, []string{"reports.edit", "reports.publish"}, opts)
	log.Println(canEdit, canOpen, canPublish)
}
```

Pass `nil` for `opts` to check the caller. `CheckOptions` also has `Context` and `AgentID`. To check as the user, build the client with `lumoauth.WithAccessToken(token)`. Requires Go 1.22 or later.

## PHP: `lumoauth/lumoauth`

```php
<?php

declare(strict_types=1);

use LumoAuth\LumoAuth;

$lumo = new LumoAuth(
    apiKey: getenv('LUMOAUTH_API_KEY') ?: null,
    baseUrl: getenv('LUMOAUTH_URL') ?: null,
);

$userId = '0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20';

// check(string $permission, ?array $context = null, ?string $userId = null, ?string $agentId = null): bool
$canEdit = $lumo->permissions->check('reports.edit', userId: $userId);

// checkBulk(array $permissions, ?array $context = null, ?string $userId = null, ?string $agentId = null): array
$results = $lumo->permissions->checkBulk(['reports.view', 'reports.edit'], userId: $userId)['results'];

$canOpen = $lumo->permissions->checkAny(['reports.view', 'reports.edit'], userId: $userId);
$canPublish = $lumo->permissions->checkAll(['reports.edit', 'reports.publish'], userId: $userId);
```

To check as the user, pass `tokenProvider: fn () => $accessToken` and omit `userId`. Errors derive from `LumoAuth\Error\LumoAuthError`. Requires PHP 8.1 or later. For Laravel and Symfony wiring use `lumoauth-laravel` and `lumoauth-symfony`.

## C#: `LumoAuth`

```csharp
using LumoAuth;
using LumoAuth.Models;

using var lumo = new LumoAuthClient(new LumoAuthOptions
{
    BaseUrl = Environment.GetEnvironmentVariable("LUMOAUTH_URL"),
    ApiKey = Environment.GetEnvironmentVariable("LUMOAUTH_API_KEY"),
});

var userId = "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20";

// CheckAsync(string permission, CheckOptions? options = null, CancellationToken ct = default) -> Task<bool>
bool canEdit = await lumo.Permissions.CheckAsync("reports.edit", CheckOptions.ForUser(userId));

// CheckBulkAsync(IEnumerable<string> permissions, CheckOptions? options = null, ...) -> Task<PermissionBulkCheck>
PermissionBulkCheck bulk = await lumo.Permissions.CheckBulkAsync(
    new[] { "reports.view", "reports.edit" }, CheckOptions.ForUser(userId));
bool canView = bulk.Results["reports.view"];

bool canOpen = await lumo.Permissions.CheckAnyAsync(new[] { "reports.view", "reports.edit" }, CheckOptions.ForUser(userId));
bool canPublish = await lumo.Permissions.CheckAllAsync(new[] { "reports.edit", "reports.publish" }, CheckOptions.ForUser(userId));
```

`CheckOptions` is a record with `Context`, `UserId` and `AgentId`. To check as the user, call `lumo.WithAccessToken(accessToken)` and use the client that it returns, without options. Errors derive from `LumoAuth.Errors.LumoAuthException`. Targets .NET 8. For ASP.NET Core policies use `lumoauth-aspnetcore`.

## Java: `io.lumoauth:lumo-auth-java`

```java
import io.lumoauth.LumoAuth;
import io.lumoauth.model.CheckOptions;
import io.lumoauth.model.PermissionBulkCheck;
import java.util.List;

public class PermissionExample {
    public static void main(String[] args) {
        LumoAuth lumo = LumoAuth.builder()
            .baseUrl(System.getenv("LUMOAUTH_URL"))
            .apiKey(System.getenv("LUMOAUTH_API_KEY"))
            .build();

        String userId = "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20";

        // check(String permission, CheckOptions options) -> boolean
        boolean canEdit = lumo.permissions().check("reports.edit", CheckOptions.forUser(userId));

        // checkBulk(List<String> permissions, CheckOptions options) -> PermissionBulkCheck
        PermissionBulkCheck bulk = lumo.permissions()
            .checkBulk(List.of("reports.view", "reports.edit"), CheckOptions.forUser(userId));
        boolean canView = Boolean.TRUE.equals(bulk.results().get("reports.view"));

        boolean canOpen = lumo.permissions().checkAny(List.of("reports.view", "reports.edit"), CheckOptions.forUser(userId));
        boolean canPublish = lumo.permissions().checkAll(List.of("reports.edit", "reports.publish"), CheckOptions.forUser(userId));
    }
}
```

`check(permission)` without options checks the caller. To check as the user, build the client with `.accessToken(token)` in place of `.apiKey(...)`. Errors derive from `io.lumoauth.errors.LumoAuthException` (unchecked). Requires Java 17 or later. For Spring Security wiring use `lumoauth-spring-boot`.

## Raw HTTP

| Route | Body | Answer |
|---|---|---|
| `POST /api/v1/authz/check` | `{"permission": "reports.edit", "context": {}, "subject": {"type": "user", "id": "<uuid>"}}` | `{"allowed": true, "permission": "...", "subject_type": "user", "subject_id": "...", "user_id": "...", "context": {}}` |
| `POST /api/v1/authz/check-bulk` | `{"permissions": ["a.b", "c.d"], "context": {}, "subject": {...}}` | `{"results": {"a.b": true, "c.d": false}, ...}` |
| `POST /api/v1/authz/check-any` | `{"permissions": [...], ...}` | `{"allowed": true, "permissions": [...], ...}` |
| `POST /api/v1/authz/check-all` | `{"permissions": [...], ...}` | `{"allowed": false, "permissions": [...], ...}` |
| `GET /api/v1/authz/permissions` | none. User token with `authz:read` | `{"user_id": "...", "permissions": [{"slug", "description", "source": "role:<Role name>"}], "count": 2}` |

`context` and `subject` are optional. A list takes at most 100 permissions. Send an API key in the `X-API-Key` header and a user token as `Authorization: Bearer <token>`. Never send both in one request: the server answers `400`.

Errors: `400 MISSING_PERMISSION`, `400 INVALID_PERMISSIONS`, `400 TOO_MANY_PERMISSIONS`, `400 INVALID_SUBJECT`, `403 INSUFFICIENT_PERMISSIONS` (another subject without the privilege), `404 SUBJECT_NOT_FOUND`.
