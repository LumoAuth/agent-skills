# Spring Security reference (LumoAuth starter)

How the starter connects LumoAuth to Spring Security: filter chains, sign-in, sign-out, bearer
tokens and method authorization. Classes are in `io.lumoauth.spring`.

## The default filter chain

The starter adds this chain when `lumoauth.login.client-id` is set, the app is a servlet web app,
the app defines no `SecurityFilterChain`, and `lumoauth.login.default-filter-chain` is not `false`:

- `lumoauth.login.permit-all` paths: open.
- Every other request: authenticated.
- `oauth2Login` with `defaultSuccessUrl(lumoauth.login.success-url, false)`: after sign-in the
  user returns to the page that they first asked for.
- `oauth2ResourceServer().opaqueToken()` with `LumoAuthTokenIntrospector`, when that bean exists.

URLs that Spring Security serves:

| URL | Purpose |
|---|---|
| `/oauth2/authorization/lumoauth` | Starts sign-in. Link to it from a "Sign in" button. |
| `/login/oauth2/code/lumoauth` | The redirect URI. Register `{origin}/login/oauth2/code/lumoauth`. |
| `/logout` | Spring Security's logout (POST with a CSRF token). Ends the app session only. |

## Your own filter chain

Define a `SecurityFilterChain` when the app needs its own rules. The starter's chain then backs
off, and its `ClientRegistrationRepository` and `OpaqueTokenIntrospector` beans stay available.
This example also signs the user out at LumoAuth:

```java
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
class WebSecurity {

    @Bean
    SecurityFilterChain app(HttpSecurity http, ClientRegistrationRepository registrations) throws Exception {
        OidcClientInitiatedLogoutSuccessHandler logout =
            new OidcClientInitiatedLogoutSuccessHandler(registrations);
        logout.setPostLogoutRedirectUri("{baseUrl}/");

        return http
            .authorizeHttpRequests(a -> a
                .requestMatchers("/", "/error", "/favicon.ico").permitAll()
                .requestMatchers("/admin/**").hasRole("admin")
                .anyRequest().authenticated())
            .oauth2Login(Customizer.withDefaults())
            .oauth2ResourceServer(o -> o.opaqueToken(Customizer.withDefaults()))
            .logout(l -> l.logoutSuccessHandler(logout))
            .build();
    }
}
```

- Remove the `oauth2ResourceServer` line when the resource server starter is not on the classpath.
- The logout handler sends the browser to LumoAuth's logout endpoint with the ID token as a hint.
  Register the post-logout URL (`http://localhost:8080/` in development,
  `https://app.example.com/` in production) under **Post-logout redirect URIs** on the
  application's **Configuration** tab in the portal. Without a registered URI, LumoAuth shows its
  own confirmation page.
- Keep CSRF protection on. Spring Security does not apply it to requests that carry a bearer token.

## Behind a reverse proxy

Spring builds the redirect URI from `{baseUrl}`, which comes from the incoming request. Behind a
proxy that terminates TLS, let Spring read the forwarded headers:

```yaml
server:
  forward-headers-strategy: framework
```

Configure the proxy to set `X-Forwarded-Proto` and `X-Forwarded-Host` on every request, and
register the public URL (`https://app.example.com/login/oauth2/code/lumoauth`).

## Bearer tokens

`LumoAuthTokenIntrospector` implements Spring's `OpaqueTokenIntrospector`. For each token it calls
LumoAuth's UserInfo endpoint.

| Outcome | Result |
|---|---|
| UserInfo answers 200 | An `OAuth2AuthenticatedPrincipal`: name is `sub`, attributes are the UserInfo claims |
| UserInfo answers 401 or 403 | `BadOpaqueTokenException`: the request gets 401 |
| LumoAuth cannot be reached, or answers another error | `OAuth2IntrospectionException`: the request fails with a server error, not 401 |

Authorities:

| Authority | Source |
|---|---|
| `ROLE_<role>` | Each entry of the `roles` claim. Use `.hasRole("admin")`. |
| `CAPABILITY_<slug>` | Each agent capability. Use `.hasAuthority("CAPABILITY_...")`. |
| `PERMISSION_<slug>` | Each permission of the caller, only with `lumoauth.security.permissions-as-authorities: true`. The token needs `authz:read`. |

The introspector accepts user tokens and agent tokens. It does not check the token's audience. To
turn it off, set `lumoauth.security.bearer-tokens: false` or define your own
`OpaqueTokenIntrospector`.

## @RequirePermission

```java
@RequirePermission("document.edit")
public void edit(String id) { }

@RequirePermission(value = {"document.edit", "document.publish"}, mode = RequirePermission.Mode.ANY)
public void publish(String id) { }
```

| Aspect | Behaviour |
|---|---|
| Targets | A method, or a class (every public method of the class) |
| `mode` | `Mode.ALL` (default): every permission. `Mode.ANY`: at least one. |
| No signed-in principal | `AuthenticationCredentialsNotFoundException` (401, or a redirect to sign-in) |
| Permission missing | `AccessDeniedException` (403) |
| LumoAuth cannot answer | The SDK's `LumoAuthException` propagates |
| Requirements | Spring Security on the classpath. No `@EnableMethodSecurity` is needed. |

The guard is a Spring AOP advisor. It applies to calls that go through the bean's proxy. A call
from another method of the same class is not checked.

## The lumo bean in expressions

`LumoAuthorization` is registered under the bean name `lumo`. Use it in `@PreAuthorize` (with
`@EnableMethodSecurity`), or inject it.

| Method | True when |
|---|---|
| `can(permission)` | The principal holds the permission |
| `canAll(permissions...)` | The principal holds every permission |
| `canAny(permissions...)` | The principal holds at least one |
| `relation(object, relation)` | `user:<sub>` has the relation to the object |
| `isViewer(object)`, `isEditor(object)`, `isOwner(object)` | The same with a fixed relation |
| `abac(resourceType, action, resourceId)` | ABAC allows it. False when no user access token is available. |
| `principal()` | Returns `LumoAuthorization.Principal` (`name`, `client`, `options`) |

```java
@PreAuthorize("@lumo.can('document.edit')")
public void edit(String id) { }

@PreAuthorize("@lumo.canAny('document.edit', 'document.admin')")
public void review(String id) { }

@PreAuthorize("@lumo.isViewer('document:' + #id)")
public Document read(String id) { return documents.get(id); }

@PreAuthorize("@lumo.abac('document', 'read', #id)")
public Document readClassified(String id) { return documents.get(id); }
```

The subject of a relation check is `user:` followed by the principal's name (the `sub` claim).
Write relationship tuples with the LumoAuth user ID.

## hasPermission(...) expressions

`LumoAuthPermissionEvaluator` maps Spring's `hasPermission` forms to LumoAuth:

| Expression | Check |
|---|---|
| `hasPermission(null, 'document.edit')` | RBAC permission |
| `hasPermission('document:123', 'viewer')` | Zanzibar relation, when the target is a `type:id` string |
| `hasPermission(#id, 'document', 'read')` | ABAC: target ID, resource type, action |

Spring Security's method security does not pick up a `PermissionEvaluator` bean on its own.
Publish an expression handler that uses it, or `hasPermission(...)` always denies:

```java
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.PermissionEvaluator;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

@Configuration
@EnableMethodSecurity
class MethodSecurityConfig {

    @Bean
    static MethodSecurityExpressionHandler methodSecurityExpressionHandler(PermissionEvaluator evaluator) {
        DefaultMethodSecurityExpressionHandler handler = new DefaultMethodSecurityExpressionHandler();
        handler.setPermissionEvaluator(evaluator);
        return handler;
    }
}
```

The `@lumo` expressions need no such bean. Prefer them in new code.

## Which credential runs a check

| Authentication | Permission and relation checks | ABAC checks |
|---|---|---|
| Bearer token (the authentication's credentials are an OAuth2 token) | A client that sends that token. The question is about the caller. | The same token. It needs `abac:read`. |
| OIDC browser login, or any other authentication | The `LumoAuth` bean (API key), with the principal's name as the subject. A name of `agent_<id>` is checked as that agent. The key needs the `authz:check` scope, or its owner the `authz.check` permission. | The user's access token from the `UserAccessTokenResolver`. With the OAuth2 client on the classpath, the starter reads it from the login's `OAuth2AuthorizedClient` and refreshes it when it has expired. |

The SDK never sends the API key to the ABAC routes, because those routes do not accept API keys.
When no user token is found, `abac` returns false and logs the reason.

For ABAC after a browser sign-in, add the scope:

```yaml
lumoauth:
  login:
    scopes: [openid, profile, email, abac:read]
```

To supply the user's token from your own store, define the resolver bean:

```java
package com.example.demo;

import io.lumoauth.spring.UserAccessTokenResolver;
import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class TokenLookup {

    @Bean
    UserAccessTokenResolver userAccessTokenResolver(MyTokenStore store) {
        return authentication -> Optional.ofNullable(store.accessTokenFor(authentication.getName()));
    }
}
```

`MyTokenStore` stands for the app's own component.

## Handle LumoAuth failures

A denied check never throws an SDK exception: it returns false, and the guard raises
`AccessDeniedException`. An SDK exception means that LumoAuth could not answer (network failure,
rate limit, a key without `authz:check`). The method does not run in either case. Turn the
exception into a clear response:

```java
package com.example.demo;

import io.lumoauth.errors.LumoAuthException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
class LumoAuthFailures {

    private static final Logger log = LoggerFactory.getLogger(LumoAuthFailures.class);

    @ExceptionHandler(LumoAuthException.class)
    ResponseEntity<Map<String, String>> onLumoAuthFailure(LumoAuthException e) {
        log.warn("LumoAuth check failed: {} {}", e.code(), e.getMessage());   // never log tokens
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(Map.of("error", "authorization_unavailable"));
    }
}
```

## Scopes to request

| The app uses | Add to `lumoauth.login.scopes` or to the bearer token |
|---|---|
| `@RequirePermission`, `@lumo.can`, `@lumo.relation` | nothing extra |
| `@lumo.abac`, three-argument `hasPermission` | `abac:read` |
| `permissions-as-authorities`, `permissions().list()` as the user | `authz:read` |

The OAuth application must be allowed to request the scope.
