# `@lumoauth/express`: options, routes and responses

Everything on this page comes from the package source (`@lumoauth/express` 1.4.0). Read it when you change a default, debug a response of the sign-in routes, or need to know what the session holds.

## Exports

| Export | Kind | Purpose |
|---|---|---|
| `lumoAuthMiddleware(options)` | function | Adds the three sign-in routes and sets `req.user` |
| `requireAuth(options?)` | function | Route guard |
| `LumoAuthBackend` | class | The server client from `@lumoauth/backend`, re-exported |
| `LumoAuthError`, `LumoAuthApiError`, `LumoAuthAuthenticationError`, `LumoAuthPermissionDeniedError`, `LumoAuthNotFoundError`, `LumoAuthRateLimitError`, `LumoAuthValidationError`, `LumoAuthConfigError`, `LumoAuthNetworkError`, `LumoAuthApprovalDeniedError`, `LumoAuthApprovalTimeoutError`, `LumoAuthApprovalNotDeliveredError`, `LumoAuthBudgetExceededError` | classes | The SDK error classes, re-exported |
| `LumoAuthMiddlewareOptions`, `RequireAuthOptions`, `SessionUser`, `LumoAuthRequestHandler`, `LumoAuthBackendConfig` | types | |

`LumoAuthAuthError` is also exported. It is a deprecated alias of `LumoAuthAuthenticationError`.

## `lumoAuthMiddleware(options)`

Call it once and pass the result to `app.use()`. It must run after `express-session`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `string` | required | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `organization` | `string` | required | Organization slug that owns the OAuth application |
| `clientId` | `string` | required | Client ID of the OAuth application |
| `clientSecret` | `string` | none | Secret of a confidential client. It is sent in the body of the token, refresh and revocation requests. Leave it out for a public client, which relies on PKCE alone |
| `prefix` | `string` | `'/auth'` | Path under which the three routes are mounted. Trailing slashes are removed |
| `postLoginRedirect` | `string` | `'/'` | Where the browser goes after sign-in when the login request had no valid `return_to` |
| `postLogoutRedirect` | `string` | `'/'` | Where the browser goes after sign-out. An absolute `http(s)` URL that is registered as a post-logout redirect URI also ends the LumoAuth session. A relative path only ends the local session |
| `autoRefresh` | `boolean` | `true` | Refresh the access token when it expires in less than 60 seconds and the session holds a refresh token |
| `endSessionOnLogout` | `boolean` | `true` | On sign-out, revoke the refresh token and redirect through the LumoAuth end-session endpoint. `false` only clears the local session |
| `scope` | `string` | `'openid profile email'` | Space-separated scopes to request. The OAuth application must allow each one |
| `fetch` | `typeof fetch` | global `fetch` | Custom `fetch`, for tests or an outbound proxy |

The middleware reads nothing from the environment.

A changed `prefix` changes the redirect URI. With `prefix: '/account'` the routes are `/account/login`, `/account/callback` and `/account/logout`, and the URI to register is `{origin}/account/callback`.

## What each route does

| Request | Behaviour |
|---|---|
| `GET {prefix}/login` | Creates a PKCE verifier, an S256 challenge and a random `state`. Stores the verifier, the `state`, the redirect URI and the return path in the session. Redirects to `{baseUrl}/orgs/{organization}/api/v1/oauth/authorize`. The optional query parameter `return_to` is accepted only when it starts with `/` and not with `//`; otherwise `postLoginRedirect` is used |
| `GET {prefix}/callback` | Compares `state` with the stored value. Exchanges the code at the token endpoint with the PKCE verifier (and `client_secret` when set). Loads the profile from the UserInfo endpoint. Stores the tokens and the profile in the session and redirects to the return path |
| `GET` or `POST {prefix}/logout` | Removes the LumoAuth data from the session. Other session data stays. Then revokes the token and redirects as described under [Sign-out](#sign-out) |
| Any other request | Refreshes the access token when needed, sets `req.user` from the session, calls `next()` |

The redirect URI is built from the request: `{req.protocol}://{Host header}{prefix}/callback`. It must equal a redirect URI that is registered on the OAuth application.

Sign-out keeps the data that the app itself stored in the session. To remove that too, call `req.session.destroy()` in the handler of the page that `postLogoutRedirect` points to. Do not destroy the session before `{prefix}/logout` runs: the route needs the stored tokens for revocation and for the end-session redirect.

## `req.user`

`req.user` is the profile that the UserInfo endpoint returned at sign-in. It is stored in the session and is not loaded again on later requests. The package adds the type to Express's `Request`:

```ts
interface SessionUser {
  sub: string;              // the LumoAuth user ID
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  [key: string]: unknown;   // any other UserInfo claim
}
```

Which claims are present depends on the scopes that were granted: `profile` gives the name claims and `email` gives `email` and `email_verified`. A profile change in LumoAuth reaches `req.user` at the next sign-in.

## `requireAuth(options?)`

| Option | Type | Behaviour |
|---|---|---|
| (none) | | `401` with `{ "error": "unauthenticated" }` when `req.user` is not set |
| `scopes` | `string[]` | Each scope must be in the `scope` value that the token endpoint returned at sign-in (or at the last refresh). Otherwise `403` with `{ "error": "insufficient_scope", "error_description": "Missing: ..." }` |
| `authorize` | `(user, req) => boolean \| Promise<boolean>` | Runs after the scope check. `false` answers `403` with `{ "error": "forbidden" }` |
| `unauthorizedStatus` | `number` | Replaces the status code of all three answers above |

The guard answers with JSON. For a page, redirect instead:

```ts
import type { Request, Response, NextFunction } from 'express';

export function requireSignIn(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  res.redirect(`/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`);
}
```

An `authorize` hook that throws is not caught by the guard. Catch errors inside the hook and return `false`.

## Error responses of the sign-in routes

All are JSON with `error` and `error_description`.

| Status | `error` | Cause |
|---|---|---|
| `500` | `session_middleware_missing` | `req.session` does not exist. `express-session` is not mounted before the middleware. This answer is sent for every request, not only for the sign-in routes |
| `400` | `invalid_request` | The callback has no `code` or no `state` (`Missing code or state`), or the session holds no sign-in in progress (`No login in progress`) |
| `400` | `invalid_state` | The `state` in the callback differs from the stored value |
| `400` | the error from LumoAuth, for example `access_denied` | LumoAuth sent `error` to the callback |
| LumoAuth's status, or `502` | `token_exchange_failed` | The code exchange or the UserInfo request failed |

## What the session holds

The middleware keeps its data under one key, `req.session.__lumoAuth`:

| Field | Content |
|---|---|
| `flow` | `codeVerifier`, `state`, `redirectUri`, `returnTo`. Present only between login and callback |
| `tokens` | `access_token`, `refresh_token` (when issued), `id_token` (when issued), `token_type`, `expires_at` (epoch seconds), `scope` |
| `user` | The `SessionUser` profile |

The tokens stay in the session store on the server. The browser receives only the session cookie. Never copy them into a page, a log line or an error response.

## Token refresh

Before a request reaches the handlers, the middleware checks `tokens.expires_at`. When the access token expires in less than 60 seconds and a refresh token is stored, it calls the token endpoint with `grant_type=refresh_token` and saves the new tokens. When LumoAuth returns no new refresh token, the old one is kept. Parallel requests in one process share one refresh call for the same refresh token.

When the refresh fails, the middleware removes `user` and `tokens` from the session. The request continues as signed out, so `requireAuth()` answers `401`.

A refresh token is issued when the OAuth application has the `refresh_token` grant type. The `offline_access` scope has no effect on that. Without a refresh token the local session lasts as long as the session cookie; the middleware does not sign the user out when the access token expires.

Set `autoRefresh: false` to turn the refresh off.

## Sign-out

`{prefix}/logout` does this, in order:

1. Deletes `user`, `tokens` and `flow` from the session and clears `req.user`.
2. With `endSessionOnLogout: false`: redirects to `postLogoutRedirect`. Nothing else happens.
3. Otherwise revokes the refresh token at the revocation endpoint (the access token when there is no refresh token). A failure is ignored, so sign-out always completes.
4. When `postLogoutRedirect` is a relative path: redirects to it. The LumoAuth session stays open, and the next `/auth/login` can return without showing the login page.
5. When `postLogoutRedirect` is an absolute URL: redirects to `{baseUrl}/orgs/{organization}/api/v1/oauth/logout` with `id_token_hint` and `post_logout_redirect_uri`. LumoAuth ends its session and sends the browser back.

Register the absolute URL on the OAuth application: **Applications → the application → Configuration → Logout → Post-logout redirect URIs**, then **Save configuration**. It follows the same rules as redirect URIs.
