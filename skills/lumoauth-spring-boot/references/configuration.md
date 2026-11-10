# Configuration reference (Spring Boot starter)

Properties bind to `io.lumoauth.spring.LumoAuthProperties` (prefix `lumoauth`).

## Properties

### Connection

| Property | Default | Meaning |
|---|---|---|
| `lumoauth.url` | `LUMOAUTH_URL`, then `https://app.lumoauth.dev` | Region URL. EU: `https://eu.app.lumoauth.dev`. |
| `lumoauth.org-id` | `LUMOAUTH_ORG_ID` | Organization slug. Required for sign-in and for calls under `/orgs/{orgId}`. |
| `lumoauth.api-key` | `LUMOAUTH_API_KEY` | Organization API key, sent as `X-API-Key`. Without it the `LumoAuth` bean can call only endpoints that need no credential. |
| `lumoauth.timeout` | `30s` | Timeout of each request |
| `lumoauth.skip-cert-validation` | `false` | Trusts any TLS certificate. Do not use it with the hosted service. |

Set `lumoauth.url` and `lumoauth.org-id` explicitly (for example with `${LUMOAUTH_ORG_ID}`
placeholders). The sign-in configuration builds the issuer from these two properties.

### Sign-in (`lumoauth.login.*`)

| Property | Default | Meaning |
|---|---|---|
| `client-id` | none | The OAuth client ID. Setting it enables sign-in. |
| `client-secret` | none | The client secret. Omit for a public client, which uses PKCE alone. |
| `scopes` | `openid`, `profile`, `email` | Requested scopes |
| `registration-id` | `lumoauth` | Spring Security registration ID. It forms the login URL `/oauth2/authorization/{registration-id}` and the callback `/login/oauth2/code/{registration-id}`. |
| `success-url` | `/` | Page after sign-in when no earlier request was saved (default filter chain only) |
| `permit-all` | `/`, `/error`, `/favicon.ico` | Paths that need no sign-in (default filter chain only). A list in your configuration replaces the default list. |
| `default-filter-chain` | `true` | Whether the starter adds a `SecurityFilterChain` when the app defines none |

With a client secret, the client authenticates at the token endpoint with HTTP Basic
(`client_secret_basic`). Without one, the registration uses no client authentication.

### Spring Security (`lumoauth.security.*`)

| Property | Default | Meaning |
|---|---|---|
| `bearer-tokens` | `true` | Register `LumoAuthTokenIntrospector`, which resolves bearer tokens through UserInfo |
| `role-authority-prefix` | `ROLE_` | Prefix of role authorities |
| `capability-authority-prefix` | `CAPABILITY_` | Prefix of agent capability authorities |
| `permissions-as-authorities` | `false` | Also list the caller's permissions for each token and grant each one as an authority. One extra request per token; the token needs the `authz:read` scope. |
| `permission-authority-prefix` | `PERMISSION_` | Prefix of those authorities |

### Agents (`lumoauth.agent.*`, `lumoauth.aauth.*`)

`lumoauth.agent.client-id` creates a `LumoAgent` bean (`client-secret`, `scopes`, `redirect-uri`).
`lumoauth.aauth.agent-identifier` creates an `AAuthClient` bean (`private-key-pem`, `kid`, default
`key-1`). Use `lumoauth-agent-identity` and `lumoauth-aauth` for these.

## Example

```yaml
lumoauth:
  url: ${LUMOAUTH_URL:https://app.lumoauth.dev}
  org-id: ${LUMOAUTH_ORG_ID}
  api-key: ${LUMOAUTH_API_KEY:}
  timeout: 10s
  login:
    client-id: ${LUMOAUTH_CLIENT_ID}
    client-secret: ${LUMOAUTH_CLIENT_SECRET}
    scopes: [openid, profile, email, abac:read]
    success-url: /dashboard
    permit-all: ["/", "/error", "/favicon.ico", "/public/**"]
  security:
    bearer-tokens: true
    permissions-as-authorities: false
```

`LUMOAUTH_CLIENT_ID` and `LUMOAUTH_CLIENT_SECRET` are names chosen for this example. The SDK itself
reads only `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID` and `LUMOAUTH_API_KEY`.

## Auto-configurations

| Class | Provides | Active when |
|---|---|---|
| `LumoAuthAutoConfiguration` | `LumoAuth` bean; `LumoAgent` and `AAuthClient` beans when configured | always |
| `LumoAuthSecurityAutoConfiguration` | The `lumo` bean (`LumoAuthorization`), `LumoAuthPermissionEvaluator`, the `@RequirePermission` advisor, `LumoAuthTokenIntrospector`, a `UserAccessTokenResolver` for OIDC logins | Spring Security is on the classpath. The introspector also needs the resource server classes and `lumoauth.security.bearer-tokens` not `false`. The token resolver needs the OAuth2 client classes. |
| `LumoAuthLoginAutoConfiguration` | A `ClientRegistrationRepository` with the `lumoauth` registration, and the default `SecurityFilterChain` | A servlet web app, the OAuth2 client classes, and `lumoauth.login.client-id` |
| `LumoAuthHealthAutoConfiguration` | `LumoAuthHealthIndicator` | Spring Boot's health support (Actuator) is on the classpath |

Every bean backs off when the app defines its own bean of the same type:

| Your bean | Effect |
|---|---|
| `io.lumoauth.LumoAuth` | Replaces the SDK client |
| `java.net.http.HttpClient` | Used for every SDK request (proxies, custom TLS, instrumentation) |
| `io.lumoauth.TokenProvider` | The `LumoAuth` bean sends the bearer token that it returns instead of the API key |
| `ClientRegistrationRepository` | Replaces the starter's registration. Add LumoAuth to yours with `LumoAuthLoginAutoConfiguration.clientRegistration(props)`. |
| `SecurityFilterChain` | Replaces the starter's default chain |
| `OpaqueTokenIntrospector` | Replaces `LumoAuthTokenIntrospector` |
| `PermissionEvaluator` | Replaces `LumoAuthPermissionEvaluator` |
| `io.lumoauth.spring.UserAccessTokenResolver` | Supplies the user's access token for ABAC checks |

## The client registration

`LumoAuthLoginAutoConfiguration.clientRegistration(LumoAuthProperties)` builds the registration
from fixed endpoint paths under the issuer `{url}/orgs/{org-id}/api/v1`, so the app makes no
discovery request at startup:

| Setting | Value |
|---|---|
| Authorization endpoint | `{issuer}/oauth/authorize` |
| Token endpoint | `{issuer}/oauth/token` |
| UserInfo endpoint | `{issuer}/oauth/userinfo` |
| JWK set | `{issuer}/.well-known/jwks.json` |
| End session endpoint | `{issuer}/oauth/logout` |
| Redirect URI template | `{baseUrl}/login/oauth2/code/{registrationId}` |
| User name attribute | `sub` |

On a custom domain the issuer is different. Define your own `ClientRegistrationRepository` with
the values from the organization's discovery document in that case (`lumoauth-oauth-oidc`).

## Health indicator

Add `spring-boot-starter-actuator`. The indicator `lumoauth` requests the organization's OpenID
configuration document. It reports `UP` with the details `url`, `issuer` and `orgId`, or `DOWN`
with the SDK error code.

```yaml
management:
  endpoint:
    health:
      show-components: always      # exposes /actuator/health/lumoauth
```

- The indicator takes part in the app's overall health. When LumoAuth cannot be reached,
  `/actuator/health` reports `DOWN`. Turn the indicator off with
  `management.health.lumoauth.enabled: false` when that is not wanted, for example on a liveness
  probe.
- With the starter's default filter chain, `/actuator/**` requires sign-in. Add
  `/actuator/health/**` to `lumoauth.login.permit-all` when a probe must reach it.

## Requirements

| | Value |
|---|---|
| Java | 17 or newer |
| Spring Boot | 4.x (the starter is built against 4.1.2) |
| Web stack for sign-in | Servlet (Spring MVC) |
| Core dependency | `jackson-databind` |

The starters `spring-boot-starter-oauth2-client` and `spring-boot-starter-oauth2-resource-server`
are the older names of `spring-boot-starter-security-oauth2-client` and
`spring-boot-starter-security-oauth2-resource-server`. Either name activates the integration.
