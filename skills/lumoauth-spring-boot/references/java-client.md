# LumoAuth client reference (plain Java)

`io.lumoauth:lumo-auth-java` works without Spring: jobs, command-line tools, other frameworks.
Packages: `io.lumoauth` (client), `io.lumoauth.model` (requests and results),
`io.lumoauth.errors` (exceptions), `io.lumoauth.web` (sign-in flow). It needs Java 17 or newer.

In a Spring Boot app with the starter, inject the `LumoAuth` bean instead of building one.

## Build a client

```java
import io.lumoauth.LumoAuth;
import java.time.Duration;

LumoAuth lumo = LumoAuth.builder()
    .baseUrl("https://app.lumoauth.dev")
    .orgId("acme-corp")
    .apiKey(System.getenv("LUMOAUTH_API_KEY"))
    .timeout(Duration.ofSeconds(10))
    .build();
```

`LumoAuth.fromEnvironment()` is the same as `LumoAuth.builder().build()`.

| Builder method | Default | Meaning |
|---|---|---|
| `baseUrl(url)` | `LUMOAUTH_URL`, then `https://app.lumoauth.dev` | Region URL. EU: `https://eu.app.lumoauth.dev`. |
| `orgId(slug)` | `LUMOAUTH_ORG_ID` | Organization slug |
| `apiKey(key)` | `LUMOAUTH_API_KEY` | Organization API key, sent as `X-API-Key` |
| `accessToken(token)` | none | A fixed bearer token |
| `tokenProvider(() -> ...)` | none | Returns a bearer token for each request. A returned token wins over the API key. |
| `timeout(duration)` | 30 seconds | Timeout of each request |
| `httpClient(client)` | a new client | Your own `java.net.http.HttpClient` |
| `header(name, value)` | none | A header on every request |
| `userAgent(value)` | `lumoauth-java/<version>` | User agent |
| `withoutCredential()` | off | Build a client with no credential, for calls that need none |

`build()` throws `LumoAuthConfigException` when no credential is configured and
`withoutCredential()` was not called. The client is immutable and thread-safe: build one for each
credential and share it.

A client that acts as one user:

```java
LumoAuth asUser = LumoAuth.builder()
    .baseUrl(lumo.baseUrl())
    .orgId(lumo.orgId().orElse(null))
    .accessToken(userAccessToken)
    .build();
```

## Which credential works where

| Credential | Accepted on |
|---|---|
| Organization API key (`lmk_...`) | Permission checks, Zanzibar check and expand, the Admin API, client registration. Not ABAC, agent or JIT routes. |
| User access token | Calls about that user. Some need a scope. |
| Agent credential | Agent, approval and JIT routes and the checks. See `lumoauth-agent-identity`. |

An API key acts for the organization member who created it. A check about another subject needs
the `authz:check` scope on the key or token, or the `authz.check` permission.

## Permissions (RBAC)

```java
import io.lumoauth.model.CheckOptions;
import io.lumoauth.model.PermissionBulkCheck;
import io.lumoauth.model.PermissionCheck;
import java.util.List;

boolean mine = lumo.permissions().check("document.edit");                           // the caller
boolean theirs = lumo.permissions().check("document.edit", CheckOptions.forUser(userId));
boolean agent = lumo.permissions().check("document.edit", CheckOptions.forAgent("agt_c8ed16883d441af8"));

boolean all = lumo.permissions().checkAll(List.of("document.edit", "document.publish"));
boolean any = lumo.permissions().checkAny(List.of("report.view", "report.admin"));
PermissionBulkCheck each = lumo.permissions().checkBulk(List.of("document.edit", "document.delete"));
boolean canDelete = each.allowed("document.delete");

PermissionCheck detail = lumo.permissions().checkDetailed("document.edit", CheckOptions.forUser(userId));
```

| `CheckOptions` | Meaning |
|---|---|
| none, or `CheckOptions.NONE` | The check is about the caller: the key's owner or the token's subject |
| `CheckOptions.forUser(userId)` | Another user, by LumoAuth user ID (the `sub` of the user's tokens) |
| `CheckOptions.forAgent(agentId)` | An agent, by its `agt_...` ID |
| `CheckOptions.withContext(map)` | Extra context for policies. Combine with `.user(id)` or `.agent(id)`. |

`permissions().list()` and `listSlugs()` list the caller's permissions. They need a user access
token with the `authz:read` scope; an API key cannot hold that scope.

Server answers to know: 403 `INSUFFICIENT_PERMISSIONS` (the credential may not ask about other
subjects) and 404 `SUBJECT_NOT_FOUND` (the ID is not a LumoAuth ID in this organization).

## Zanzibar (ReBAC)

```java
import io.lumoauth.model.ZanzibarCheck;
import io.lumoauth.model.ZanzibarUsersetNode;

boolean canView = lumo.zanzibar().isViewer("document:readme", "user:" + userId);
boolean related = lumo.zanzibar().check("folder:q4", "member", "group:finance#member");
ZanzibarCheck detail = lumo.zanzibar().checkDetailed("document:readme", "viewer", "user:" + userId);
ZanzibarUsersetNode tree = lumo.zanzibar().expand("document:readme", "viewer");
List<String> everyone = tree.allSubjects();
```

Shortcuts: `isViewer`, `isEditor`, `isOwner`, `isMember`, `isAdmin`.

## ABAC

ABAC needs a user access token with `abac:read` (checks and reads) or `abac:write` (writes), or an
agent credential. API keys are refused.

```java
import io.lumoauth.model.AbacCheck;
import io.lumoauth.model.AbacDecision;
import java.util.Map;

AbacDecision decision = asUser.abac().check(
    AbacCheck.of("document", "read", "doc-123")
        .context(Map.of("pep", Map.of("ip", clientIp))));
boolean allowed = decision.allowed();          // decision.reason(), decision.matchedPolicies()

List<AbacDecision> many = asUser.abac().checkBulk(
    List.of(AbacCheck.of("document", "read", "doc-1"), AbacCheck.of("document", "read", "doc-2")),
    Map.of("pep", Map.of("ip", clientIp)));    // one environment for all checks
```

- The context is sent as the check's `environment`. LumoAuth sets `ip`, `userAgent`,
  `requestMethod` and `requestPath` itself from the request that it receives from your server.
  Send the end user's IP address as `pep.ip` and write policies against `pep.ip`.
- A bulk check takes at most 100 checks and one environment. The one-argument `checkBulk` requires
  every check to carry the same context; otherwise it throws `LumoAuthValidationException`.
- Other calls: `isAllowed`, `myAttributes`, `resourceAttributes`, `attributeDefinitions`,
  `setUserAttribute`, `setResourceAttribute` (the last two also need the `abac.manage` permission).

## Sign-in without Spring

`io.lumoauth.web.AuthorizationCodeFlow` runs the authorization code flow with PKCE against any
session store. In a Spring Boot app, prefer the starter's OIDC login.

```java
import io.lumoauth.web.AuthorizationCodeFlow;

AuthorizationCodeFlow flow = AuthorizationCodeFlow
    .builder(lumo, clientId, "https://app.example.com/callback")
    .clientSecret(clientSecret)            // leave out for a public client
    .scope("openid profile email")
    .build();

// Login endpoint: keep the pending login in the server-side session, then redirect.
AuthorizationCodeFlow.PendingLogin pending = flow.start("/dashboard");
// redirect the browser to pending.authorizationUrl()

// Callback endpoint: pass the stored value and the callback's query parameters (Map<String, String>).
AuthorizationCodeFlow.SignedIn session = flow.complete(pending, queryParams);
// store `session`, then redirect to pending.returnTo()
```

| Member | Purpose |
|---|---|
| `start(returnTo)` / `start()` | Creates the PKCE pair and `state`. Returns `PendingLogin` (`state`, `codeVerifier`, `redirectUri`, `returnTo`, `authorizationUrl`). Store it server-side; it holds the PKCE verifier. |
| `complete(pending, callbackParams)` | Checks `state`, exchanges the code, loads UserInfo. Returns `SignedIn` (`user`, `tokens`, `expiresAt`, `expired()`). |
| `refresh(session)` | `Optional<SignedIn>` with new tokens from the refresh token |
| `revoke(session)` | Revokes the refresh token at sign-out |
| `clientFor(session)` | A `LumoAuth` client that acts as the signed-in user |
| `AuthorizationCodeFlow.sanitizeReturnTo(value, fallback)` | Accepts local paths only |

Register the callback URL as a redirect URI on the OAuth application. With no API key, build the
`LumoAuth` client for the flow with `withoutCredential()`.

Lower-level calls on `lumo.auth()`: `authorizationUrl(AuthorizationUrlRequest)`,
`exchangeCode(CodeExchangeRequest)`, `refreshToken(RefreshTokenRequest)`,
`clientCredentials(clientId, clientSecret, scopes...)`, `revoke(RevokeRequest)`,
`userinfo(accessToken)`. Token calls authenticate with the client ID and secret in the form body;
they never send the API key.

```java
import io.lumoauth.model.UserInfo;

UserInfo me = lumo.auth().userinfo(userAccessToken);
String sub = me.sub();
List<String> roles = me.roles();
Object department = me.claim("department").orElse(null);
```

## Any other endpoint

```java
import java.util.Map;

Map<String, Object> users = lumo.requestMap("GET", lumo.orgPath("/admin/users"), null);
```

`orgPath("/x")` returns `/orgs/{orgId}/api/v1/x`. Also available: `request(method, path, body,
Type.class)`, `requestNode(...)` (a Jackson `JsonNode`) and `requestRaw(...)`. These methods use
the client's credential and the same error mapping. For the Admin API itself use
`lumoauth-admin-api`.

## Exceptions

All exceptions are unchecked and extend `LumoAuthException`, which has `code()`.

| Exception | Default `code()` | When |
|---|---|---|
| `LumoAuthApiException` | `API_ERROR` | Any answer that is not 2xx. `statusCode()`, `body()`, `bodyField(key)`. |
| `LumoAuthAuthenticationException` | `AUTHENTICATION_ERROR` | 401 |
| `LumoAuthPermissionDeniedException` | `PERMISSION_DENIED` | 403. `requiredScopes()` lists the scopes that the server named. |
| `LumoAuthNotFoundException` | `NOT_FOUND` | 404 |
| `LumoAuthRateLimitException` | `RATE_LIMITED` | 429. `retryAfter()` is an `Optional<Duration>`. |
| `LumoAuthValidationException` | `VALIDATION_ERROR` | Bad input, or an answer that the SDK cannot use |
| `LumoAuthConfigException` | `CONFIG_ERROR` | Missing or invalid configuration |
| `LumoAuthNetworkException` | `NETWORK_ERROR` | Transport failure or timeout |

The four HTTP exceptions extend `LumoAuthApiException`. For an API exception, `code()` is the code
in the response body when the server sends one. Match on the exception type.

```java
import io.lumoauth.errors.LumoAuthApiException;
import io.lumoauth.errors.LumoAuthException;
import io.lumoauth.errors.LumoAuthPermissionDeniedException;
import io.lumoauth.errors.LumoAuthRateLimitException;

try {
    boolean ok = lumo.permissions().check("document.edit");
} catch (LumoAuthPermissionDeniedException e) {
    System.err.println("403, missing scopes: " + e.requiredScopes());
} catch (LumoAuthRateLimitException e) {
    System.err.println("retry after " + e.retryAfter().orElse(null));
} catch (LumoAuthApiException e) {
    System.err.println("LumoAuth returned " + e.statusCode() + ": " + e.getMessage());
} catch (LumoAuthException e) {
    System.err.println(e.code() + ": " + e.getMessage());
}
```

A check that is denied is not an exception: `check` returns `false`. An exception means that the
question could not be answered. Deny access in that case.

The approval and budget exceptions belong to agents; see `lumoauth-agent-approvals`.
