# @lumoauth/nextjs server API

Reference for `@lumoauth/nextjs/server` (package version 1.4.1). The entry is marked `server-only`: a client component that imports it fails the build.

## Contents

- [Exports](#exports)
- [Configuration](#configuration)
- [auth()](#auth)
- [currentUser()](#currentuser)
- [protectPage()](#protectpage)
- [Routes from createRouteHandler()](#routes-from-createroutehandler)
- [The callback URL](#the-callback-url)
- [lumoAuthMiddleware()](#lumoauthmiddleware)
- [Next.js 16: proxy.ts and Cache Components](#nextjs-16-proxyts-and-cache-components)
- [Check permissions on the server](#check-permissions-on-the-server)
- [Request more scopes](#request-more-scopes)
- [Sessions and access tokens](#sessions-and-access-tokens)
- [How the cookie is protected](#how-the-cookie-is-protected)
- [Call another API with the user's token](#call-another-api-with-the-users-token)
- [Production checklist](#production-checklist)

## Exports

| Export | Kind | Description |
|---|---|---|
| `auth(config?)` | async function | Reads the session from the cookie. Returns an `AuthObject`. |
| `currentUser(config?)` | async function | Returns the UserInfo profile, or `null`. |
| `protectPage({ returnTo? })` | async function | Redirects a signed-out visitor to `/api/auth/login`. Otherwise returns the `AuthObject`. |
| `createRouteHandler(config?)` | function | Returns `{ GET, POST }` for `app/api/auth/[...lumoauth]/route.ts`. |
| `lumoAuthMiddleware(options?)` | function | Returns the middleware function: token refresh and route protection. |
| `resolveConfig(overrides?)` | function | Merges overrides with the environment and throws when a required value is missing. |
| `SESSION_COOKIE` | constant | `'lumo_session'` |
| `REFRESHED_SESSION_HEADER` | constant | `'x-lumo-session'` |
| `isSessionLive(session)`, `isTokenStale(session)` | functions | Helpers for custom integrations. |
| `AuthObject`, `MiddlewareOptions`, `LumoAuthNextConfig`, `ServerSession` | types | |

The client entry `@lumoauth/nextjs` exports `LumoAuthNextProvider` and re-exports the components, hooks and types of `@lumoauth/react`.

## Configuration

Every server function accepts an optional config object. A value in the object overrides the environment variable.

| Option | Environment variable | Required | Default | Description |
|---|---|---|---|---|
| `domain` | `NEXT_PUBLIC_LUMOAUTH_DOMAIN` | no | `https://app.lumoauth.dev` | The region. EU: `https://eu.app.lumoauth.dev` |
| `orgId` | `NEXT_PUBLIC_LUMOAUTH_ORG_ID` | yes | none | Organization slug |
| `clientId` | `NEXT_PUBLIC_LUMOAUTH_CLIENT_ID` | yes | none | OAuth client ID |
| `redirectUri` | `NEXT_PUBLIC_REDIRECT_URI` | no | `{origin}/api/auth/callback` of each request | Pins the callback URL and the origin of every redirect back to the app. See [The callback URL](#the-callback-url). |
| `secret` | `LUMOAUTH_SECRET` | yes | none | Encrypts the session cookie. At least 32 characters. |
| `clientSecret` | `LUMOAUTH_CLIENT_SECRET` | no | none | Sent on the code exchange when it is set. A public PKCE client leaves it out. |
| `afterSignInUrl` | none | no | `'/'` | Target after sign-in when the login link has no `return_to` |
| `afterSignOutUrl` | none | no | `'/'` | Target after sign-out. Also the target when the callback fails. |
| `scope` | none | no | `'openid profile email'` | OAuth scopes that the login route requests |
| `sessionMaxAge` | none | no | `2592000` (30 days) | Session lifetime in seconds |

A missing required value throws `@lumoauth/nextjs is missing required config: <variable names>`. An empty variable counts as unset.

When the app sets options in code, pass the same object to every function:

```ts
// lib/lumoauth-config.ts
import type { LumoAuthNextConfig } from '@lumoauth/nextjs/server';

export const lumoAuthConfig: Partial<LumoAuthNextConfig> = {
  afterSignInUrl: '/dashboard',
  afterSignOutUrl: '/',
  scope: 'openid profile email authz:read',
};
```

```ts
// app/api/auth/[...lumoauth]/route.ts
import { createRouteHandler } from '@lumoauth/nextjs/server';
import { lumoAuthConfig } from '@/lib/lumoauth-config';

export const { GET, POST } = createRouteHandler(lumoAuthConfig);
```

```ts
// proxy.ts (Next.js 16+) or middleware.ts (Next.js 14, 15)
import { lumoAuthMiddleware } from '@lumoauth/nextjs/server';
import { lumoAuthConfig } from './lib/lumoauth-config';

export default lumoAuthMiddleware({ ...lumoAuthConfig, protect: ['/dashboard/:path*'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

`afterSignOutUrl` must be a path. The logout route sends `{origin}{afterSignOutUrl}` as `post_logout_redirect_uri`, and LumoAuth redirects there only when that exact URL is a post-logout redirect URI of the application.

`resolveConfig()` returns the merged values, with the default domain filled in. Server code that needs the domain or the organization slug, such as a `LumoAuth` client, reads them from it: `const { domain, orgId } = resolveConfig();`.

## auth()

```ts
import { auth } from '@lumoauth/nextjs/server';

const { isSignedIn, userId, getToken, expiresAt, isStale } = await auth();
```

Works in server components, route handlers and server actions. It reads and decrypts the cookie. It makes no network call.

| Field | Type | Meaning |
|---|---|---|
| `isSignedIn` | `boolean` | The user has a live session. It stays `true` when only the access token has expired and a refresh token exists. |
| `userId` | `string \| null` | The `sub` claim of the access token |
| `getToken()` | `() => string \| null` | The access token. `null` when it is stale and the middleware did not refresh it. |
| `expiresAt` | `number \| null` | Expiry of the access token, in epoch milliseconds |
| `isStale` | `boolean` | The session is live but the access token needs a refresh. This happens only on a route that the middleware does not cover. |

`auth()` never refreshes the token. A server component cannot write cookies, and LumoAuth rotates refresh tokens: a refresh whose result is not stored would end the session on the next request.

`auth()` trusts the cookie because only this package can write it. It does not check the token signature against the keys of LumoAuth. An API that receives the token from another caller must validate it; use `lumoauth-api-protection` for that.

## currentUser()

```ts
import { currentUser } from '@lumoauth/nextjs/server';

const user = await currentUser(); // UserInfo | null
```

Calls `{base}/orgs/{slug}/api/v1/oauth/userinfo` with the access token on every call. Returns `null` when the user is signed out, when the token is stale, or when the request fails. A failed request does not end the session.

`UserInfo` fields: `sub`, `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture`, plus any other claim that the endpoint returns. The fields depend on the granted scopes (`profile`, `email`).

Use `auth()` when the subject is enough.

## protectPage()

```tsx
import { protectPage } from '@lumoauth/nextjs/server';

export default async function SettingsPage() {
  const { userId } = await protectPage({ returnTo: '/settings' });
  return <p>{userId}</p>;
}
```

Redirects a signed-out visitor to `/api/auth/login?return_to=<returnTo>`. The login path is fixed, so the route handler must be mounted at `app/api/auth/[...lumoauth]/route.ts`. `protectPage()` reads its configuration from the environment only.

## Routes from createRouteHandler()

| Route | Method | What it does |
|---|---|---|
| `/api/auth/login` | GET | Creates the PKCE verifier and `state`, stores them in the encrypted cookie `lumo_pkce` for 10 minutes, and redirects to the authorization endpoint with `code_challenge_method=S256`. Accepts `?return_to=/path`. A value that is not a same-site path is ignored. |
| `/api/auth/callback` | GET | Compares `state` with the stored value, exchanges the code, stores the session in `lumo_session`, and redirects to `return_to`. On any failure it redirects to `afterSignOutUrl`. |
| `/api/auth/session` | GET | Returns `{ accessToken, idToken, expiresAt }` for `LumoAuthNextProvider`, or `{ accessToken: null, expiresAt: null }` without a session. It never returns the refresh token. |
| `/api/auth/logout` | GET, POST | Revokes the access token (best effort), clears the cookie, and redirects to the LumoAuth logout endpoint with `post_logout_redirect_uri` and `id_token_hint`. |

Both cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the public origin uses `https`.

## The callback URL

The login route sends `{origin}/api/auth/callback` as `redirect_uri`, and the callback repeats the same value in the token request. `{origin}` is the address in the browser:

1. `NEXT_PUBLIC_REDIRECT_URI` (or the `redirectUri` option), when it is set. Its origin is then used for every redirect back to the app.
2. Otherwise the first value of `X-Forwarded-Host` (or `Host`) and of `X-Forwarded-Proto`. Next.js sets both headers on every request. `request.url` is not used: behind a proxy it holds the address that Next.js listens on, such as `http://localhost:3000`.

So one build signs in on every address, and each address needs its own entries on the application:

| Configuration field | Value |
|---|---|
| **Redirect URIs** | `{origin}/api/auth/callback` |
| **Logout → Post-logout redirect URIs** | `{origin}{afterSignOutUrl}`, by default `{origin}/` |

LumoAuth compares redirect URIs exactly and accepts no wildcards. An unregistered address gets the **Invalid Redirect URL** page; the `redirect_uri` parameter in the address bar of that page is the URL to add.

To read the exact value for an address without a browser, request the login route and do not follow the redirect:

```bash
curl -sI https://my-app.vercel.app/api/auth/login | grep -i '^location:'
# location: https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize?...&redirect_uri=https%3A%2F%2Fmy-app.vercel.app%2Fapi%2Fauth%2Fcallback&...
```

An answer that is not a redirect to LumoAuth means that the address is not the app: a preview that needs a sign-in of its own answers `401`, for example.

Addresses of one app that need separate entries:

| Address | Example |
|---|---|
| Local development | `http://localhost:3000` |
| Preview of an app builder | `https://my-app.v0.build` |
| Published app | `https://my-app.vercel.app` |
| Preview deployment of a branch | `https://my-app-git-feature-team.vercel.app` |
| Custom domain | `https://app.example.com` |

Never derive one of these from another, or from the project name. Read each one from the browser or from the request above.

With the CLI, `--redirect-uris` replaces the whole list, so read the current list first and pass every URI. Show the command to the user before you run it:

```bash
lumo apps get CLIENT_ID          # prints redirectUris
lumo apps update CLIENT_ID --redirect-uris http://localhost:3000/api/auth/callback,https://my-app.vercel.app/api/auth/callback
```

A forged `X-Forwarded-Host` cannot send a code elsewhere: LumoAuth refuses any redirect URI that is not registered. Set `NEXT_PUBLIC_REDIRECT_URI` only when a proxy in front of the app sends neither `X-Forwarded-Host` nor the public `Host` header.

## lumoAuthMiddleware()

```ts
lumoAuthMiddleware({
  protect: ['/dashboard/:path*', /^\/settings/],
  refresh: true,
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `protect` | `Array<string \| RegExp>` or `(req: NextRequest) => boolean` | `[]` | Paths that need a session. In a string, `/:path*` matches the path and everything below it, and `*` matches any characters. Everything else is public. |
| `refresh` | `boolean` | `true` | Replace the access token when it expires within 60 seconds. |
| any config value | | | `orgId`, `clientId`, `secret` and the others from the table above |

What it does on each request:

1. No live session and the path is protected: redirect to `{origin}/api/auth/login?return_to=<path and query>`, on the public origin described in [The callback URL](#the-callback-url).
2. No live session and the path is public: continue. An unusable cookie is deleted.
3. Live session with a fresh token: continue.
4. Live session with a stale token: call the token endpoint with the refresh token, store the new session in the cookie, and forward it to the page in the request header `x-lumo-session`, so `auth()` returns the new token in the same request.
5. The refresh is refused: delete the cookie. A protected path redirects to sign-in.

To refresh without protecting any path:

```ts
// proxy.ts (Next.js 16+) or middleware.ts (Next.js 14, 15)
import { lumoAuthMiddleware } from '@lumoauth/nextjs/server';

export default lumoAuthMiddleware();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

A path check in the middleware confirms only that a valid session exists. It does not check permissions. Check permissions in the page, the route handler or the server action.

## Next.js 16: proxy.ts and Cache Components

**File name.** Next.js 16 renamed the `middleware` file to `proxy`. Use `proxy.ts` on Next.js 16 or newer and `middleware.ts` on Next.js 14 and 15. The content is the same: the default export is the function that `lumoAuthMiddleware()` returns, next to `export const config`.

**Cache Components.** With `cacheComponents: true` in `next.config`, which new Next.js 16 projects have, Next.js prerenders a static shell of every page. A session read uses the cookies of the request, so it cannot be part of that shell. A page or layout that calls `auth()`, `currentUser()` or `protectPage()` then fails `next build`:

```
Error: Route "/": Next.js encountered uncached or runtime data during prerendering.
```

Choose one of two fixes for each such page.

Let the page render on each request:

```tsx
// app/profile/page.tsx
import { protectPage } from '@lumoauth/nextjs/server';

export const instant = false;

export default async function ProfilePage() {
  const { userId } = await protectPage({ returnTo: '/profile' });
  return <p>{userId}</p>;
}
```

Or keep the static shell and read the session in a child component inside `<Suspense>`:

```tsx
// app/page.tsx
import { Suspense } from 'react';
import { auth, currentUser } from '@lumoauth/nextjs/server';

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Greeting />
      </Suspense>
    </main>
  );
}

async function Greeting() {
  const { isSignedIn } = await auth();
  if (!isSignedIn) return <a href="/api/auth/login">Sign in</a>;
  const user = await currentUser();
  return <p>Signed in as {user?.name ?? user?.email}</p>;
}
```

Add `export const instant` only when `cacheComponents` is on. Without it, Next.js refuses the export: `Route segment config "instant" requires nextConfig.cacheComponents to be enabled`. Client components such as `<SignedIn>`, `<UserButton>` and the provider need neither fix, so a header in the root layout stays static.

## Check permissions on the server

A session proves who the user is. It does not prove what the user may do. Check a permission with the user's own access token. Treat an error as "denied".

```ts
// lib/authz.ts
import { auth, resolveConfig } from '@lumoauth/nextjs/server';
import { LumoAuth } from '@lumoauth/client';

/** True when the signed-in user has the permission. False when signed out or on any error. */
export async function can(permission: string): Promise<boolean> {
  const token = (await auth()).getToken();
  if (!token) return false;

  // The same domain (US by default) and organization as the route handler.
  const { domain, orgId } = resolveConfig();
  const lumo = new LumoAuth({ baseUrl: domain, orgId, token });

  try {
    return await lumo.permissions.check(permission);
  } catch {
    return false;
  }
}
```

Use it in a route handler:

```ts
// app/api/reports/route.ts
import { auth } from '@lumoauth/nextjs/server';
import { can } from '@/lib/authz';

export async function GET(): Promise<Response> {
  const { isSignedIn } = await auth();
  if (!isSignedIn) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await can('reports.view'))) return Response.json({ error: 'forbidden' }, { status: 403 });

  return Response.json({ reports: [] });
}
```

Use a relative import when the project has no `@/` path alias. Use the same helper in a server component (`if (!(await can('billing.manage'))) notFound();`) and in a server action before it changes data. Import `LumoAuth` from `@lumoauth/client` in server code, not from `@lumoauth/nextjs`: the main entry of `@lumoauth/nextjs` is a `'use client'` module. `<Protect>` and `usePermission()` in client components only hide interface parts; repeat each check on the server.

Permission slugs such as `reports.view` are defined in the organization. For roles, groups and permission design use `lumoauth-rbac`. For relationship checks (`lumo.zanzibar.check`) and attribute policies (`lumo.abac.check`) use `lumoauth-rebac` and `lumoauth-abac`.

## Request more scopes

Some LumoAuth calls need a scope on the user's token.

| Call on the `LumoAuth` client | Scope |
|---|---|
| `permissions.check`, `checkBulk`, `checkAny`, `checkAll`; `zanzibar.check` about the caller | none |
| `permissions.list()`, `permissions.listSlugs()` | `authz:read` |
| `abac.check`, `abac.isAllowed`, `abac.checkBulk`, `abac.getMyAttributes` | `abac:read` |
| `zanzibar.check` about another subject, `zanzibar.expand` | `authz:check` |

To request a scope:

1. Add it to **Configuration → Allowed scopes** of the application in the portal and save.
2. Pass it to the route handler: `createRouteHandler({ scope: 'openid profile email abac:read' })`.
3. Sign out and sign in again. A session that exists keeps its old scopes.

When a scope is missing, the SDK throws `LumoAuthPermissionDeniedError` (status 403). Its `requiredScopes` property lists the missing scopes.

## Sessions and access tokens

| | Lifetime | Meaning |
|---|---|---|
| Session | `sessionMaxAge`, 30 days by default | The user is signed in. |
| Access token | Set on the application in LumoAuth | A credential for API calls |

`isSignedIn` describes the session. A user whose access token expired a minute ago is still signed in when the session holds a refresh token; the token only needs a refresh. The application must allow the `refresh_token` grant, which applications from the portal form do.

Only middleware, route handlers and server actions can write cookies in Next.js. The middleware runs before the page renders, so it is the place where the refresh happens.

## How the cookie is protected

- The cookie `lumo_session` holds the access token, the refresh token, the ID token and the two expiry times. It is encrypted and authenticated with a key that is derived from `LUMOAUTH_SECRET`. The browser can neither read nor change it. A changed cookie counts as no session.
- A new `LUMOAUTH_SECRET` makes every existing cookie unreadable. The middleware deletes such a cookie, and the user signs in again.
- The cookie code uses Web Crypto, so it runs in the Node.js runtime and in the edge runtime.

## Call another API with the user's token

```ts
// app/api/orders/route.ts
import { auth } from '@lumoauth/nextjs/server';

export async function GET(): Promise<Response> {
  const token = (await auth()).getToken();
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const upstream = await fetch('https://api.example.com/orders', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return Response.json(await upstream.json(), { status: upstream.status });
}
```

The API at `https://api.example.com` must validate the token: signature, issuer, audience, expiry and scopes. Use `lumoauth-api-protection`.

## Production checklist

- Register `https://app.example.com/api/auth/callback` as a redirect URI and `https://app.example.com/` as a post-logout redirect URI. Remove the `localhost` entries from a production application.
- Set `NEXT_PUBLIC_LUMOAUTH_ORG_ID`, `NEXT_PUBLIC_LUMOAUTH_CLIENT_ID` and `LUMOAUTH_SECRET` in the hosting environment, and `NEXT_PUBLIC_LUMOAUTH_DOMAIN` for the EU region. `NEXT_PUBLIC_` values are fixed at build time.
- Use a separate `LUMOAUTH_SECRET` for each environment and keep it in the secret store of the host.
- Serve the app over `https`, so the cookies get the `Secure` attribute.
- Keep the middleware matcher wide enough to cover every page and API route that calls `getToken()`.
