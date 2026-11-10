---
name: lumoauth-spring-boot
description: >-
  Adds LumoAuth to Java and Spring Boot apps with the Java SDK io.lumoauth:lumo-auth-java and
  io.lumoauth:lumo-auth-spring-boot-starter: Maven and Gradle coordinates, the lumoauth.*
  properties in application.yml, browser sign-in through Spring Security OIDC login
  (authorization code with PKCE, /oauth2/authorization/lumoauth, /login/oauth2/code/lumoauth),
  resource server bearer tokens resolved by LumoAuthTokenIntrospector, method authorization with
  @RequirePermission, @PreAuthorize("@lumo.can(...)") and LumoAuthPermissionEvaluator, RBAC,
  Zanzibar and ABAC checks, the actuator health indicator, and the plain LumoAuth client for
  code without Spring. Use when the user asks to add login, OIDC, a SecurityFilterChain,
  protected endpoints, permission checks or bearer token validation to a Java 17+, Spring Boot,
  Spring Security, Maven or Gradle project, or mentions lumo-auth-java,
  lumo-auth-spring-boot-starter or LumoAuthProperties. Not for AI agents in Java (LumoAgent,
  AAuth); the agent skills cover those.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Java and Spring Boot

Add LumoAuth sign-in, bearer token authentication and live permission checks to a Spring Boot
app, or call LumoAuth from any Java code. There are two artifacts in the group `io.lumoauth`:

| Artifact | Use it for |
|---|---|
| `lumo-auth-spring-boot-starter` | Spring Boot apps. Auto-configures the SDK and Spring Security. It brings in `lumo-auth-java`. |
| `lumo-auth-java` | Any Java 17+ code. It depends only on the JDK and Jackson. |

Versions, taken from the SDK's `pom.xml` files:

- Both artifacts: `1.4.0`. Java release level: 17.
- The starter `1.4.0` is built against Spring Boot `4.1.2` and uses Spring Boot 4 class and
  package names. Use it with Spring Boot 4. For a Spring Boot 3 app, use `lumo-auth-java` alone
  and configure Spring Security's own OIDC support with `lumoauth-oauth-oidc`.
- Browser sign-in works in servlet (Spring MVC) apps.

If the build cannot resolve `1.4.0`, look up the newest published version of the artifact, use
it, and tell the user which version you used.

## When to use

- A Spring Boot web app needs login through LumoAuth.
- A Spring Boot API must accept LumoAuth access tokens.
- Service or controller methods need RBAC, relationship or ABAC checks.
- Plain Java code (a job, a CLI, another framework) calls LumoAuth.

Do not use this skill for:

- AI agents in Java (`LumoAgent`, `JitContext`, `DelegationChain`, approvals): use
  `lumoauth-agent-identity`, `lumoauth-agent-approvals` and `lumoauth-agent-delegation`.
- AAuth (`AAuthClient`, `AAuthVerifier`): use `lumoauth-aauth`.
- Spring Security configured by hand against the OIDC endpoints: use `lumoauth-oauth-oidc`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask which region the organization is in. |
| Organization slug | The `{orgId}` in the portal URL `/orgs/{orgId}/portal/`, for example `acme-corp`. |
| Client ID and client secret | An OAuth application in the organization. Needed for browser sign-in only. The secret is shown once. |
| Redirect URI | `{app origin}/login/oauth2/code/lumoauth`. Development: `http://localhost:8080/login/oauth2/code/lumoauth`. Production: `https://app.example.com/login/oauth2/code/lumoauth`. |
| API key (`lmk_...`) | Needed when checks run after a browser sign-in (step 4). Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`). Tick the `authz:check` scope and nothing that the app does not use. |

Create or find the OAuth application in one of these ways:

- Portal: **Applications → New application**, choose **Web application**, enter the redirect URI,
  click **Create application**. Copy the client secret from the page that opens next.
- CLI: show the user this command before you run it, because it creates an application.

```bash
lumo login --org acme-corp
lumo apps list
lumo apps create --name "My Spring app" \
  --redirect-uris http://localhost:8080/login/oauth2/code/lumoauth -o json
```

The JSON output contains `clientId` and `secret`. The secret is not shown again.

Redirect URIs are matched exactly (scheme, host, port, path). `http://` is accepted only for
`localhost`, `127.0.0.1` and `[::1]`.

## Steps

### 1. Add the dependencies

Maven (`pom.xml`). The Spring Boot starters take their version from the Spring Boot parent:

```xml
<dependency>
  <groupId>io.lumoauth</groupId>
  <artifactId>lumo-auth-spring-boot-starter</artifactId>
  <version>1.4.0</version>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-webmvc</artifactId>
</dependency>
<!-- Browser sign-in -->
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-security-oauth2-client</artifactId>
</dependency>
<!-- Bearer tokens on API requests -->
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-security-oauth2-resource-server</artifactId>
</dependency>
```

Gradle (Kotlin DSL): `implementation("io.lumoauth:lumo-auth-spring-boot-starter:1.4.0")` plus the
same three Spring Boot starters without a version.

Each integration turns on only when its Spring dependency is present. Leave out the OAuth2 client
starter for an API that has no browser sign-in, and the resource server starter for an app that
accepts no bearer tokens.

### 2. Configure

`src/main/resources/application.yml`:

```yaml
lumoauth:
  url: ${LUMOAUTH_URL:https://app.lumoauth.dev}
  org-id: ${LUMOAUTH_ORG_ID}
  api-key: ${LUMOAUTH_API_KEY:}
  login:
    client-id: ${LUMOAUTH_CLIENT_ID}
    client-secret: ${LUMOAUTH_CLIENT_SECRET}
    scopes: [openid, profile, email]
    permit-all: ["/", "/error", "/favicon.ico"]
```

Set the values in the environment. Do not write secrets into `application.yml`:

```bash
export LUMOAUTH_URL=https://app.lumoauth.dev
export LUMOAUTH_ORG_ID=acme-corp
export LUMOAUTH_API_KEY=lmk_...          # server only
export LUMOAUTH_CLIENT_ID=...            # from the OAuth application
export LUMOAUTH_CLIENT_SECRET=...        # from the OAuth application; server only
```

Setting `lumoauth.login.client-id` is what enables sign-in. For an API without browser sign-in,
remove the whole `login` block. The `LumoAuth` bean is created with or without an API key.

### 3. Web app: sign users in

With the configuration above and no `SecurityFilterChain` of your own, the starter adds one:

- Paths in `lumoauth.login.permit-all` are open. Every other path requires a signed-in user.
- An anonymous browser is sent to LumoAuth. The login URL is `/oauth2/authorization/lumoauth` and
  the callback is `/login/oauth2/code/lumoauth`.
- LumoAuth bearer tokens are accepted on the same app when the resource server starter is present.

Spring Security runs the authorization code flow, sends a PKCE challenge, checks `state` and
`nonce`, and validates the ID token against the organization's issuer and keys.

```java
package com.example.demo;

import io.lumoauth.spring.RequirePermission;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @RestController
    static class Pages {
        private final Invoices invoices;

        Pages(Invoices invoices) {
            this.invoices = invoices;
        }

        @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
        String home() {
            return "<a href=\"/dashboard\">Sign in</a>";
        }

        @GetMapping(value = "/dashboard", produces = MediaType.TEXT_PLAIN_VALUE)
        String dashboard(@AuthenticationPrincipal OidcUser user) {
            return "Hello " + user.getEmail() + " (" + user.getSubject() + ")";
        }

        @GetMapping(value = "/invoices/{id}", produces = MediaType.TEXT_PLAIN_VALUE)
        String invoice(@PathVariable String id) {
            return invoices.read(id);
        }
    }

    @Service
    static class Invoices {
        @RequirePermission("invoice.read")      // 403 unless the signed-in user holds the permission
        public String read(String id) {
            return "invoice " + id;
        }
    }
}
```

### 4. Authorize methods

`@RequirePermission` works on any Spring bean method that is called through its proxy, and on a
class (then it guards every public method). It needs Spring Security on the classpath.

```java
package com.example.demo;

import io.lumoauth.spring.RequirePermission;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

@Service
public class DocumentService {

    @RequirePermission("document.edit")                                  // RBAC, one permission
    public void edit(String id) { }

    @RequirePermission(value = {"document.edit", "document.publish"},
                       mode = RequirePermission.Mode.ANY)                // any one of them
    public void publish(String id) { }

    @PreAuthorize("@lumo.isEditor('document:' + #id)")                   // Zanzibar relation
    public void rename(String id, String title) { }

    @PreAuthorize("@lumo.abac('document', 'delete', #id)")               // ABAC; needs abac:read
    public void delete(String id) { }
}
```

`@PreAuthorize` needs `@EnableMethodSecurity` on a configuration class. `@RequirePermission` does
not. The `lumo` bean (`io.lumoauth.spring.LumoAuthorization`) offers `can`, `canAll`, `canAny`,
`relation`, `isViewer`, `isEditor`, `isOwner` and `abac`.

Which credential runs a check:

| The user signed in with | Permission and relation checks | ABAC checks |
|---|---|---|
| A bearer token (resource server) | The caller's own token. No API key is needed. | The caller's own token. It needs `abac:read`. |
| Browser sign-in (OIDC login) | The app's API key, with the user's `sub` as the subject. The key needs the `authz:check` scope. | The access token that Spring Security stored for the login. Add `abac:read` to `lumoauth.login.scopes`. |

A denied check raises `AccessDeniedException` (403). A failure to ask LumoAuth, for example an API
key without `authz:check`, raises a `LumoAuthException`, which becomes a 500 unless the app
handles it. Read [references/security.md](references/security.md) for an exception handler, your
own `SecurityFilterChain`, sign-out at LumoAuth, `hasPermission(...)` expressions and the token
lookup for ABAC.

For roles, permissions, relationship models and policies use `lumoauth-rbac`, `lumoauth-rebac` and
`lumoauth-abac`.

### 5. API: accept bearer tokens

For a service that receives `Authorization: Bearer <access token>`, keep the resource server
starter, remove the `lumoauth.login` block, and define the chain:

```java
package com.example.api;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.OAuth2AuthenticatedPrincipal;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Configuration
class ApiSecurity {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .authorizeHttpRequests(a -> a
                .requestMatchers("/admin/**").hasRole("admin")
                .anyRequest().authenticated())
            // The starter supplies the OpaqueTokenIntrospector bean.
            .oauth2ResourceServer(o -> o.opaqueToken(Customizer.withDefaults()))
            .build();
    }
}

@RestController
class MeController {

    @GetMapping("/api/me")
    String me(@AuthenticationPrincipal OAuth2AuthenticatedPrincipal principal) {
        return principal.getName();   // the LumoAuth subject
    }
}
```

`LumoAuthTokenIntrospector` sends each token to LumoAuth's UserInfo endpoint. The principal's name
is `sub`, its attributes are the UserInfo claims, and its authorities are `ROLE_<role>` for each
role and `CAPABILITY_<slug>` for each agent capability. A token that LumoAuth rejects gives 401.

This costs one call to LumoAuth per request and does not compare the token's `aud` with your API.
When the API must accept only tokens that were issued for it, or must validate offline, use Spring
Security's JWT resource server with the organization's issuer and an audience check, as described
in `lumoauth-api-protection`, and set `lumoauth.security.bearer-tokens: false`.

### 6. Plain Java

```xml
<dependency>
  <groupId>io.lumoauth</groupId>
  <artifactId>lumo-auth-java</artifactId>
  <version>1.4.0</version>
</dependency>
```

```java
package com.example.jobs;

import io.lumoauth.LumoAuth;
import io.lumoauth.errors.LumoAuthException;
import io.lumoauth.model.CheckOptions;

public class CheckAccess {

    public static void main(String[] args) {
        LumoAuth lumo = LumoAuth.fromEnvironment();   // LUMOAUTH_URL, LUMOAUTH_ORG_ID, LUMOAUTH_API_KEY
        String userId = args[0];                      // the LumoAuth user ID: the `sub` of the user's tokens
        try {
            boolean canApprove = lumo.permissions().check("invoice.approve", CheckOptions.forUser(userId));
            boolean canView = lumo.zanzibar().isViewer("document:readme", "user:" + userId);
            System.out.println("approve=" + canApprove + " view=" + canView);
        } catch (LumoAuthException e) {
            System.err.println(e.code() + ": " + e.getMessage());   // could not ask: treat as denied
        }
    }
}
```

A check about another user needs the `authz:check` scope on the API key. Read
[references/java-client.md](references/java-client.md) for the builder options, every check
method, ABAC, `AuthorizationCodeFlow` for sign-in without Spring, raw requests and the exceptions.

## Verify

1. Start the app (`./mvnw spring-boot:run` or `./gradlew bootRun`) and open
   `http://localhost:8080/dashboard`. The browser goes to the LumoAuth login page of the
   organization, returns to `/login/oauth2/code/lumoauth` and shows the greeting.
2. Open `/invoices/1` as a user without `invoice.read`: 403. Grant the permission through a role
   and reload: 200.
3. API variant: `curl -i http://localhost:8080/api/me` returns 401.
   `curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/me` returns the subject.
4. With `spring-boot-starter-actuator`, `/actuator/health` includes the `lumoauth` indicator; see
   [references/configuration.md](references/configuration.md).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in, the health indicator or the default filter chain do not appear on a Spring Boot 3 app | The starter `1.4.0` targets Spring Boot 4 | Move the app to Spring Boot 4, or use `lumo-auth-java` alone. |
| No redirect to LumoAuth for an anonymous browser | `lumoauth.login.client-id` is not set, or the OAuth2 client starter is missing | Set the property and add `spring-boot-starter-security-oauth2-client`. |
| LumoAuth shows a redirect URI error | The URI that the app sends is not registered exactly | Register `{origin}/login/oauth2/code/lumoauth`. Behind a proxy, see `references/security.md`. |
| 500 with `LumoAuthPermissionDeniedException` (`INSUFFICIENT_PERMISSIONS`) on every `@RequirePermission` after a browser sign-in | The check runs with the API key for the signed-in user, and the key lacks `authz:check` | Give the API key the `authz:check` scope. |
| 500 with `LumoAuthAuthenticationException` on a check after a browser sign-in | No API key is configured | Set `lumoauth.api-key`. |
| `@RequirePermission` is ignored | The method is private, or called from inside the same class | Call it through the injected bean. |
| `@PreAuthorize("@lumo...")` is ignored | Method security is off | Add `@EnableMethodSecurity`. |
| `hasPermission(...)` always denies | Spring Security does not use a `PermissionEvaluator` bean on its own | Publish the expression handler shown in `references/security.md`, or use `@lumo` expressions. |
| `@lumo.abac(...)` always returns false; the log says that no user access token is available | The request has no user token | Sign in with OIDC and the `abac:read` scope, or send a bearer token. |
| The starter's filter chain is gone | The app defines its own `SecurityFilterChain` | Add `.oauth2Login(...)` and `.oauth2ResourceServer(...)` to your chain; see `references/security.md`. |

Security rules for this integration:

- Keep the client secret and the API key in environment variables or a secret store. Never
  commit them and never send them to the browser.
- Never log access tokens, refresh tokens or ID tokens.
- Do not set `lumoauth.skip-cert-validation`.
- Request only the scopes that the app uses, and give the API key only the scopes that it needs.
- Keep CSRF protection on for browser sessions.

## Related skills

- `lumoauth-getting-started`: organizations, regions and credentials.
- `lumoauth-cli`: `lumo login` and `lumo apps`.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`, `lumoauth-authorization`: design the model that
  these checks read.
- `lumoauth-api-protection`: local JWT validation, machine-to-machine clients, introspection.
- `lumoauth-oauth-oidc`: endpoints and claims for Spring Security configured by hand.
- `lumoauth-agent-identity`, `lumoauth-aauth`: agents and AAuth in Java.

## References

- [references/configuration.md](references/configuration.md): every `lumoauth.*` property, the
  auto-configurations, bean overrides and the health indicator.
- [references/security.md](references/security.md): filter chains, sign-out, bearer tokens,
  method security, exception handling.
- [references/java-client.md](references/java-client.md): the `LumoAuth` client without Spring.
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/oauth/logout
