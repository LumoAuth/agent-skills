# @lumoauth/client API for browser apps

Reference for `@lumoauth/client` 1.4.0. The package runs in a browser and needs Node 18 or newer for the build. It re-exports everything from `@lumoauth/shared`, so one import path is enough.

## Contents

- [Three objects](#three-objects)
- [LumoAuth client](#lumoauth-client)
- [AuthModule](#authmodule)
- [LumoAuthSession](#lumoauthsession)
- [Storage adapters](#storage-adapters)
- [Scopes](#scopes)
- [Errors](#errors)
- [Endpoints that the SDK calls](#endpoints-that-the-sdk-calls)

## Three objects

| Object | Job | Needs |
|---|---|---|
| `AuthModule` | OAuth 2.0 calls: authorization URL with PKCE, code exchange, refresh, revoke, UserInfo, logout URL | `baseUrl`, `orgId`, `clientId` |
| `LumoAuthSession` | Stores tokens, refreshes the access token, syncs tabs, exposes a small store | An `AuthModule` and the redirect URI |
| `LumoAuth` | Authorization checks with the user's token: `permissions`, `zanzibar`, `abac` | `baseUrl`, `orgId`, a `token` function |

`new LumoAuth(...)` also creates an `AuthModule` as `client.auth`.

## LumoAuth client

```ts
import { LumoAuth } from '@lumoauth/client';

const lumo = new LumoAuth({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'your-client-id',
  token: async () => (await session.getToken()) ?? '',
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | required | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `orgId` | `string` | none | Organization slug. Required for `abac` and `auth`. |
| `clientId` | `string` | none | OAuth client ID. Required for `auth`. |
| `token` | `string \| (() => string \| Promise<string>)` | none | The user's access token. Use a function so every request gets the current token. |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |
| `fetch` | `typeof fetch` | global `fetch` | Custom implementation, for tests |
| `headers` | `Record<string, string>` | none | Extra headers on every request |
| `cache` | `boolean \| { ttl?: number; maxSize?: number }` | on, 5 minutes, 1000 entries | Cache for `permissions.check` results |

The constructor throws `LumoAuthConfigError` in a browser when `token` is a string that starts with `lmk_`. An organization API key must never reach a browser.

### permissions

| Call | Returns | Notes |
|---|---|---|
| `check(permission, context?)` | `Promise<boolean>` | Cached |
| `checkDetailed(permission, context?)` | `Promise<CheckPermissionResponse>` | Full response |
| `checkBulk(permissions, context?)` | `Promise<{ results: Record<string, boolean> }>` | One request for many slugs |
| `checkAny(permissions, context?)` | `Promise<boolean>` | At least one |
| `checkAll(permissions, context?)` | `Promise<boolean>` | Every one |
| `list()` | `Promise<{ permissions: PermissionObject[] }>` | Needs `authz:read` |
| `listSlugs()` | `Promise<Set<string>>` | Needs `authz:read` |
| `clearCache()` | `void` | Also available as `lumo.clearCache()` |

### zanzibar

| Call | Returns | Notes |
|---|---|---|
| `check({ object, relation, subject })` | `Promise<boolean>` | `object` and `subject` use `namespace:id`, for example `document:doc-123` and `user:{sub}` |
| `checkDetailed({ object, relation, subject })` | `Promise<ZanzibarCheckResponse>` | |
| `isViewer(object, subject)`, `isEditor`, `isOwner`, `isMember`, `isAdmin` | `Promise<boolean>` | Shorthand for `check` with that relation |
| `expand({ object, relation })` | `Promise<ZanzibarUsersetNode>` | Needs `authz:check`. Run it on a server. |

A check about a subject other than the caller needs `authz:check`.

### abac

| Call | Returns | Notes |
|---|---|---|
| `check({ resourceType, action, resourceId?, context? })` | `Promise<{ allowed, reason, matchedPolicies, ... }>` | Needs `abac:read` |
| `isAllowed(resourceType, action, resourceId?, context?)` | `Promise<boolean>` | Needs `abac:read` |
| `checkBulk({ checks, context? })` | `Promise<{ results: [...] }>` | Up to 100 checks. Needs `abac:read`. |
| `getMyAttributes()` | `Promise<AbacUserAttributesResponse>` | Needs `abac:read` |

`context` holds environment values at its top level, for example `{ ip: '203.0.113.1' }`.

## AuthModule

```ts
import { AuthModule } from '@lumoauth/client';

const authModule = new AuthModule({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'your-client-id',
});
```

| Method | Returns | Description |
|---|---|---|
| `buildAuthorizationUrl({ redirectUri, scope?, extraParams? })` | `Promise<{ url, codeVerifier, state }>` | Creates a PKCE verifier, an S256 challenge and a random `state`. Keep `codeVerifier` and `state` until the callback. Default `scope`: `openid profile email`. |
| `exchangeCodeForTokens({ code, codeVerifier, redirectUri })` | `Promise<TokenResponse>` | `redirectUri` must equal the one in the authorization request. Do not pass `clientSecret` from a browser. |
| `refreshToken(refreshToken)` | `Promise<TokenResponse>` | LumoAuth rotates refresh tokens: store the new one, the old one stops working. |
| `revokeToken(token, accessToken?, { tokenTypeHint? })` | `Promise<void>` | Best effort; never throws. Revoking a refresh token also revokes the access tokens that were issued with it. |
| `getUserInfo(accessToken)` | `Promise<UserInfo>` | `sub`, `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture` |
| `buildEndSessionUrl({ idTokenHint?, postLogoutRedirectUri?, state? })` | `string` | URL of the logout endpoint. Navigate to it to end the LumoAuth session. |
| `checkEmailExists(email)` | `Promise<EmailCheckResult>` | Sign-in methods for an address. Never throws; every flag is `false` on failure. |
| `requestMagicLink({ email, redirectUri? })` | `Promise<{ sent: boolean }>` | Requests a sign-in link by email |
| `loginWithPassword({ email, password })` | `Promise<{ status, challengeUrl? }>` | For a custom form. Creates a LumoAuth session and returns no tokens; continue with the PKCE redirect. |

`TokenResponse`: `access_token`, `token_type`, `expires_in`, and when issued `refresh_token`, `id_token`, `scope`.

`extraParams` adds query parameters to the authorization request. Examples: `{ provider: 'google' }` goes straight to a social provider, `{ prompt: 'create' }` opens the sign-up page, `{ login_hint: 'user@example.com' }` fills in the email field.

Do not use `passwordGrant()`. The token endpoint does not offer the password grant.

## LumoAuthSession

```ts
import { AuthModule, LumoAuthSession, localStorageAdapter } from '@lumoauth/client';

const session = new LumoAuthSession({
  auth: authModule,
  redirectUri: `${window.location.origin}/auth/callback`,
  scope: 'openid profile email',
  storage: localStorageAdapter(),
  crossTab: true,
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `auth` | `AuthModule` | required | |
| `redirectUri` | `string` | required | Used by `buildAuthorizationUrl()` |
| `scope` | `string` | `'openid profile email'` | |
| `storage` | `TokenStorage` | `sessionStorage` in a browser | See the next section |
| `crossTab` | `boolean` | `true` | Sends token updates and sign-out to other tabs. One tab does each refresh. |
| `onTokens` | `(tokens: StoredTokens) => void` | none | Called after the tokens change |

| Member | Description |
|---|---|
| `hydrate()` | Loads stored tokens, refreshes an expired access token, sets the state and schedules the next refresh. Call it once at startup. |
| `buildAuthorizationUrl(extraParams?)` | Same as the `AuthModule` method, with the session's redirect URI and scope |
| `adopt(tokenResponse)` | Stores the tokens from a code exchange and marks the session signed in |
| `getToken()` | `Promise<string \| null>`. A valid access token; refreshes first when it expires within 30 seconds. |
| `refresh()` | Refreshes now. Calls at the same time share one request. |
| `getTokens()` | `{ accessToken, refreshToken, idToken, expiresAt }` |
| `clearSession(error?, { broadcast?, emit? })` | Drops the tokens locally and tells other tabs. It does not end the LumoAuth session. |
| `subscribe(listener)` | Calls `listener` after each state change. Returns an unsubscribe function. |
| `getSnapshot()` | `{ status, isLoaded, isSignedIn, error }`. `status` is `'loading'`, `'authenticated'` or `'unauthenticated'`. |
| `dispose()` | Stops the timer and the listeners |

The session refreshes the access token 60 seconds before it expires. When a refresh fails, the session clears itself and `getSnapshot().error` is `'refresh_failed'`. When the session holds no refresh token and the access token expires, the error is `'no_refresh_token'`.

## Storage adapters

| Adapter | Readable by a script on the page | Survives reload | Shared across tabs |
|---|---|---|---|
| `sessionStorageAdapter()` (browser default) | yes | yes, in the same tab | no |
| `localStorageAdapter()` | yes | yes, also after a browser restart | yes |
| `memoryStorageAdapter()` | in memory only | no | no |
| `cookieStorageAdapter({ sessionEndpoint?, logoutEndpoint? })` | no | yes | yes |

`cookieStorageAdapter` needs a server on the app's origin that runs the code exchange and the refresh, keeps the tokens in an httpOnly cookie, and serves a session endpoint (default `/auth/session`, returns `{ accessToken, idToken, expiresAt }`) and a logout endpoint (default `/auth/logout`, called with `POST`).

For another store, implement the `TokenStorage` interface and pass the object as `storage`:

| Member | Signature |
|---|---|
| `name` | `readonly string`, used in diagnostics |
| `get` | `() => StoredTokens \| Promise<StoredTokens>` |
| `set` | `(tokens: StoredTokens) => void \| Promise<void>` |
| `clear` | `() => void \| Promise<void>` |
| `subscribe` (optional) | `(onExternalChange: () => void) => () => void` |

`StoredTokens` is `{ accessToken, refreshToken, idToken, expiresAt }`; each field can be `null`, and `expiresAt` is in epoch milliseconds. The constant `EMPTY_TOKENS` holds four `null` values.

## Scopes

| Call | Scope on the user's token |
|---|---|
| `permissions.check`, `checkBulk`, `checkAny`, `checkAll`; `zanzibar.check` about the caller; `auth.getUserInfo` | none beyond `openid profile email` |
| `permissions.list()`, `permissions.listSlugs()` | `authz:read` |
| `abac.check`, `abac.isAllowed`, `abac.checkBulk`, `abac.getMyAttributes` | `abac:read` |
| `zanzibar.check` about another subject, `zanzibar.expand` | `authz:check` |

To request a scope: add it under **Configuration → Allowed scopes** of the application in the portal, add it to the `scope` option of `LumoAuthSession`, and sign in again.

## Errors

All classes are exported by `@lumoauth/client` and extend `LumoAuthError` (`code`, `statusCode`, `message`).

| Class | When |
|---|---|
| `LumoAuthAuthenticationError` | `401`, or no token is available for a request |
| `LumoAuthPermissionDeniedError` | `403`. `requiredScopes` lists the scopes that the token lacks. |
| `LumoAuthNotFoundError` | `404` |
| `LumoAuthRateLimitError` | `429` |
| `LumoAuthApiError` | Any other error response. The token endpoint reports its `error` value in `code`, for example `invalid_grant`. |
| `LumoAuthNetworkError` | The request did not reach LumoAuth |
| `LumoAuthValidationError` | A response did not match the expected shape |
| `LumoAuthConfigError` | Wrong configuration |

A request with a wrong shape, for example a relationship check without `subject` or with an `object` that is not `namespace:id`, throws a validation error from the schema library before any request is sent.

In interface code, treat every error from a check as "denied".

## Endpoints that the SDK calls

All under `{base}`, with `{slug}` as the organization slug.

| Purpose | Endpoint |
|---|---|
| Authorization | `GET /orgs/{slug}/api/v1/oauth/authorize` |
| Token | `POST /orgs/{slug}/api/v1/oauth/token` |
| Revocation | `POST /orgs/{slug}/api/v1/oauth/revoke` |
| UserInfo | `GET /orgs/{slug}/api/v1/oauth/userinfo` |
| Logout | `GET /orgs/{slug}/api/v1/oauth/logout` |
| Discovery | `GET /orgs/{slug}/api/v1/.well-known/openid-configuration` |
| Permission check | `POST /api/v1/authz/check` (also `check-bulk`, `check-any`, `check-all`) |
| Relationship check | `POST /api/v1/authz/zanzibar/check` |
| Attribute policy check | `POST /orgs/{slug}/api/v1/abac/check` |
