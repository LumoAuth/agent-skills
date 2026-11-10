# `LumoAuth\LumoAuth` client reference

Signatures from `lumoauth/lumoauth` 1.4.0. The package needs PHP 8.1 or later, `ext-json`, a
PSR-18 client and PSR-17 factories. `ext-sodium` is needed only for AAuth signing.

## Contents

- [Constructor](#constructor)
- [Credentials](#credentials)
- [Scopes that a user access token needs](#scopes-that-a-user-access-token-needs)
- [Namespaces](#namespaces)
- [Errors](#errors)
- [Transport](#transport)
- [Generated client for the full REST API](#generated-client-for-the-full-rest-api)

## Constructor

```php
<?php

use LumoAuth\LumoAuth;

$lumo = new LumoAuth();                                              // everything from the environment
$lumo = new LumoAuth(apiKey: getenv('LUMOAUTH_API_KEY'), orgId: 'acme-corp');
$lumo = new LumoAuth(orgId: 'acme-corp', tokenProvider: fn (): ?string => $_SESSION['lumoauth']['access_token'] ?? null);
```

Every argument is optional and named.

| Argument | Type | Environment variable | Default |
|---|---|---|---|
| `apiKey` | `?string` | `LUMOAUTH_API_KEY` | none. Sent in the `X-API-Key` header. |
| `baseUrl` | `?string` | `LUMOAUTH_URL` | `https://app.lumoauth.dev`. EU: `https://eu.app.lumoauth.dev`. |
| `orgId` | `?string` | `LUMOAUTH_ORG_ID` | none. Calls inside an organization throw `LumoAuthConfigError` without it. |
| `tokenProvider` | `?callable(): ?string` | none | none. Runs before every request. A non-empty return value is sent as `Authorization: Bearer` and wins over `apiKey`. |
| `httpClient` | `?Psr\Http\Client\ClientInterface` | none | discovered |
| `requestFactory` | `?Psr\Http\Message\RequestFactoryInterface` | none | discovered |
| `streamFactory` | `?Psr\Http\Message\StreamFactoryInterface` | none | discovered |

The environment lookup uses `getenv()`, then `$_ENV`, then `$_SERVER`. An empty string counts as
not set.

Public members: the read-only properties `baseUrl`, `orgId`, `auth`, `permissions`, `zanzibar`,
`abac`, `agents`, `approvals`, `jit`, `mcp`, `delegation`; the methods `http()` and `api()`; the
constants `LumoAuth::DEFAULT_BASE_URL` and `LumoAuth::VERSION`.

When `tokenProvider` returns `null` or an empty string and an API key is configured, the request
goes out with the API key. A check without a subject is then about the user who created the key.
Make the provider throw when there is no token if the client must only act as the user.

## Credentials

| Credential | How to pass it | What it can call |
|---|---|---|
| Organization API key (`lmk_...`) | `apiKey:` or `LUMOAUTH_API_KEY` | Permission checks, Zanzibar checks and the Admin API, limited by the key's scopes. Not accepted on ABAC, agent, approval or JIT calls. |
| User access token | `tokenProvider:` | Calls for the signed-in user. Some calls need a scope; see the next table. |
| Agent access token or agent API key (`agk_...`) | `tokenProvider:` | The `agents`, `approvals` and `jit` calls, permission checks and Zanzibar checks, limited by the agent's capabilities. |

The token calls of `auth` (`exchangeCode`, `refreshToken`, `clientCredentials`, `tokenExchange`,
`revoke`) authenticate with the client ID and secret in the form body. They never send the API
key or the provider's token.

## Scopes that a user access token needs

| Call | Scope |
|---|---|
| `permissions->list()`, `permissions->listSlugs()` | `authz:read` |
| ABAC checks and attribute reads | `abac:read` |
| ABAC attribute writes | `abac:write` |
| `jit->pending()` | `jit:approve` |
| `agents->register()` | `admin:agents:write` |
| Permission checks, Zanzibar `check`, `agents->ask()`, `agents->me()`, `auth->userinfo()` | none beyond `openid` |

A check about another user or agent (`userId:`, `agentId:`, or a Zanzibar subject that is not
the caller) needs the `authz:check` scope or the `authz.check` permission. An organization API
key can hold `authz:check`. It cannot hold `authz:read`.

## Namespaces

`$context`, where present, is `?array<string, mixed>`.

### `$lumo->auth`

| Method | Returns |
|---|---|
| `authorizationUrl(string $clientId, string $redirectUri, string $scope = 'openid profile email', ?string $state = null, string $responseType = 'code', ?string $codeChallenge = null, ?string $codeChallengeMethod = null, ?string $prompt = null, ?string $accessType = null, ?array $extra = null)` | `string`. The method is `S256` when a challenge is given and no method is named. `$extra` adds query parameters such as `login_hint`. |
| `exchangeCode(string $code, string $redirectUri, string $clientId, ?string $clientSecret = null, ?string $codeVerifier = null)` | `array` token response |
| `refreshToken(string $refreshToken, string $clientId, ?string $clientSecret = null, ?array $scopes = null)` | `array` token response |
| `clientCredentials(string $clientId, string $clientSecret, ?array $scopes = null)` | `array` token response |
| `tokenExchange(string $subjectToken, ?string $actorToken = null, ?string $audience = null, ?array $scopes = null, string $subjectTokenType = Auth::ACCESS_TOKEN_TYPE, string $actorTokenType = Auth::ACCESS_TOKEN_TYPE, ?string $resource = null)` | `array` token response. `$resource` becomes the token's `aud`; `$audience` does not. |
| `revoke(string $token, ?string $tokenTypeHint = null, ?string $clientId = null, ?string $clientSecret = null)` | `mixed` |
| `userinfo(?string $accessToken = null)` | `array` of claims. Without an argument it uses the client's own credential. |

Constants on `LumoAuth\Resource\Auth`: `TOKEN_EXCHANGE_GRANT`, `ACCESS_TOKEN_TYPE`,
`JWT_TOKEN_TYPE`, `ID_TOKEN_TYPE`, `REFRESH_TOKEN_TYPE`.

The namespace has no helper for PKCE values, for the logout URL or for ID token validation.
Create the verifier and challenge as shown in `SKILL.md`. For logout see
`references/session-lifecycle.md` in this skill.

### `$lumo->permissions` (RBAC)

The organization comes from the credential, so `orgId` is not needed.

| Method | Returns |
|---|---|
| `check(string $permission, ?array $context = null, ?string $userId = null, ?string $agentId = null)` | `bool` |
| `checkDetailed(...)` (same arguments) | `array` with `allowed` and details |
| `checkAny(array $permissions, ?array $context = null, ?string $userId = null, ?string $agentId = null)` | `bool` |
| `checkAll(...)` (same arguments as `checkAny`) | `bool` |
| `checkAnyDetailed(...)`, `checkAllDetailed(...)` | `array` |
| `checkBulk(array $permissions, ?array $context = null, ?string $userId = null, ?string $agentId = null)` | `array`, one decision per permission |
| `list()` | `array` |
| `listSlugs()` | `list<string>` |

`userId:` is the LumoAuth user ID (the `sub` claim, a UUID). `agentId:` is an `agt_...` ID. Pass
one of them, not both. An empty permission list throws `LumoAuthValidationError`.

```php
$canEdit = $lumo->permissions->check('document.edit', userId: $sub);
$either  = $lumo->permissions->checkAny(['billing.manage', 'settings.manage'], userId: $sub);
$both    = $lumo->permissions->checkAll(['document.view', 'document.edit'], userId: $sub);
```

### `$lumo->zanzibar` (relationships)

Objects and subjects are `namespace:id` strings. A subject may also be `namespace:id#relation`.

| Method | Returns |
|---|---|
| `check(string $object, string $relation, string $subject)` | `bool` |
| `checkDetailed(string $object, string $relation, string $subject)` | `array` |
| `isViewer`, `isEditor`, `isOwner`, `isMember`, `isAdmin` `(string $object, string $subject)` | `bool`; `check()` with that relation |
| `expand(string $object, string $relation)` | `array`, the root node of the subject tree. Needs `authz:check` or `authz.check`. |

```php
$canView = $lumo->zanzibar->check('document:readme', 'viewer', 'user:' . $sub);
```

### `$lumo->abac` (attributes and policies)

Needs `orgId` and a user access token or an agent credential.

| Method | Returns |
|---|---|
| `check(string $resourceType, string $action, ?string $resourceId = null, ?array $context = null)` | `array` decision (`allowed`, `reason`, `matchedPolicies`, ...) |
| `isAllowed(...)` (same arguments) | `bool` |
| `checkBulk(array $requests, ?array $environment = null)` | `array` with `results`. At most 100 entries. |
| `myAttributes()` | `array` |
| `resourceAttributes(string $resourceType, string $resourceId)` | `array` |
| `attributeDefinitions(?string $type = null)` | `list<array>`; `$type` is `user`, `resource` or `environment` |
| `setUserAttribute(string $userId, string $attributeSlug, mixed $value)` | `mixed` |
| `setResourceAttribute(string $resourceType, string $resourceId, string $attributeSlug, mixed $value)` | `mixed` |

The SDK sends `$context` as the policy `environment`. The server sets `ip`, `userAgent`,
`requestMethod` and `requestPath` from the request that it received, which comes from the PHP
server. Values passed under those names are kept under `pep`. To make a policy depend on the end
user's IP address, pass `['pep' => ['ip' => $clientIp]]` and write the policy against `pep.ip`.
A bulk call uses one environment for every entry: pass it as the second argument.

### Agent, approval, JIT, delegation and MCP namespaces

The PHP SDK has no separate agent class. Create a client whose `tokenProvider` returns the
agent's token (from `auth->clientCredentials()`) or the agent API key.

| Namespace | Methods | Skill with the full flow |
|---|---|---|
| `agents` | `ask(string $action, ?array $context = null): array`, `isAllowed(...): bool`, `me(): array`, `info(): array`, `capabilities(): list<string>`, `budget(): array`, `reportUsage(int $tokens = 0, float $costUsd = 0.0): array`, `register(string $name, string $clientId, ?string $description = null, ?array $capabilities = null, ?string $jwksUri = null): array`, `authorizeMcpTool(string $serverId, string $tool): AgentMcpToolDecision` | `lumoauth-agent-identity` |
| `approvals` | `create(string $taskId, string $reason, string $onBehalfOf, string $impact = 'medium', ?array $meta = null): array`, `status(string $token): array`, `wait(string $token, float $pollIntervalS = 1.5, float $timeoutS = 90.0): array`, `require(string $taskId, string $reason, string $onBehalfOf, string $impact = 'medium', ?array $meta = null, float $pollIntervalS = 1.5, float $timeoutS = 90.0): ApprovalResult` | `lumoauth-agent-approvals` |
| `jit` | `createTask(?string $name = null, ?string $taskType = null, ?string $onBehalfOf = null): array`, `request(string $taskId, array $authorizationDetails, ?string $justification = null, int $ttl = 300): array`, `status(string $requestId): array`, `token(string $requestId): array`, `completeTask(string $taskId): mixed`, `evaluateTask(string $taskId, string $result = 'completed', ?string $notes = null): array`, `pending(): list<array>` | `lumoauth-agent-approvals` |
| `delegation` | `consentUrl(string $clientId, string $redirectUri, ?array $scopes = null, ?string $state = null): string`, `exchangeCode(...)`, `refreshUserToken(...)`, `exchange(string $subjectToken, string $actorToken, ?array $scopes = null, ?string $resource = null): array`, `revoke(...)`, static `parseActorChain(string $token): list<string>`, static `subject(string $token): ?string` | `lumoauth-agent-delegation` |
| `mcp` | `getToken(string $serverId, ?string $subjectToken = null): string`, `authorizeTool(string $serverId, string $subjectType, string $subjectId, string $tool): McpToolDecision` | `lumoauth-mcp-client`, `lumoauth-mcp-server` |

Facts that the source states:

- `approvals->require()` returns an `ApprovalResult` (`status`, `token`, `taskId`, `impact`,
  `reason`, `respondedAt`, `approvedBy`, `isApproved()`). A denial is a result, not an exception.
  It throws `LumoAuthApprovalNotDeliveredError` when no push prompt was sent.
- `approvals` accepts `impact` values `low`, `medium`, `high` and `critical`.
- `jit->request()` caps `$ttl` at `Jit::MAX_TTL` (900 seconds).
- `Delegation::parseActorChain()` and `Delegation::subject()` decode a JWT without checking its
  signature. Use them for display and logging, never for an access decision.
- `mcp->getToken()` takes the MCP server's URL (for example `https://mcp.example.com/mcp`) and
  sends it as `resource`. It does not send a DPoP proof.
- `mcp->authorizeTool()` and `agents->authorizeMcpTool()` take the registered server ID
  (`mcp_...`). A deny decision is returned with `allowed` set to `false`; it is not thrown.
  An MCP server calls `authorizeTool()` with its own client credentials token (scope
  `mcp:authorize`). It never forwards the caller's token.
- AAuth lives outside the namespaces, in `LumoAuth\AAuth\AAuthClient` and `LumoAuth\AAuth\Signer`.
  Use `lumoauth-aauth`.

## Errors

All classes are in `LumoAuth\Error`. Every one extends `LumoAuthError`, which extends
`\RuntimeException` and has the public read-only properties `errorCode` and `statusCode`.

| Class | Default `errorCode` | When | Extra properties |
|---|---|---|---|
| `LumoAuthApiError` | `API_ERROR` | Any error status without a class of its own (400, 409, 5xx, ...) | `body` (decoded JSON or raw text) |
| `LumoAuthAuthenticationError` | `AUTHENTICATION_ERROR` | 401 | `body` |
| `LumoAuthPermissionDeniedError` | `PERMISSION_DENIED` | 403 | `body`, `requiredScopes` (list; empty unless the server names missing scopes) |
| `LumoAuthNotFoundError` | `NOT_FOUND` | 404 | `body` |
| `LumoAuthRateLimitError` | `RATE_LIMITED` | 429 | `body`, `retryAfter` (seconds, or `null`) |
| `LumoAuthValidationError` | `VALIDATION_ERROR` | Bad input, thrown before any request | `issues` |
| `LumoAuthConfigError` | `CONFIG_ERROR` | Missing `orgId`, unknown route, missing `ext-sodium`, missing generated client | |
| `LumoAuthNetworkError` | `NETWORK_ERROR` | No response (DNS, TLS, timeout). The PSR-18 exception is `getPrevious()`. | |
| `LumoAuthApprovalNotDeliveredError` | `APPROVAL_NOT_DELIVERED` | `approvals` sent no push prompt | `reason` (`email_fallback_sent` or `no_enrolled_device`), `taskId`, `body` |

The four subclasses in rows 2 to 5 extend `LumoAuthApiError`. `LumoAuthApprovalDeniedError`,
`LumoAuthApprovalTimeoutError` and `LumoAuthBudgetExceededError` exist in the package, but the
PHP SDK does not throw them.

When the response body has a string `code` or `error` field, `errorCode` takes that value. A
token endpoint failure therefore has `errorCode` values such as `invalid_grant`. The exception
message is the first of `error_description`, `message`, `detail` and `error` in the body. Catch
the class, then read `errorCode` when the code matters.

## Transport

`$lumo->http()` returns `LumoAuth\Http\HttpClient`.

| Method | Use |
|---|---|
| `request(string $method, string $pathOrUrl, ?array $json = null, ?array $form = null, array $query = [], array $headers = [], bool $auth = true, bool $raw = false, ?string $rawBody = null): mixed` | Send a request to a path on the base URL or to a full URL. Returns decoded JSON, or `null` for 204 and empty bodies. With `raw: true` it returns the PSR-7 response and skips the error mapping. |
| `orgPath(string $path): string` | `/orgs/{orgId}/api/v1` + `$path` |
| `call(string $route, array $pathParams = [], ?array $json = null, ?array $form = null, array $query = [], array $headers = [], bool $auth = true): mixed` | Call a route constant from `LumoAuth\Routes` |
| `route(string $route, array $pathParams = []): array` | `[method, path]` for a route constant, with `{orgId}` filled in |
| `baseUrl()`, `orgId()`, `apiKey()`, `currentToken()` | The configured values |

An `Authorization` or `X-API-Key` header that is passed in `headers:` wins over the client's
credential. `auth: false` sends no credential.

```php
<?php

use LumoAuth\LumoAuth;

$lumo = new LumoAuth(); // LUMOAUTH_URL, LUMOAUTH_ORG_ID, LUMOAUTH_API_KEY
$http = $lumo->http();

$users = $http->request('GET', $http->orgPath('/admin/users'));
```

### A client with timeouts

Guzzle waits without limit by default. Pass a configured client and the PSR-17 factories:

```php
<?php

use GuzzleHttp\Client;
use GuzzleHttp\Psr7\HttpFactory;
use LumoAuth\LumoAuth;

$factory = new HttpFactory();

$lumo = new LumoAuth(
    httpClient: new Client(['timeout' => 5, 'connect_timeout' => 2]),
    requestFactory: $factory,
    streamFactory: $factory,
);
```

Any PSR-18 client works in the same way, for example Symfony HttpClient's `Psr18Client`.

## Generated client for the full REST API

`$lumo->api()` returns a `LumoAuth\ApiClient\Configuration` that carries the base URL and the
client's credential. It needs the package `lumoauth/api-client`; without it the method throws
`LumoAuthConfigError`.

```bash
composer require lumoauth/api-client
```

```php
<?php

use LumoAuth\ApiClient\Api\AdminUsersApi;
use LumoAuth\LumoAuth;

$lumo = new LumoAuth();
$users = new AdminUsersApi(null, $lumo->api());
```

Use `lumoauth-admin-api` for the operations, pagination and API key scopes.
