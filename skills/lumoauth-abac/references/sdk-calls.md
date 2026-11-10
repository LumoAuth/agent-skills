# ABAC calls in every SDK

One verified ABAC evaluation per LumoAuth SDK, plus the bulk check and the attribute calls. The SDKs call the organization-scoped routes under `/orgs/{orgId}/api/v1/abac/`, so every client needs the organization slug.

## Credential rules

- The check and attribute-value routes accept a **user access token** only. An organization API key (`lmk_...`) is refused on them.
- The token needs the `abac:read` scope for `check`, `checkBulk` and reads, and `abac:write` for the two `set` calls. Without the scope the SDK raises its permission-denied error, and the error lists `abac:read` or `abac:write` as the required scope.
- The `set` calls also need the `abac.manage` permission for the user of the token. Reading resource attributes needs `abac.view` or `abac.manage`.
- A check always decides for the user of the token. It has no "other subject" argument. To decide for another user from a backend, use the unified check with an API key: `permissions.check(permission, { resource_id }, { userId })`. The `lumoauth-rbac` skill has that call in every language.
- A token that was requested for another resource server (`resource=https://api.example.com`) is refused by LumoAuth's own API.
- The SDKs send the optional `context` argument as the request's `environment`. The policy engine reads a fixed set of `environment.*` attributes, and `ip`, `userAgent`, `requestMethod` and `requestPath` always describe the request that LumoAuth receives. Do not rely on custom context values in policies.
- An error is a denial. Never treat an exception as "allowed".

The examples read `LUMOAUTH_URL` (for example `https://app.lumoauth.dev`) from the environment and take the user's access token from the request that the application is handling.

## TypeScript: `@lumoauth/backend` (server, with the user's token)

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

export function lumoForUser(accessToken: string): LumoAuthBackend {
  return new LumoAuthBackend({
    baseUrl: process.env.LUMOAUTH_URL!,
    orgId: 'acme-corp',
    secretKey: accessToken, // the signed-in user's access token, scope abac:read
  });
}

export async function example(accessToken: string): Promise<void> {
  const lumo = lumoForUser(accessToken);

  // check({ resourceType, action, resourceId?, context? }) -> decision object
  const decision = await lumo.abac.check({ resourceType: 'report', action: 'read', resourceId: 'q4-2026' });
  console.log(decision.allowed, decision.reason, decision.matchedPolicies);

  // isAllowed(resourceType, action, resourceId?, context?) -> boolean
  const allowed = await lumo.abac.isAllowed('report', 'read', 'q4-2026');

  // checkBulk({ checks: [...], context? }) -> { results: [{ index, resourceType, action, resourceId, allowed, reason }] }
  const { results } = await lumo.abac.checkBulk({
    checks: [
      { resourceType: 'report', action: 'read', resourceId: 'q4-2026' },
      { resourceType: 'report', action: 'edit', resourceId: 'q4-2026' },
    ],
  });
  console.log(allowed, results.map((r) => r.allowed));
}
```

Attribute calls (token with `abac:write`, user with `abac.manage`):

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

export async function classify(adminAccessToken: string): Promise<void> {
  const lumo = new LumoAuthBackend({
    baseUrl: process.env.LUMOAUTH_URL!,
    orgId: 'acme-corp',
    secretKey: adminAccessToken,
  });

  // setUserAttribute(userId, attributeSlug, value)
  await lumo.abac.setUserAttribute('0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20', 'department', 'finance');
  // setResourceAttribute(resourceType, resourceId, attributeSlug, value)
  await lumo.abac.setResourceAttribute('report', 'q4-2026', 'classification', 'confidential');
  // getResourceAttributes(resourceType, resourceId)
  const stored = await lumo.abac.getResourceAttributes('report', 'q4-2026');
  console.log(stored);
}
```

`getMyAttributes()` returns the server's answer, `{ user_id, attributes }`: read a value as `result.attributes.department`.

## TypeScript: `@lumoauth/client` (browser)

```ts
import { LumoAuth } from '@lumoauth/client';

declare function getAccessToken(): Promise<string>; // from the app's session code

const client = new LumoAuth({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  token: () => getAccessToken(),
});

const canRead = await client.abac.isAllowed('report', 'read', 'q4-2026');
```

The same methods as on the backend client. Without `orgId` every `abac` call throws.

## React: `@lumoauth/react`

```tsx
import { Protect, useAbac } from '@lumoauth/react';

export function ReportRow({ reportId }: { reportId: string }) {
  const { allowed, isLoading } = useAbac({ resourceType: 'report', action: 'edit', resourceId: reportId });

  return (
    <li>
      <Protect abac={{ resourceType: 'report', action: 'read', resourceId: reportId }} fallback={<span>Restricted</span>}>
        <a href={`/reports/${reportId}`}>Open</a>
      </Protect>
      <button type="button" disabled={isLoading || !allowed}>
        Edit
      </button>
    </li>
  );
}
```

Both need `LumoAuthProvider` above them (see `lumoauth-react`) and a token with `abac:read`. Both return "not allowed" when the request fails. They are UI hints. The server must check again.

## Python: `lumoauth`

```python
import os

from lumoauth import LumoAuth


def lumo_for_user(access_token: str) -> LumoAuth:
    return LumoAuth(
        base_url=os.environ["LUMOAUTH_URL"],
        org_id="acme-corp",
        token_provider=lambda: access_token,
    )


def example(access_token: str) -> None:
    lumo = lumo_for_user(access_token)

    # check(resource_type, action, resource_id=None, context=None) -> dict
    decision = lumo.abac.check("report", "read", "q4-2026")
    print(decision["allowed"], decision.get("reason"))

    # is_allowed(resource_type, action, resource_id=None, context=None) -> bool
    allowed = lumo.abac.is_allowed("report", "read", "q4-2026")

    # check_bulk(requests, environment=None) -> dict with "results"
    bulk = lumo.abac.check_bulk(
        [
            {"resource_type": "report", "action": "read", "resource_id": "q4-2026"},
            {"resource_type": "report", "action": "edit", "resource_id": "q4-2026"},
        ]
    )
    print(allowed, [r["allowed"] for r in bulk["results"]])


def classify(admin_access_token: str) -> None:
    lumo = lumo_for_user(admin_access_token)
    # set_user_attribute(user_id, attribute_slug, value)
    lumo.abac.set_user_attribute("0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20", "department", "finance")
    # set_resource_attribute(resource_type, resource_id, attribute_slug, value)
    lumo.abac.set_resource_attribute("report", "q4-2026", "classification", "confidential")
```

Also: `get_my_attributes()`, `get_resource_attributes(resource_type, resource_id)`, `get_attribute_definitions(type=None)`.

## Go: `github.com/lumoauth/lumo-auth-go`

```go
package main

import (
	"context"
	"log"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func userMayRead(ctx context.Context, accessToken, reportID string) bool {
	client, err := lumoauth.New(
		lumoauth.WithBaseURL(os.Getenv("LUMOAUTH_URL")),
		lumoauth.WithOrgID("acme-corp"),
		lumoauth.WithAccessToken(accessToken),
	)
	if err != nil {
		return false
	}

	// IsAllowed(ctx, AbacCheckParams) (bool, error)
	allowed, err := client.Abac.IsAllowed(ctx, lumoauth.AbacCheckParams{
		ResourceType: "report",
		Action:       "read",
		ResourceID:   reportID,
	})
	if err != nil {
		return false // fail closed
	}
	return allowed
}

func main() {
	log.Println(userMayRead(context.Background(), os.Getenv("USER_ACCESS_TOKEN"), "q4-2026"))
}
```

Also on `client.Abac`: `Check(ctx, params)` returns `*AbacDecision` (`Allowed`, `Reason`, `MatchedPolicies`), `CheckBulk(ctx, []AbacCheckParams)` returns `[]AbacDecision` in request order, `MyAttributes(ctx)`, `SetUserAttribute(ctx, userID, attributeSlug, value)`, `ResourceAttributes(ctx, resourceType, resourceID)`, `SetResourceAttribute(ctx, resourceType, resourceID, attributeSlug, value)`, `AttributeDefinitions(ctx, attributeType)`.

## PHP: `lumoauth/lumoauth`

```php
<?php

declare(strict_types=1);

use LumoAuth\Error\LumoAuthError;
use LumoAuth\LumoAuth;

function userMayRead(string $accessToken, string $reportId): bool
{
    $lumo = new LumoAuth(
        baseUrl: getenv('LUMOAUTH_URL') ?: null,
        orgId: 'acme-corp',
        tokenProvider: fn (): string => $accessToken,
    );

    try {
        // isAllowed(string $resourceType, string $action, ?string $resourceId = null, ?array $context = null): bool
        return $lumo->abac->isAllowed('report', 'read', $reportId);
    } catch (LumoAuthError) {
        return false; // fail closed
    }
}
```

Also on `$lumo->abac`: `check(...)` returns the decision array, `checkBulk(array $requests, ?array $environment = null)` takes entries with `resourceType`, `action` and an optional `resourceId`, `myAttributes()`, `setUserAttribute($userId, $attributeSlug, $value)`, `resourceAttributes($resourceType, $resourceId)`, `setResourceAttribute($resourceType, $resourceId, $attributeSlug, $value)`, `attributeDefinitions(?string $type = null)`.

## C#: `LumoAuth`

```csharp
using LumoAuth;
using LumoAuth.Errors;
using LumoAuth.Models;

public static class ReportAccess
{
    public static async Task<bool> UserMayReadAsync(string accessToken, string reportId)
    {
        using var lumo = new LumoAuthClient(new LumoAuthOptions
        {
            BaseUrl = Environment.GetEnvironmentVariable("LUMOAUTH_URL"),
            OrgId = "acme-corp",
            AccessToken = accessToken,
        });

        try
        {
            // IsAllowedAsync(AbacCheck check, CancellationToken ct = default) -> Task<bool>
            return await lumo.Abac.IsAllowedAsync(new AbacCheck("report", "read", reportId));
        }
        catch (LumoAuthException)
        {
            return false; // fail closed
        }
    }
}
```

Also on `lumo.Abac`: `CheckAsync(AbacCheck)` and `CheckAsync(resourceType, action, resourceId, context)` return `AbacDecision` (`Allowed`, `Reason`, `MatchedPolicies`), `CheckBulkAsync(IEnumerable<AbacCheck>)`, `MyAttributesAsync()`, `SetUserAttributeAsync(userId, attributeSlug, value)`, `ResourceAttributesAsync(resourceType, resourceId)`, `SetResourceAttributeAsync(resourceType, resourceId, attributeSlug, value)`, `AttributeDefinitionsAsync(type)`.

## Java: `io.lumoauth:lumo-auth-java`

```java
import io.lumoauth.LumoAuth;
import io.lumoauth.errors.LumoAuthException;
import io.lumoauth.model.AbacCheck;

public final class ReportAccess {
    private ReportAccess() {
    }

    public static boolean userMayRead(String accessToken, String reportId) {
        LumoAuth lumo = LumoAuth.builder()
            .baseUrl(System.getenv("LUMOAUTH_URL"))
            .orgId("acme-corp")
            .accessToken(accessToken)
            .build();

        try {
            // isAllowed(AbacCheck check) -> boolean
            return lumo.abac().isAllowed(AbacCheck.of("report", "read", reportId));
        } catch (LumoAuthException e) {
            return false; // fail closed
        }
    }
}
```

Also on `lumo.abac()`: `check(AbacCheck)` returns `AbacDecision` (`allowed()`, `reason()`, `matchedPolicies()`), `checkBulk(List<AbacCheck>)`, `myAttributes()`, `setUserAttribute(userId, attributeSlug, value)`, `resourceAttributes(resourceType, resourceId)`, `setResourceAttribute(resourceType, resourceId, attributeSlug, value)`, `attributeDefinitions()`.

## Raw HTTP

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/check" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"report","action":"read","resourceId":"q4-2026"}'
```

```json
{
  "allowed": false,
  "reason": "No matching policies - default deny",
  "matchedPolicies": [],
  "user_id": "0192f0c4-6c1b-7d4e-9a51-2f1e8f6c3b20",
  "resourceType": "report",
  "action": "read",
  "resourceId": "q4-2026"
}
```

The body keys are camelCase (`resourceType`, `resourceId`). The environment key is `environment`; a `context` key in a raw request is ignored. The skill's policy reference has the full route table.
