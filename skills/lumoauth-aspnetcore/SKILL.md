---
name: lumoauth-aspnetcore
description: >-
  Adds LumoAuth to .NET and ASP.NET Core apps with the NuGet packages LumoAuth and
  LumoAuth.AspNetCore: the "LumoAuth" configuration section in appsettings.json,
  AddLumoAuth(configuration), browser sign-in with AddLumoAuthWebAppAuthentication (cookie session
  plus OpenID Connect authorization code flow with PKCE), bearer token APIs with AddLumoAuthBearer,
  authorization with [RequirePermission], [RequireRelation], [RequireAbac], the minimal API
  methods RequirePermission, RequireRelation and RequireAbac, ILumoAuthorization, the LumoAuth
  health check, and LumoAuthClient in console apps and workers. Use when the user asks to add
  login, logout, OIDC, protected endpoints, permission checks (RBAC, Zanzibar, ABAC) or bearer
  token validation to a C#, .NET 8, ASP.NET Core, minimal API, MVC, Razor Pages or Blazor Server
  project, or mentions LumoAuth.AspNetCore, LumoAuthClient, LumoAuthDefaults or signin-lumoauth.
  Not for AI agents in .NET (LumoAgent, AAuth); the agent skills cover those.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for .NET and ASP.NET Core

Add LumoAuth sign-in, bearer token authentication and live permission checks to an ASP.NET Core
app, or call LumoAuth from any .NET code. Two NuGet packages share one version:

| Package | Use it for |
|---|---|
| `LumoAuth.AspNetCore` | ASP.NET Core 8 and newer: minimal APIs, MVC, Razor Pages, Blazor Server. It installs `LumoAuth` with it. |
| `LumoAuth` | Any .NET 8+ code: console apps, workers, functions. |

Both target `net8.0`, so apps on .NET 8, 9 and 10 can use them.

## When to use

- An ASP.NET Core web app needs login and logout through LumoAuth.
- An ASP.NET Core API must accept LumoAuth access tokens.
- Endpoints or controllers need RBAC, relationship or ABAC checks.
- A .NET worker or console app calls LumoAuth with `LumoAuthClient`.

Do not use this skill for:

- AI agents in .NET (`LumoAgent`, `JitContext`, `DelegationChain`, approvals): use
  `lumoauth-agent-identity`, `lumoauth-agent-approvals` and `lumoauth-agent-delegation`.
- AAuth (`AAuthClient`, `AAuthVerifier`): use `lumoauth-aauth`.
- A .NET app that keeps `Microsoft.AspNetCore.Authentication.JwtBearer` or another OIDC library
  and only needs endpoints and claims: use `lumoauth-oauth-oidc` and `lumoauth-api-protection`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask which region the organization is in. |
| Organization slug | The `{orgId}` in the portal URL `/orgs/{orgId}/portal/`, for example `acme-corp`. |
| Client ID and client secret | An OAuth application in the organization. Needed for browser sign-in only. The secret is shown once. |
| Redirect URI | `{app origin}/signin-lumoauth`. Development: the HTTPS URL in `Properties/launchSettings.json`, for example `https://localhost:5001/signin-lumoauth`. Production: `https://app.example.com/signin-lumoauth`. |
| Post-logout redirect URI | `{app origin}/signout-callback-lumoauth`. |
| API key (`lmk_...`) | Optional. Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`). See step 2 for when the app needs one. |

Create or find the OAuth application in one of these ways:

- Portal: **Applications → New application**, choose **Web application**, enter the redirect URI,
  click **Create application**. Copy the client secret from the page that opens next. Then open
  the application's **Configuration** tab and add the post-logout redirect URI under
  **Post-logout redirect URIs**.
- CLI: show the user this command before you run it, because it creates an application.

```bash
lumo login --org acme-corp
lumo apps list
lumo apps create --name "My .NET app" \
  --redirect-uris https://localhost:5001/signin-lumoauth -o json
```

The JSON output contains `clientId` and `secret`. The secret is not shown again. The CLI has no
flag for post-logout redirect URIs; add that URI in the portal.

Redirect URIs are matched exactly (scheme, host, port, path). `http://` is accepted only for
`localhost`, `127.0.0.1` and `[::1]`.

## Steps

### 1. Install

```bash
dotnet add package LumoAuth.AspNetCore
```

### 2. Configure

`appsettings.json` (no secrets in this file):

```json
{
  "LumoAuth": {
    "BaseUrl": "https://app.lumoauth.dev",
    "OrgId": "acme-corp",
    "CredentialOptional": true,
    "Login": {
      "ClientId": "",
      "Scopes": ["openid", "profile", "email"]
    }
  }
}
```

Keep the secrets out of source control:

```bash
dotnet user-secrets init
dotnet user-secrets set "LumoAuth:Login:ClientId" "<client id>"
dotnet user-secrets set "LumoAuth:Login:ClientSecret" "<client secret>"
```

In production, set the environment variables `LumoAuth__Login__ClientId` and
`LumoAuth__Login__ClientSecret`. `BaseUrl`, `OrgId` and `ApiKey` also fall back to `LUMOAUTH_URL`,
`LUMOAUTH_ORG_ID` and `LUMOAUTH_API_KEY`.

About the API key: `AddLumoAuth` builds a `LumoAuthClient`, and its constructor throws
`LumoAuthConfigException` when it has no credential. Choose one:

- `"CredentialOptional": true` and no API key. Sign-in, bearer tokens and checks that run with the
  caller's own access token all work.
- `LumoAuth:ApiKey` (from user secrets or `LUMOAUTH_API_KEY`), when the app calls the Admin API,
  checks permissions for users who are not the caller, or signs users in with a scheme that saves
  no LumoAuth token. Give the key the `authz:check` scope for such checks, and nothing more than
  the app needs.

### 3a. Web app: sign users in

`Program.cs`:

```csharp
using System.Security.Claims;
using LumoAuth.AspNetCore;
using LumoAuth.AspNetCore.Authentication;
using LumoAuth.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddLumoAuth(builder.Configuration);                      // reads the "LumoAuth" section
builder.Services.AddLumoAuthWebAppAuthentication(builder.Configuration);  // cookie + OpenID Connect ("LumoAuth:Login")
builder.Services.AddAuthorization();
builder.Services.AddHealthChecks().AddLumoAuth();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Content("<a href=\"/dashboard\">Sign in</a>", "text/html"));

// An anonymous visit is redirected to LumoAuth and comes back signed in.
app.MapGet("/dashboard", (ClaimsPrincipal user) =>
        $"Hello {user.FindFirst("name")?.Value ?? user.GetLumoAuthSubject()}")
   .RequireAuthorization();

// RBAC: 403 unless the signed-in user holds the permission.
app.MapPost("/invoices/{id}/approve", (string id) => Results.Ok(new { approved = id }))
   .RequirePermission("invoice.approve");

// Zanzibar: {id} is filled from the route.
app.MapGet("/documents/{id}", (string id) => Results.Ok(new { id }))
   .RequireRelation("viewer", "document:{id}");

// A decision inside the handler.
app.MapDelete("/documents/{id}", async (string id, ILumoAuthorization authz) =>
        await authz.IsOwnerAsync($"document:{id}") ? Results.NoContent() : Results.Forbid())
   .RequireAuthorization();

// End the cookie session and the LumoAuth session.
app.MapGet("/logout", () => Results.SignOut(
    new AuthenticationProperties { RedirectUri = "/" },
    new[] { LumoAuthDefaults.CookieScheme, LumoAuthDefaults.OpenIdConnectScheme }));

app.MapHealthChecks("/health");
app.Run();
```

What `AddLumoAuthWebAppAuthentication` sets up:

- A cookie scheme (`LumoAuthDefaults.CookieScheme`) as the default scheme, and the OpenID Connect
  scheme (`LumoAuthDefaults.OpenIdConnectScheme`) for challenge and sign-out.
- Authorization code flow with PKCE, `state` and `nonce` handled by the ASP.NET Core OpenID
  Connect handler. Discovery is read from
  `{BaseUrl}/orgs/{OrgId}/api/v1/.well-known/openid-configuration`, and the issuer is validated.
- Callback path `/signin-lumoauth`, sign-out callback path `/signout-callback-lumoauth`.
- Tokens are saved in the session (`SaveTokens`, default true), so checks run as the user.
- Claims keep their LumoAuth names: `sub` is the principal's name, each role is a `roles` claim.

### 3b. API: accept bearer tokens

Use this instead of 3a for a service that receives `Authorization: Bearer <access token>`.

```csharp
using System.Security.Claims;
using LumoAuth.AspNetCore;
using LumoAuth.AspNetCore.Authentication;
using LumoAuth.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddLumoAuth(builder.Configuration);
builder.Services.AddAuthentication(LumoAuthDefaults.BearerScheme).AddLumoAuthBearer();
builder.Services.AddAuthorization();
builder.Services.AddHealthChecks().AddLumoAuth();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/me", (ClaimsPrincipal user) => new
{
    sub = user.GetLumoAuthSubject(),
    roles = user.FindAll(LumoAuthDefaults.RoleClaimType).Select(c => c.Value),
    agent = user.IsLumoAgent(),
}).RequireAuthorization();

app.MapPost("/invoices/{id}/approve", (string id) => Results.Ok(new { approved = id }))
   .RequirePermission("invoice.approve");

app.MapHealthChecks("/health");
app.Run();
```

The `Login` section is not needed here. For each request the handler sends the token to
LumoAuth's UserInfo endpoint and builds the principal from the answer. A token that LumoAuth
rejects gives 401 with `WWW-Authenticate: Bearer`. This costs one call to LumoAuth per request and
does not compare the token's `aud` with your API. When the API must accept only tokens that were
issued for it, or must validate offline, validate the JWT locally (issuer, audience, signature) as
described in `lumoauth-api-protection`.

Read [references/authentication.md](references/authentication.md) for every `Login` and bearer
option, an app that serves browsers and bearer clients together, token refresh for long sessions,
reverse proxies, and adding LumoAuth to an app that already calls `AddAuthentication`.

### 4. Authorize controllers

The attributes are in `LumoAuth.AspNetCore.Authorization`:

```csharp
using LumoAuth.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("documents")]
public sealed class DocumentsController : ControllerBase
{
    [HttpPut("{id}")]
    [RequirePermission("document.edit")]                       // RBAC, one permission
    public IActionResult Edit(string id) => Ok(new { id });

    [HttpPost("{id}/publish")]
    [RequirePermission("document.edit", "document.publish", Mode = RequirementMode.Any)]
    public IActionResult Publish(string id) => Ok(new { id });

    [HttpPatch("{id}")]
    [RequireRelation("editor", "document:{id}")]               // Zanzibar; {id} from the route
    public IActionResult Rename(string id) => Ok(new { id });

    [HttpDelete("{id}")]
    [RequireAbac("document", "delete", "{id}")]                // ABAC; needs the abac:read scope
    public IActionResult Delete(string id) => NoContent();
}
```

Each attribute runs a live LumoAuth check for each request. No signed-in principal gives 401, a
missing permission gives 403, and a LumoAuth failure also gives 403 and a warning in the log.
`[RequireAbac]` needs `abac:read` in `LumoAuth:Login:Scopes` (web app) or in the bearer token.

Read [references/authorization.md](references/authorization.md) for which credential each check
uses, named policies, every `ILumoAuthorization` method and the claims helpers. For the
permission, relationship and policy models themselves use `lumoauth-rbac`, `lumoauth-rebac` and
`lumoauth-abac`.

### 5. Plain .NET: workers and console apps

```bash
dotnet add package LumoAuth
```

```csharp
using LumoAuth;
using LumoAuth.Errors;
using LumoAuth.Models;

// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY.
using var lumo = LumoAuthClient.FromEnvironment();

try
{
    string userId = args[0];   // the LumoAuth user ID: the `sub` of the user's tokens
    bool canApprove = await lumo.Permissions.CheckAsync("invoice.approve", CheckOptions.ForUser(userId));
    bool canView = await lumo.Zanzibar.IsViewerAsync("document:readme", $"user:{userId}");
    Console.WriteLine($"approve={canApprove} view={canView}");
}
catch (LumoAuthException e)
{
    Console.Error.WriteLine($"{e.Code}: {e.Message}");   // could not ask: treat as denied
}
```

A check about another user needs the `authz:check` scope on the API key. Read
[references/dotnet-client.md](references/dotnet-client.md) for the client options, every check
method, ABAC, `AuthorizationCodeFlow` for sign-in without the OpenID Connect handler, raw requests
and the exception tree.

## Verify

1. Run `dotnet run --launch-profile https` and open `/dashboard` on the HTTPS URL. The browser
   goes to the LumoAuth login page of the organization, returns to `/signin-lumoauth` and shows
   the greeting.
2. Open `/health`. It answers `Healthy` when the organization's discovery document is reachable.
3. Call a guarded endpoint as a user without the permission: 403. Grant the permission through a
   role and call again: 200.
4. Open `/logout`, then `/dashboard`. The browser is asked to sign in again.
5. API variant: `curl -i https://localhost:5001/api/me` returns 401.
   `curl -H "Authorization: Bearer $TOKEN" https://localhost:5001/api/me` returns the subject.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuthConfigException: a credential is required` at startup | No `ApiKey` and `CredentialOptional` is false | Set `LumoAuth:CredentialOptional` to true or configure `LumoAuth:ApiKey`. |
| `LumoAuth:Login:ClientId is required for OpenID Connect sign-in` | The `Login` section is missing or the secret store was not loaded | Set `LumoAuth:Login:ClientId`. |
| `OrgId (or LUMOAUTH_ORG_ID) is required for OpenID Connect sign-in` | No organization slug | Set `LumoAuth:OrgId`. |
| LumoAuth shows a redirect URI error | The URI that the app sends is not registered exactly | Register `{origin}/signin-lumoauth` with the scheme and port that the app really uses. Behind a proxy, enable forwarded headers (see `references/authentication.md`). |
| After sign-out the user sees a LumoAuth confirmation page instead of the app | `{origin}/signout-callback-lumoauth` is not a registered post-logout redirect URI | Add it on the application's **Configuration** tab. |
| `/logout` redirects but the user is still signed in to the app | Only one scheme was signed out | Sign out of `CookieScheme` and `OpenIdConnectScheme`, as in step 3a. |
| A bearer request to a web app is redirected to the login page | The default scheme is the cookie; the endpoint does not name the bearer scheme | See "Browsers and bearer clients in one app" in `references/authentication.md`. |
| `[RequireAbac]` always denies; the log says that the request has no user access token | No saved token and no `Authorization: Bearer` header | Keep `Login:SaveTokens` on and add `abac:read` to `Login:Scopes`. |
| Checks deny with 403 `INSUFFICIENT_PERMISSIONS` in the log | The check ran with the API key for another subject | Give the API key the `authz:check` scope. |
| Checks start to deny some time after sign-in | The saved access token expired while the cookie is still valid | Refresh the token; see `references/authentication.md`. |
| `ILumoAuthorization` throws `LumoAuthPrincipalException` | The endpoint allows anonymous requests | Add `.RequireAuthorization()` or `[Authorize]`. |

Security rules for this integration:

- Keep the client secret and the API key in user secrets, environment variables or a secret
  store. Never put them in `appsettings.json`, in Razor or Blazor markup, or in JavaScript.
- Never log access tokens, refresh tokens or ID tokens.
- Do not set `SkipCertValidation`. Do not turn off issuer validation on the OpenID Connect options.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-getting-started`: organizations, regions and credentials.
- `lumoauth-cli`: `lumo login` and `lumo apps`.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`, `lumoauth-authorization`: design the model that
  these checks read.
- `lumoauth-api-protection`: local JWT validation, machine-to-machine clients, introspection.
- `lumoauth-oauth-oidc`: the protocol details behind the OpenID Connect handler.
- `lumoauth-agent-identity`, `lumoauth-aauth`: agents and AAuth in .NET.

## References

- [references/authentication.md](references/authentication.md): sign-in, bearer, sign-out, refresh.
- [references/authorization.md](references/authorization.md): attributes, policies, `ILumoAuthorization`.
- [references/dotnet-client.md](references/dotnet-client.md): `LumoAuthClient` in plain .NET, errors.
- https://docs.lumoauth.dev/quickstarts/aspnetcore
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/oauth/logout
- https://docs.lumoauth.dev/user-guide/applications/api-keys
