# Authentication reference (ASP.NET Core)

Details of the two authentication schemes in `LumoAuth.AspNetCore`. Extension methods are in
`LumoAuth.AspNetCore.Authentication`; `AddLumoAuth` and `LumoAuthDefaults` are in
`LumoAuth.AspNetCore`.

## Names in LumoAuthDefaults

| Constant | Value | Meaning |
|---|---|---|
| `ConfigurationSection` | `LumoAuth` | Section that the options bind from |
| `HttpClientName` | `LumoAuth` | Named `HttpClient` for every SDK request |
| `BearerScheme` | `LumoAuthBearer` | Bearer token scheme |
| `OpenIdConnectScheme` | `LumoAuth` | OpenID Connect scheme |
| `CookieScheme` | `LumoAuthCookie` | Cookie scheme that holds the session |
| `NameClaimType` | `sub` | Claim that is the principal's name |
| `RoleClaimType` | `roles` | Claim that `[Authorize(Roles = "...")]` reads |
| `CapabilityClaimType` | `capability` | One claim for each agent capability |
| `PermissionClaimType` | `permission` | One claim for each permission, when enabled on the bearer scheme |
| `AgentIdClaimType` | `agent_id` | Present on agent principals |

## Configuration keys

| Key | Environment fallback | Default | Meaning |
|---|---|---|---|
| `LumoAuth:BaseUrl` | `LUMOAUTH_URL` | `https://app.lumoauth.dev` | Region URL |
| `LumoAuth:OrgId` | `LUMOAUTH_ORG_ID` | none | Organization slug |
| `LumoAuth:ApiKey` | `LUMOAUTH_API_KEY` | none | Organization API key, sent as `X-API-Key` |
| `LumoAuth:CredentialOptional` | | `false` | Allow a client with no API key |
| `LumoAuth:Timeout` | | 30 seconds | Timeout of each request, for example `"00:00:10"` |
| `LumoAuth:Login:ClientId` | | none | Enables OpenID Connect sign-in. Required for it. |
| `LumoAuth:Login:ClientSecret` | | none | Omit for a public client, which uses PKCE alone |
| `LumoAuth:Login:Scopes` | | `openid`, `profile`, `email` | Requested scopes |
| `LumoAuth:Login:CallbackPath` | | `/signin-lumoauth` | Redirect URI path |
| `LumoAuth:Login:SignedOutCallbackPath` | | `/signout-callback-lumoauth` | Post-logout redirect URI path |
| `LumoAuth:Login:SignedOutRedirectUri` | | `/` | Page after sign-out when nothing else is given |
| `LumoAuth:Login:GetClaimsFromUserInfoEndpoint` | | `true` | Also load UserInfo claims after sign-in |
| `LumoAuth:Login:SaveTokens` | | `true` | Keep the tokens in the session so that checks run as the user |

Every key can also come from the standard .NET environment form, for example
`LumoAuth__Login__ClientSecret`. `AddLumoAuth(o => { ... })` and
`AddLumoAuthWebAppAuthentication(login => { ... })` configure the same options in code.

## OpenID Connect sign-in

`builder.Services.AddLumoAuthWebAppAuthentication(builder.Configuration)` returns an
`AuthenticationBuilder`. It registers:

- `LumoAuthDefaults.CookieScheme` as `DefaultScheme`.
- `LumoAuthDefaults.OpenIdConnectScheme` as `DefaultChallengeScheme` and `DefaultSignOutScheme`.
- The OpenID Connect handler with `ResponseType = code`, `UsePkce = true`, the organization's
  issuer `{BaseUrl}/orgs/{OrgId}/api/v1` as `Authority` and `ValidIssuer`, and
  `MapInboundClaims = false`.

Claims after sign-in: `sub`, `name`, `picture`, `preferred_username`, the email under
`ClaimTypes.Email`, one `roles` claim for each role, one `capability` claim for each capability.
Read the subject with `user.GetLumoAuthSubject()`.

Adjust the underlying `OpenIdConnectOptions` with the optional second argument:

```csharp
builder.Services.AddLumoAuthWebAppAuthentication(builder.Configuration, oidc =>
{
    oidc.Events.OnRedirectToIdentityProvider = context =>
    {
        context.ProtocolMessage.SetParameter("ui_locales", "fr");
        return Task.CompletedTask;
    };
});
```

### An app that already calls AddAuthentication

Add only the OpenID Connect scheme and keep your own cookie scheme:

```csharp
using LumoAuth.AspNetCore;
using LumoAuth.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

builder.Services.AddLumoAuth(builder.Configuration);
builder.Services.Configure<LumoAuthLoginOptions>(
    builder.Configuration.GetSection("LumoAuth:Login"));
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = LumoAuthDefaults.OpenIdConnectScheme;
    })
    .AddCookie()
    .AddLumoAuthOpenIdConnect();
```

`AddLumoAuthOpenIdConnect()` reads `LumoAuthLoginOptions`, so bind them as shown.

## Sign-out

Sign out of both schemes. The cookie scheme ends the app session. The OpenID Connect scheme sends
the browser to LumoAuth's logout endpoint with the ID token as a hint, and LumoAuth sends it back
to `{origin}/signout-callback-lumoauth`.

Minimal API:

```csharp
app.MapGet("/logout", () => Results.SignOut(
    new AuthenticationProperties { RedirectUri = "/" },
    new[] { LumoAuthDefaults.CookieScheme, LumoAuthDefaults.OpenIdConnectScheme }));
```

Controller or page handler:

```csharp
public IActionResult Logout() => SignOut(
    new AuthenticationProperties { RedirectUri = "/" },
    LumoAuthDefaults.CookieScheme, LumoAuthDefaults.OpenIdConnectScheme);
```

Register `{origin}/signout-callback-lumoauth` under **Post-logout redirect URIs** on the
application's **Configuration** tab. LumoAuth honours the redirect only for a registered URI and
only when the request carries the ID token hint, so keep `SaveTokens` on.

## Bearer scheme options

```csharp
builder.Services
    .AddAuthentication(LumoAuthDefaults.BearerScheme)
    .AddLumoAuthBearer(options =>
    {
        options.PermissionsAsClaims = true;   // one extra request per token; the token needs authz:read
        options.Realm = "orders-api";
    });
```

| Option | Default | Meaning |
|---|---|---|
| `NameClaimType` | `sub` | Claim that is the principal's name |
| `RoleClaimType` | `roles` | Claim type for roles |
| `CapabilityClaimType` | `capability` | Claim type for agent capabilities |
| `PermissionsAsClaims` | `false` | Also list the caller's permissions and add each as a claim |
| `PermissionClaimType` | `permission` | Claim type for those permissions |
| `SaveToken` | `true` | Keep the token so that checks run as the caller |
| `Realm` | `LumoAuth` | Realm in the `WWW-Authenticate` challenge |

How the handler decides:

- No `Authorization: Bearer` header: no result. A protected endpoint then answers 401.
- UserInfo answers 401 or 403: authentication fails ("LumoAuth rejected the access token").
- LumoAuth cannot be reached: authentication fails and a warning is logged.
- Success: the principal has `sub`, `ClaimTypes.NameIdentifier`, `ClaimTypes.Email`, `roles`,
  `capability`, and every other UserInfo claim under its own name.

The handler accepts user tokens and agent tokens. `user.IsLumoAgent()` tells them apart, and
`user.GetCapabilities()` / `user.HasCapability("tool:search_web")` read agent capabilities.

Standard authorization works on these claims:

```csharp
app.MapGet("/admin", () => "admin area")
   .RequireAuthorization(new AuthorizeAttribute { Roles = "admin" });
```

Prefer `[RequirePermission]` over role names, so that access follows the organization's roles and
permissions without a code change.

## Browsers and bearer clients in one app

`AddLumoAuthWebAppAuthentication(...)` returns the builder, so the bearer scheme can be added to
the same app:

```csharp
builder.Services.AddLumoAuthWebAppAuthentication(builder.Configuration)
    .AddLumoAuthBearer();
```

The default scheme stays the cookie. An endpoint that does not name a scheme authenticates the
cookie only, and a bearer request to it is redirected to the login page. Name the bearer scheme on
every API endpoint:

```csharp
using Microsoft.AspNetCore.Authorization;

var bearerOnly = new AuthorizeAttribute { AuthenticationSchemes = LumoAuthDefaults.BearerScheme };

app.MapGet("/api/me", (ClaimsPrincipal user) => new { sub = user.GetLumoAuthSubject() })
   .RequireAuthorization(bearerOnly);

app.MapPost("/api/invoices/{id}/approve", (string id) => Results.Ok(new { approved = id }))
   .RequireAuthorization(bearerOnly)
   .RequirePermission("invoice.approve");
```

On a controller, set it on the attribute:
`[RequirePermission("invoice.approve", AuthenticationSchemes = LumoAuthDefaults.BearerScheme)]`.

In such an app the permission and relation checks on bearer endpoints run with the API key and
name the token's subject, because the saved-token lookup uses the default (cookie) scheme.
Configure `LumoAuth:ApiKey` and give the key the `authz:check` scope. ABAC checks still use the
incoming bearer token. When this is not wanted, host the API as its own app with the bearer scheme
as the default (step 3b of the skill).

## Keep the access token fresh in long sessions

The cookie session can outlive the access token that was saved at sign-in. Checks that run with
an expired token are denied. Refresh the token in the cookie scheme's `OnValidatePrincipal` event.
LumoAuth issues a refresh token when the application's grant types include `refresh_token`.

```csharp
using System.Globalization;
using LumoAuth;
using LumoAuth.AspNetCore;
using LumoAuth.Errors;
using LumoAuth.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;

builder.Services.Configure<CookieAuthenticationOptions>(LumoAuthDefaults.CookieScheme, options =>
{
    options.Events.OnValidatePrincipal = async context =>
    {
        var expiresAt = context.Properties.GetTokenValue("expires_at");
        var refreshToken = context.Properties.GetTokenValue("refresh_token");
        if (expiresAt is null || refreshToken is null)
        {
            return;
        }
        var expiry = DateTimeOffset.Parse(expiresAt, CultureInfo.InvariantCulture);
        if (expiry > DateTimeOffset.UtcNow.AddMinutes(1))
        {
            return;
        }

        var services = context.HttpContext.RequestServices;
        var lumo = services.GetRequiredService<LumoAuthClient>();
        var login = services.GetRequiredService<IOptions<LumoAuthLoginOptions>>().Value;
        try
        {
            TokenResponse fresh = await lumo.Auth.RefreshTokenAsync(
                new RefreshTokenRequest(refreshToken, login.ClientId!, login.ClientSecret),
                context.HttpContext.RequestAborted);
            context.Properties.UpdateTokenValue("access_token", fresh.AccessToken);
            if (!string.IsNullOrEmpty(fresh.RefreshToken))
            {
                context.Properties.UpdateTokenValue("refresh_token", fresh.RefreshToken);
            }
            context.Properties.UpdateTokenValue("expires_at",
                DateTimeOffset.UtcNow.AddSeconds(fresh.ExpiresIn).ToString("o", CultureInfo.InvariantCulture));
            context.ShouldRenew = true;
        }
        catch (LumoAuthException)
        {
            context.RejectPrincipal();   // the refresh token was refused: sign in again
        }
    };
});
```

Place this after `AddLumoAuthWebAppAuthentication`. `RefreshTokenAsync` authenticates with the
client ID and secret in the request body. It sends neither the API key nor a bearer token.

## Reverse proxies and HTTPS

The OpenID Connect handler builds the redirect URI from the request's scheme and host. Behind a
proxy that terminates TLS, the app sees `http` unless forwarded headers are applied:

```csharp
using Microsoft.AspNetCore.HttpOverrides;

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // Add your proxy to options.KnownProxies or options.KnownNetworks.
});

var app = builder.Build();
app.UseForwardedHeaders();   // before UseAuthentication
```

Register the public URL (`https://app.example.com/signin-lumoauth`). In development, run the HTTPS
launch profile so that the redirect URI and the handler's cookies use HTTPS.

## Resilience

Every SDK request goes through the named client `LumoAuthDefaults.HttpClientName`. Add handlers to
it with `builder.Services.AddHttpClient(LumoAuthDefaults.HttpClientName)`.

## Health check

`builder.Services.AddHealthChecks().AddLumoAuth()` adds an entry named `lumoauth`. It requests the
organization's OpenID configuration document and reports healthy when LumoAuth answers. The
parameters are `name`, `failureStatus`, `tags` and `timeout`. On failure the entry's data holds
the SDK error code.
