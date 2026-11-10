# LumoAuthClient reference (plain .NET)

The `LumoAuth` package works without ASP.NET Core: console apps, worker services, functions.
Namespaces: `LumoAuth` (client), `LumoAuth.Models` (requests and results), `LumoAuth.Errors`
(exceptions), `LumoAuth.Web` (sign-in flow).

## Build a client

```csharp
using LumoAuth;

using var lumo = new LumoAuthClient(new LumoAuthOptions
{
    BaseUrl = "https://app.lumoauth.dev",
    OrgId = "acme-corp",
    ApiKey = Environment.GetEnvironmentVariable("LUMOAUTH_API_KEY"),
    Timeout = TimeSpan.FromSeconds(10),
});
```

Shortcuts: `LumoAuthClient.FromEnvironment()` and `new LumoAuthClient(apiKey, orgId)`.

| Option | Default | Meaning |
|---|---|---|
| `BaseUrl` | `LUMOAUTH_URL`, then `https://app.lumoauth.dev` | Region URL. EU: `https://eu.app.lumoauth.dev`. |
| `OrgId` | `LUMOAUTH_ORG_ID` | Organization slug |
| `ApiKey` | `LUMOAUTH_API_KEY` | Organization API key, sent as `X-API-Key` |
| `AccessToken` | none | A fixed bearer token |
| `TokenProvider` | none | A delegate `ct => ...` that returns a bearer token for each request |
| `Timeout` | 30 seconds | Timeout of each request |
| `HttpClient` | internal client | Your own `HttpClient`. The SDK never disposes it. |
| `DefaultHeaders` | none | Headers added to every request |
| `UserAgent` | `lumoauth-dotnet/<version>` | User agent |
| `CredentialOptional` | `false` | Allow a client without a credential |

The constructor throws `LumoAuthConfigException` when no credential is configured and
`CredentialOptional` is false. When a bearer token and an API key are both configured, the SDK
sends the token only. A client is immutable and safe to share between threads: build one for each
credential and register it as a singleton.

`lumo.WithAccessToken(token)` returns a client with the same connection settings that sends the
given user token. Dispose it after use (`using var asUser = ...`).

In a worker service, register the client yourself:

```csharp
using LumoAuth;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton(_ => LumoAuthClient.FromEnvironment());
```

## Which credential works where

| Credential | Accepted on |
|---|---|
| Organization API key (`lmk_...`) | Permission checks, Zanzibar check and expand, the Admin API, client registration. Not ABAC, agent or JIT routes. |
| User access token | Routes that act for the signed-in user. Some need a scope. |
| Agent credential | Agent, approval and JIT routes and the permission checks. See `lumoauth-agent-identity`. |

An API key acts for the organization member who created it. A check about another subject needs
the `authz:check` scope on the key or token, or the `authz.check` permission.

## Permissions (RBAC)

```csharp
using LumoAuth.Models;

bool canEdit = await lumo.Permissions.CheckAsync("document.edit", CheckOptions.ForUser(userId));
PermissionCheck detail = await lumo.Permissions.CheckDetailedAsync("document.edit", CheckOptions.ForUser(userId));
PermissionBulkCheck bulk = await lumo.Permissions.CheckBulkAsync(
    new[] { "document.edit", "document.delete" }, CheckOptions.ForUser(userId));
bool canDelete = bulk.Allowed("document.delete");
bool all = await lumo.Permissions.CheckAllAsync(new[] { "document.edit", "document.publish" }, CheckOptions.ForUser(userId));
bool any = await lumo.Permissions.CheckAnyAsync(new[] { "document.read", "document.admin" }, CheckOptions.ForUser(userId));
```

| `CheckOptions` | Meaning |
|---|---|
| omitted or `CheckOptions.None` | The check is about the caller: the key's owner or the token's subject |
| `CheckOptions.ForUser(userId)` | Another user, by LumoAuth user ID (the `sub` of the user's tokens) |
| `CheckOptions.ForAgent(agentId)` | An agent, by its `agt_...` ID |
| `CheckOptions.WithContext(new { ... })` | Extra context that policies can read |

`ListAsync()` and `ListSlugsAsync()` list the caller's permissions. They need a user access token
with the `authz:read` scope; an API key cannot hold that scope.

Server answers to know: 403 with code `INSUFFICIENT_PERMISSIONS` (the credential may not ask about
other subjects) and 404 with code `SUBJECT_NOT_FOUND` (the ID is not a LumoAuth ID in this
organization).

## Zanzibar (ReBAC)

```csharp
bool canView = await lumo.Zanzibar.IsViewerAsync("document:readme", "user:" + userId);
bool related = await lumo.Zanzibar.CheckAsync("folder:q4", "member", "group:finance#member");
ZanzibarCheck detail = await lumo.Zanzibar.CheckDetailedAsync("document:readme", "editor", "user:" + userId);
ZanzibarUsersetNode tree = await lumo.Zanzibar.ExpandAsync("document:readme", "viewer");
IReadOnlyList<string> everyone = tree.AllSubjects();
```

Shortcuts: `IsViewerAsync`, `IsEditorAsync`, `IsOwnerAsync`, `IsMemberAsync`, `IsAdminAsync`.

## ABAC

ABAC needs a user access token with `abac:read` (checks and reads) or `abac:write` (writes). API
keys are refused.

```csharp
using LumoAuth.Models;

using var asUser = lumo.WithAccessToken(userAccessToken);

AbacDecision decision = await asUser.Abac.CheckAsync(new AbacCheck("document", "read", "doc-123")
{
    Context = new { pep = new { ip = clientIp } },
});
bool allowed = decision.Allowed;   // decision.Reason and decision.MatchedPolicies explain it

IReadOnlyList<AbacDecision> many = await asUser.Abac.CheckBulkAsync(
    new[] { new AbacCheck("document", "read", "doc-1"), new AbacCheck("document", "edit", "doc-1") },
    new { pep = new { ip = clientIp } });
```

- `Context` is sent as the check's environment. LumoAuth sets `ip`, `userAgent`, `requestMethod`
  and `requestPath` itself from the request that it receives from your server. Send the end user's
  IP address as `pep.ip` and write policies against `pep.ip`.
- A bulk check takes at most 100 checks (`AbacResource.MaxBulkRequests`) and one environment for
  all of them. Checks with different `Context` values throw `LumoAuthValidationException`.
- Other calls: `IsAllowedAsync`, `MyAttributesAsync`, `ResourceAttributesAsync`,
  `AttributeDefinitionsAsync(AttributeType.User)`, `SetUserAttributeAsync`,
  `SetResourceAttributeAsync` (the last two also need the `abac.manage` permission).

## Sign-in without the OpenID Connect handler

`LumoAuth.Web.AuthorizationCodeFlow` runs the authorization code flow with PKCE against any
session store. In ASP.NET Core, prefer `AddLumoAuthWebAppAuthentication`.

```csharp
using LumoAuth;
using LumoAuth.Web;

var flow = new AuthorizationCodeFlow(lumo, clientId, "https://app.example.com/auth/callback")
{
    ClientSecret = clientSecret,          // leave out for a public client
    Scope = "openid profile email",
};

// Login endpoint: keep the pending login server-side, then redirect.
AuthorizationCodeFlow.PendingLogin pending = flow.Start("/dashboard");
// store `pending` in your session, then redirect the browser to pending.AuthorizationUrl

// Callback endpoint: pass the stored value and the callback's query parameters.
AuthorizationCodeFlow.SignedIn session = await flow.CompleteAsync(pending, callbackQuery);
// store `session`, then redirect to pending.ReturnTo
```

| Member | Purpose |
|---|---|
| `Start(returnTo)` | Creates the PKCE pair and `state`, returns `PendingLogin` (`State`, `CodeVerifier`, `RedirectUri`, `ReturnTo`, `AuthorizationUrl`). Store it server-side; it holds the PKCE verifier. |
| `CompleteAsync(pending, callbackParams)` | `callbackParams` is `IReadOnlyDictionary<string, string?>`. Checks `error` and `state`, exchanges the code, loads UserInfo. Returns `SignedIn` (`User`, `Tokens`, `ExpiresAt`, `Expired`). Throws `LumoAuthAuthenticationException` on a provider error or a `state` mismatch. |
| `RefreshAsync(session)` | New `SignedIn` from the refresh token, or null when there is none. |
| `RevokeAsync(session)` | Revokes the refresh token at sign-out. Never throws. |
| `ClientFor(session)` | A `LumoAuthClient` that acts as the signed-in user. |
| `AuthorizationCodeFlow.SanitizeReturnTo(value, fallback)` | Accepts local paths only. |

The app needs a `LumoAuthClient` for the flow; with no API key, build it with
`CredentialOptional = true`. Register the callback URL as a redirect URI on the OAuth application.

Lower-level calls on `lumo.Auth`: `AuthorizationUrl`, `ExchangeCodeAsync`, `RefreshTokenAsync`,
`ClientCredentialsAsync`, `RevokeAsync`, `UserInfoAsync`. Token calls authenticate with the client
ID and secret in the body; they never send the API key.

## Any other endpoint

```csharp
using System.Text.Json;

JsonElement? users = await lumo.RequestJsonAsync("GET", lumo.OrgPath("/admin/users"));
using HttpResponseMessage raw = await lumo.RequestRawAsync("GET", lumo.OrgPath("/admin/users"));
```

`OrgPath("/x")` returns `/orgs/{orgId}/api/v1/x`. `RequestAsync<T>(method, path, body)` decodes the
JSON answer into `T`. These methods use the client's credential and the same error mapping. For
the Admin API itself use `lumoauth-admin-api`.

## Exceptions

Every exception extends `LumoAuthException` and has a `Code`.

| Exception | Default `Code` | When |
|---|---|---|
| `LumoAuthApiException` | `API_ERROR` | Any answer that is not 2xx. `StatusCode`, `Body`, `BodyField(name)`. |
| `LumoAuthAuthenticationException` | `AUTHENTICATION_ERROR` | 401 |
| `LumoAuthPermissionDeniedException` | `PERMISSION_DENIED` | 403. `RequiredScopes` lists the scopes that the server named. |
| `LumoAuthNotFoundException` | `NOT_FOUND` | 404 |
| `LumoAuthRateLimitException` | `RATE_LIMITED` | 429. `RetryAfter` is a `TimeSpan?`. |
| `LumoAuthValidationException` | `VALIDATION_ERROR` | Bad input, or an answer that the SDK cannot use |
| `LumoAuthConfigException` | `CONFIG_ERROR` | Missing or invalid configuration |
| `LumoAuthNetworkException` | `NETWORK_ERROR` | Transport failure or SDK timeout |

For an API exception, `Code` is the code in the response body when the server sends one (a scope
refusal has the code `forbidden`). Match on the exception type, not on `Code`.

```csharp
using LumoAuth.Errors;

try
{
    bool ok = await lumo.Permissions.CheckAsync("document.edit");
}
catch (LumoAuthPermissionDeniedException e) when (e.RequiredScopes.Count > 0)
{
    Console.Error.WriteLine("missing scopes: " + string.Join(", ", e.RequiredScopes));
}
catch (LumoAuthRateLimitException e) when (e.RetryAfter is { } delay)
{
    await Task.Delay(delay);
}
catch (LumoAuthApiException e)
{
    Console.Error.WriteLine($"LumoAuth returned {e.StatusCode}: {e.Message} ({e.Code})");
}
catch (LumoAuthException e)
{
    Console.Error.WriteLine($"{e.Code}: {e.Message}");
}
```

A check that is denied is not an exception: `CheckAsync` returns `false`. An exception means that
the question could not be answered. Deny access in that case. A cancelled `CancellationToken`
throws `OperationCanceledException`.

The approval and budget exceptions belong to agents; see `lumoauth-agent-approvals`.
