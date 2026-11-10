# Authorization reference (ASP.NET Core)

`AddLumoAuth` registers the policies behind the attributes, the scoped `ILumoAuthorization`
service and the handler that asks LumoAuth. Everything here is in
`LumoAuth.AspNetCore.Authorization`.

## Attributes and minimal API methods

| Attribute | Minimal API method | Check |
|---|---|---|
| `[RequirePermission("a")]` | `.RequirePermission("a")` | RBAC: the principal holds permission `a` |
| `[RequirePermission("a", "b")]` | `.RequirePermission("a", "b")` | RBAC: holds all of them |
| `[RequirePermission("a", "b", Mode = RequirementMode.Any)]` | `.RequirePermission(RequirementMode.Any, "a", "b")` | RBAC: holds at least one |
| `[RequireRelation("viewer", "document:{id}")]` | `.RequireRelation("viewer", "document:{id}")` | Zanzibar: `user:<sub>` has the relation to the object |
| `[RequireAbac("document", "read", "{id}")]` | `.RequireAbac("document", "read", "{id}")` | ABAC: policies allow the action on the resource. The third argument is optional. |

- The attributes extend `AuthorizeAttribute`. They work on controllers, actions, Razor Pages and
  minimal API endpoints, and can be repeated.
- `{name}` placeholders in an object template or resource ID template are filled from the route
  values, then from the query string. A placeholder without a value denies the request.
- Each attribute implies an authenticated user. An anonymous request gets the scheme's challenge
  (401 for the bearer scheme, a redirect to LumoAuth for the web app).

## Named policies

Use these with `[Authorize(Policy = "...")]` or `.RequireAuthorization("...")`:

```csharp
using LumoAuth.AspNetCore.Authorization;

builder.Services.AddAuthorization(options =>
{
    options.AddLumoAuthPermissionPolicy("CanPublish", RequirementMode.Any,
        "document.publish", "document.admin");
    options.AddLumoAuthPermissionPolicy("CanEdit", "document.edit");
    options.AddLumoAuthRelationPolicy("DocumentViewer", "viewer", "document:{id}");
    options.AddLumoAuthAbacPolicy("CanDeleteDocument", "document", "delete", "{id}");
});
```

Existing policies in the app keep working. The LumoAuth policy provider handles only names that
start with `LumoAuth:` and passes every other name to the default provider.

## ILumoAuthorization

Inject it into minimal API handlers, controllers, Razor Pages or Blazor Server components.

| Method | Returns true when |
|---|---|
| `CanAsync(permission)` | The principal holds the permission |
| `CanAllAsync(permissions)` | The principal holds every permission |
| `CanAnyAsync(permissions)` | The principal holds at least one |
| `HasRelationAsync(@object, relation)` | `user:<sub>` has the relation to the object |
| `IsViewerAsync(@object)`, `IsEditorAsync(@object)`, `IsOwnerAsync(@object)` | The same with a fixed relation |
| `AbacAsync(resourceType, action, resourceId, context)` | ABAC allows it. Returns false when the request has no user access token. |
| `GetPrincipalAsync()` | Returns `LumoAuthPrincipal` (`Name`, `Client`, `Options`, `UserAccessToken`) |

Every method takes an optional `CancellationToken`.

```csharp
using LumoAuth.AspNetCore.Authorization;
using LumoAuth.Errors;

app.MapGet("/documents/{id}/actions", async (string id, ILumoAuthorization authz, ILogger<Program> log) =>
{
    try
    {
        return Results.Ok(new
        {
            canEdit = await authz.CanAsync("document.edit"),
            isOwner = await authz.IsOwnerAsync($"document:{id}"),
        });
    }
    catch (LumoAuthException e)
    {
        log.LogWarning(e, "LumoAuth check failed");
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}).RequireAuthorization();
```

Differences from the attributes:

- The attributes catch LumoAuth failures, log a warning and deny (403). `ILumoAuthorization`
  methods let `LumoAuthException` propagate. Catch it and deny or fail.
- On an anonymous request `ILumoAuthorization` throws `LumoAuthPrincipalException`. Guard the
  endpoint with `.RequireAuthorization()` or `[Authorize]`.

## Which credential runs a check

| Situation | Permission and relation checks | ABAC checks |
|---|---|---|
| The default scheme saved the caller's access token (LumoAuth bearer scheme, or OpenID Connect with `SaveTokens`) | Run with that token. The question is about the caller. No API key is needed. | Run with that token. It needs the `abac:read` scope. |
| No token was saved (another authentication scheme, or a non-default scheme) | Run with the configured API key and name the principal's `sub` as the subject. A `sub` of `agent_<id>` is checked as that agent. The API key needs `authz:check`. | Use the token in the `Authorization: Bearer` header when there is one. Otherwise the check is denied and a warning is logged. |

The SDK never sends the API key to the ABAC routes, because those routes do not accept API keys.

The subject of a relation check is always `user:` followed by the principal's `sub`. Write
relationship tuples with the LumoAuth user ID, not with an email address.

## Scopes to request

| The app uses | Add to `LumoAuth:Login:Scopes` (web app) or to the bearer token |
|---|---|
| `[RequirePermission]`, `[RequireRelation]`, `CanAsync`, `HasRelationAsync` | nothing extra |
| `[RequireAbac]`, `AbacAsync` | `abac:read` |
| `AddLumoAuthBearer(o => o.PermissionsAsClaims = true)`, `Permissions.ListAsync` | `authz:read` |

The OAuth application must be allowed to request the scope.

## Claims helpers

Extension methods on `ClaimsPrincipal` in `LumoAuth.AspNetCore`:

| Method | Returns |
|---|---|
| `GetLumoAuthSubject()` | The `sub` claim, or null |
| `IsLumoAgent()` | True when the principal carries an `agent_id` |
| `GetCapabilities()` | The agent's capability slugs |
| `HasCapability(name)` | True when the capabilities cover the name, with the server's matching rules |

## Failure behaviour

| Event | Result |
|---|---|
| No signed-in principal | 401, or a redirect to sign-in in a web app |
| The principal lacks the permission, relation or ABAC allowance | 403 |
| LumoAuth cannot be reached, or answers with an error, during an attribute check | 403 and a warning in the log (`LumoAuth check failed for ...; access denied`) |
| ABAC check without a user access token | 403 and a warning that explains the missing token |

Checks are live calls. Each guarded request makes one request to LumoAuth for each requirement.
