# `@lumoauth/backend` reference

Checked against `@lumoauth/backend` 1.4.0 and `@lumoauth/shared`. Read this page before you call a method that `SKILL.md` does not show.

## Constructor

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const lumo = new LumoAuthBackend({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  secretKey: process.env.LUMOAUTH_API_KEY!,
});
```

| Option | Type | Required | Meaning |
|---|---|---|---|
| `baseUrl` | `string` | yes | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `secretKey` | `string \| (() => string \| Promise<string>)` | yes | The credential. A value that starts with `lmk_` is sent in the `X-API-Key` header. Any other value is sent as `Authorization: Bearer`. A function is called before each request, so it can read a secrets manager or return a renewed token |
| `orgId` | `string` | for organization-scoped calls | Organization slug. `auth`, `abac`, `agents`, `approvals`, `jit`, `mcp` and `delegation` need it. `permissions` and `zanzibar` do not: LumoAuth takes the organization from the credential |
| `clientId` | `string` | for `auth` flows and `delegation` | OAuth client ID. `auth.getUserInfo()` does not need it |
| `clientSecret` | `string` | for `delegation` | OAuth client secret for the consent-code exchange and revocation |
| `redirectUri` | `string` | for `delegation` | Callback URL of the delegation consent flow |
| `timeout` | `number` | no | Timeout in milliseconds for namespace calls. Default 30,000 |
| `fetch` | `typeof fetch` | no | Custom `fetch` |
| `headers` | `Record<string, string>` | no | Extra headers on every namespace request |
| `cache` | `boolean \| { ttl?: number; maxSize?: number }` | no | Cache for `permissions.check()`. Default: on, `ttl` 300,000 ms, `maxSize` 1,000. `false` turns it off |

The constructor throws `LumoAuthConfigError` when `baseUrl` or `secretKey` is missing, and when it runs in a browser. It reads no environment variables.

The package re-exports everything from `@lumoauth/shared`. One import gives the client, the error classes and the types:

```ts
import { LumoAuthBackend, LumoAuthPermissionDeniedError, type UserInfo } from '@lumoauth/backend';
```

## The guard helper

`src/guard.ts` exports one function:

```ts
import { assertServerOnly } from '@lumoauth/backend';

assertServerOnly('billing/server.ts');
```

`assertServerOnly(what: string): void` throws `LumoAuthConfigError` when `window.document` exists, that is, when the code runs in a real browser. `what` is the name that the error message shows. It passes in Node.js, in workers and in edge runtimes. The `LumoAuthBackend` constructor calls it for you. Call it yourself at the top of a module that holds other server secrets, so that a wrong import into browser code fails at once.

## `lumo.permissions` (RBAC)

Subject argument for every check: `{ userId?: string; agentId?: string }`. Leave it out to check the principal behind the credential. `userId` is a LumoAuth user ID (the `sub` claim). `agentId` is an agent ID (`agt_...`). Passing both throws `LumoAuthValidationError`. Naming a subject other than the caller needs the `authz:check` scope on the credential, or the `authz.check` permission.

| Method | Returns | Notes |
|---|---|---|
| `check(permission, context?, subject?)` | `Promise<boolean>` | Cached |
| `checkDetailed(permission, context?, subject?)` | `Promise<{ allowed, permission, subject_type?, subject_id?, ... }>` | Not cached |
| `checkBulk(permissions, context?, subject?)` | `Promise<{ results: Record<string, boolean>, ... }>` | Fills the cache for each slug |
| `checkAny(permissions, context?, subject?)` | `Promise<boolean>` | True when at least one is held |
| `checkAll(permissions, context?, subject?)` | `Promise<boolean>` | True when every one is held |
| `checkAnyDetailed(...)`, `checkAllDetailed(...)` | `Promise<{ allowed, permissions, ... }>` | |
| `list()` | `Promise<{ user_id, permissions: { slug, description, source }[], count }>` | Needs a user access token with the `authz:read` scope. Fails with an API key |
| `listSlugs()` | `Promise<Set<string>>` | Same requirement as `list()` |
| `clearCache()` | `void` | Also available as `lumo.clearCache()` |

`context` is an optional `Record<string, unknown>` with attributes for the decision.

## `lumo.zanzibar` (ReBAC)

`object` has the form `namespace:id`. `subject` has the form `namespace:id` or `namespace:id#relation`.

| Method | Returns | Notes |
|---|---|---|
| `check({ object, relation, subject })` | `Promise<boolean>` | True when the relation exists directly or through inheritance |
| `checkDetailed({ object, relation, subject })` | `Promise<{ allowed, object, relation, subject? }>` | |
| `expand({ object, relation })` | `Promise<ZanzibarUsersetNode>` | The tree of subjects that have the relation. Always needs `authz:check` or `authz.check` |
| `isViewer(object, subject)`, `isEditor(...)`, `isOwner(...)`, `isMember(...)`, `isAdmin(...)` | `Promise<boolean>` | Shortcuts for the relations `viewer`, `editor`, `owner`, `member`, `admin` |

A check about the caller itself (`user:{own id}`) needs no extra privilege. A check about anyone else needs `authz:check` or `authz.check`; otherwise LumoAuth answers `403` with the code `INSUFFICIENT_PERMISSIONS`.

## `lumo.abac` (ABAC)

Needs `orgId`. Needs a user access token with `abac:read` (checks and reads) or `abac:write` (writes), or an agent credential. API keys are rejected.

| Method | Returns |
|---|---|
| `check({ resourceType, action, resourceId?, context? })` | `Promise<{ allowed, reason?, matchedPolicies?, ... }>` |
| `isAllowed(resourceType, action, resourceId?, context?)` | `Promise<boolean>` |
| `checkBulk({ checks: [{ resourceType, action, resourceId? }], context? })` | `Promise<{ results: [...] }>`. At most 100 checks. One `context` applies to all of them |
| `getMyAttributes()` | The caller's attributes |
| `setUserAttribute(userId, attributeSlug, value)` | `Promise<void>` |
| `getResourceAttributes(resourceType, resourceId)` | The resource's attributes |
| `setResourceAttribute(resourceType, resourceId, attributeSlug, value)` | `Promise<void>` |
| `getAttributeDefinitions(type?)` | `type` is `'user'`, `'resource'` or `'environment'` |

`context` holds environment attributes. The SDK sends it as the request's `environment`.

## `lumo.auth` (OAuth 2.0)

Needs `orgId`. These calls do not send `secretKey`; they authenticate with the values that you pass.

| Method | Purpose |
|---|---|
| `getUserInfo(accessToken)` | Calls the UserInfo endpoint. Returns `{ sub, email?, email_verified?, name?, given_name?, family_name?, picture?, ... }`. Throws `LumoAuthApiError` with the code `USERINFO_ERROR` and the HTTP status when LumoAuth refuses the token |
| `buildAuthorizationUrl({ redirectUri, scope?, extraParams? })` | Returns `{ url, codeVerifier, state }` for the authorization code flow with PKCE. Needs `clientId` |
| `exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientSecret? })` | Exchanges the code for tokens |
| `refreshToken(refreshToken, { clientSecret? })` | Refresh grant |
| `revokeToken(token, accessToken?, { clientSecret?, tokenTypeHint? })` | Revocation. Errors are ignored |
| `buildEndSessionUrl({ idTokenHint?, postLogoutRedirectUri?, state? })` | URL of the end-session endpoint |

For a server-side sign-in flow in Express use `lumoauth-express`, which wraps these calls.

## Agent namespaces

`agents`, `approvals`, `jit`, `delegation` and `mcp` exist on `LumoAuthBackend`, but they accept agent credentials, and LumoAuth rejects organization API keys on them. Agent code normally uses `@lumoauth/agent`, which obtains and renews the agent's token.

| Namespace | Methods | Skill |
|---|---|---|
| `agents` | `ask`, `isAllowed`, `me`, `getCurrentAgent`, `capabilities`, `budget`, `reportUsage`, `authorizeMcpTool`, `register` | `lumoauth-agent-identity` |
| `approvals` | `create`, `require`, `getStatus`, `wait` | `lumoauth-agent-approvals` |
| `jit` | `createTask`, `completeTask`, `evaluateTask`, `requestPermission`, `getRequestStatus`, `getToken`, `listPendingRequests` | `lumoauth-agent-approvals` |
| `delegation` | `getConsentUrl`, `handleConsentCallback`, `setUserToken`, `exchange`, `request`, `delegateToSubAgent`, `revoke`, `revokeAll`, `hasDelegation` | `lumoauth-agent-delegation` |
| `mcp` | `getToken`, `getTokenDetailed`, `authorizeTool` | `lumoauth-mcp-server`, `lumoauth-mcp-client` |

`lumo.agent` is a deprecated alias of `lumo.agents`.

## `lumo.api`

`lumo.api` loads the generated client `@lumoauth/api-client` on first use and returns `{ module, configuration, create(ApiClass) }`. See [admin-api-and-m2m.md](admin-api-and-m2m.md).

## The permission cache

- Only `permissions.check()` reads the cache. `checkBulk()` writes to it.
- The key includes the subject, the permission and the context, so answers for different users do not mix inside one client.
- The cache is in memory and per client object. A client that is created for each request starts empty.
- Default lifetime 5 minutes. After the app changes a user's roles, call `lumo.permissions.clearCache()`, or use a short `ttl`.

## Errors

| Class | When | Extra fields |
|---|---|---|
| `LumoAuthError` | Base class | `code`, `statusCode?`, `cause?` |
| `LumoAuthApiError` | Any `4xx` or `5xx` answer without a more specific class | `statusCode`, `body`, `code` (the `code` field of the answer, or `API_ERROR`) |
| `LumoAuthAuthenticationError` | `401` | `code` is `AUTHENTICATION_ERROR` |
| `LumoAuthPermissionDeniedError` | `403` | `code` is `PERMISSION_DENIED`; `requiredScopes: string[]` holds the scopes that LumoAuth named, or `[]` |
| `LumoAuthNotFoundError` | `404` | `code` is `NOT_FOUND` |
| `LumoAuthRateLimitError` | `429` | `retryAfter?: number` in seconds, from the `Retry-After` header |
| `LumoAuthValidationError` | The answer does not have the expected shape, or both `userId` and `agentId` were passed | `issues` |
| `LumoAuthConfigError` | Missing option, browser use, or `lumo.api` without the generated client | |
| `LumoAuthNetworkError` | No answer: DNS, TLS, connection or timeout | `cause` |
| `LumoAuthApprovalDeniedError`, `LumoAuthApprovalTimeoutError`, `LumoAuthApprovalNotDeliveredError`, `LumoAuthBudgetExceededError` | Agent calls only | |

For `401`, `403`, `404` and `429` the error's `code` is the class constant. The code that LumoAuth sent, such as `INSUFFICIENT_PERMISSIONS` or `SUBJECT_NOT_FOUND`, is in `err.body`.

Invalid arguments, for example an `object` without a colon in `zanzibar.check()` or an empty permission slug, fail before any request with a `ZodError` from the `zod` package.

```ts
import {
  LumoAuthBackend,
  LumoAuthPermissionDeniedError,
  LumoAuthRateLimitError,
} from '@lumoauth/backend';

export async function listOwnPermissions(lumo: LumoAuthBackend): Promise<string[]> {
  try {
    return [...(await lumo.permissions.listSlugs())];
  } catch (err) {
    if (err instanceof LumoAuthPermissionDeniedError && err.requiredScopes.length > 0) {
      throw new Error(`The access token lacks these scopes: ${err.requiredScopes.join(', ')}`);
    }
    if (err instanceof LumoAuthRateLimitError) {
      throw new Error(`Rate limited. Retry in ${err.retryAfter ?? 1} seconds.`);
    }
    throw err;
  }
}
```
