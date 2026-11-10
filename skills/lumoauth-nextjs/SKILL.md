---
name: lumoauth-nextjs
description: >-
  Adds LumoAuth sign-in, server-side sessions, route protection and permission checks to a
  Next.js App Router app with the @lumoauth/nextjs package. Covers the route handler from
  createRouteHandler (login, callback, session, logout), lumoAuthMiddleware, the server
  helpers auth(), currentUser() and protectPage() from @lumoauth/nextjs/server,
  LumoAuthNextProvider for client components, protecting pages and API routes, RBAC checks
  with the user's access token, and the lumo init --framework next starter. Use when the
  user asks to add login, authentication, sessions, an httpOnly session cookie, middleware
  protection, OAuth 2.0 / OpenID Connect with PKCE, or authorization to a Next.js app, or
  mentions @lumoauth/nextjs, NEXT_PUBLIC_LUMOAUTH_* variables, LUMOAUTH_SECRET, App Router,
  server components or route handlers together with LumoAuth.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Next.js

Add sign-in to a Next.js App Router app with `@lumoauth/nextjs`. The app's own server runs the OAuth 2.0 authorization code flow with PKCE and keeps the tokens in an encrypted httpOnly cookie. Server components, route handlers and server actions read the session with `auth()`. Middleware refreshes the access token and protects routes.

## When to use

- The project is a Next.js 14 or newer app that uses the App Router (`app/` directory), with React 18 or newer and Node 18 or newer.
- The user wants sign-in, sign-out, protected pages, protected API routes or permission checks.

Do not use this skill when:

- The app uses the Pages Router (`pages/` only). `@lumoauth/nextjs` supports the App Router only. Use `lumoauth-react` and put its provider in `pages/_app.tsx`.
- The app is a React single-page app without Next.js. Use `lumoauth-react`.
- The task is a separate Node.js API that receives bearer tokens. Use `lumoauth-node-backend` or `lumoauth-api-protection`.
- The task needs organization-level admin calls (create users, assign roles). Use `lumoauth-node-backend` with an API key on the server.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or **Portal → Applications → the app → Credentials** |
| App origin | `http://localhost:3000`, `https://app.example.com` | The user |

**The OAuth application.** Use a public client: PKCE required, no client secret. Every organization has one named **Starter App**; `lumo apps list` prints its client ID. To create another one, open `{base}/orgs/{slug}/portal/applications`, click **New application**, choose **Single-page or mobile app**, enter the redirect URI and click **Create application**.

The application must allow two URLs for this integration. The Starter App does not include them:

1. **Redirect URI** `{origin}/api/auth/callback`, for example `http://localhost:3000/api/auth/callback`. Add it on the application's **Configuration** tab under **Redirect URIs**, then click **Save configuration**. The match is exact: scheme, host, port and path.
2. **Post-logout redirect URI** `{origin}/`, for example `http://localhost:3000/`. Add it on the same tab under **Logout → Post-logout redirect URIs**.

The redirect URI can also be set with the CLI. `--redirect-uris` replaces the whole list, so read the current list first and pass every URI. Show the command to the user before you run it:

```bash
lumo apps get CLIENT_ID          # prints redirectUris
lumo apps update CLIENT_ID --redirect-uris http://localhost:3000/auth/callback,http://localhost:3000/api/auth/callback
```

Do not use `lumo apps create --type spa` for this app. The Admin API creates a confidential client unless the request body sets `isConfidential` to `false`, and the CLI does not send that field. Create public clients in the portal.

**New app instead of an existing one?** `lumo init --framework next --dir my-app --client-id CLIENT_ID` writes a starter that signs in from the browser and works with the Starter App without changes. Read [references/browser-only-mode.md](references/browser-only-mode.md) for that starter and for the difference between the two modes. The steps below add the server-side session to any App Router app, including that starter.

## Steps

### 1. Install

```bash
npm install @lumoauth/nextjs @lumoauth/client
```

`@lumoauth/nextjs` re-exports the components and hooks of `@lumoauth/react`. `@lumoauth/client` is listed too because server code imports the `LumoAuth` class from it in step 6.

### 2. Set the environment variables

```bash
# .env.local
NEXT_PUBLIC_LUMOAUTH_DOMAIN=https://app.lumoauth.dev
NEXT_PUBLIC_LUMOAUTH_ORG_ID=acme-corp
NEXT_PUBLIC_LUMOAUTH_CLIENT_ID=your-client-id
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Server only. Encrypts the session cookie. At least 32 characters.
LUMOAUTH_SECRET=
```

Generate the secret with `openssl rand -hex 32` and paste the output. Never give `LUMOAUTH_SECRET` a `NEXT_PUBLIC_` prefix: Next.js puts every `NEXT_PUBLIC_` value into the browser bundle. Check that `.env.local` is in `.gitignore`.

### 3. Mount the route handler

This one file adds `/api/auth/login`, `/api/auth/callback`, `/api/auth/session` and `/api/auth/logout`. Keep this exact path: the middleware and `protectPage()` redirect to `/api/auth/login`.

```ts
// app/api/auth/[...lumoauth]/route.ts
import { createRouteHandler } from '@lumoauth/nextjs/server';

export const { GET, POST } = createRouteHandler();
```

The handler creates the PKCE verifier and `state`, checks `state` on the callback, exchanges the code and stores the session in the cookie `lumo_session`.

### 4. Add the middleware

The middleware replaces the access token before it expires and sends signed-out visitors of protected paths to `/api/auth/login?return_to=<path>`. Put the file in the project root, or in `src/` when the app uses `src/app`.

```ts
// middleware.ts
import { lumoAuthMiddleware } from '@lumoauth/nextjs/server';

export default lumoAuthMiddleware({ protect: ['/dashboard/:path*'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

`protect` accepts path patterns (`/dashboard/:path*`, `/admin/*`), regular expressions, or a function `(req: NextRequest) => boolean`. Every other path stays public. Keep the matcher wide: a route that the middleware does not run on gets no token refresh.

### 5. Read the session in a server component

Sign-in and sign-out are plain links. Add `?return_to=/path` to choose the page after sign-in. `return_to` accepts only paths on the same site.

```tsx
// app/page.tsx
import { auth, currentUser } from '@lumoauth/nextjs/server';

export default async function HomePage() {
  const { isSignedIn } = await auth();

  if (!isSignedIn) {
    return <a href="/api/auth/login?return_to=/dashboard">Sign in</a>;
  }

  const user = await currentUser();
  return (
    <main>
      <p>Signed in as {user?.email ?? user?.sub}</p>
      <a href="/api/auth/logout">Sign out</a>
    </main>
  );
}
```

`auth()` decrypts the cookie and makes no network call. It returns `{ isSignedIn, userId, getToken, expiresAt, isStale }`; `userId` is the `sub` claim. `currentUser()` calls the OpenID Connect UserInfo endpoint on every call and returns `{ sub, email, email_verified, name, given_name, family_name, picture }` or `null`.

For a page that only signed-in users may open, call `protectPage()`. It redirects a signed-out visitor to sign-in and otherwise returns the same object as `auth()`.

```tsx
// app/dashboard/page.tsx
import { protectPage } from '@lumoauth/nextjs/server';

export default async function DashboardPage() {
  const { userId } = await protectPage({ returnTo: '/dashboard' });
  return <h1>Dashboard of {userId}</h1>;
}
```

### 6. Check permissions on the server

A session proves who the user is. It does not prove what the user may do. Check a permission with the user's own access token. Treat an error as "denied".

```ts
// lib/authz.ts
import { auth } from '@lumoauth/nextjs/server';
import { LumoAuth } from '@lumoauth/client';

/** True when the signed-in user has the permission. False when signed out or on any error. */
export async function can(permission: string): Promise<boolean> {
  const token = (await auth()).getToken();
  if (!token) return false;

  const lumo = new LumoAuth({
    baseUrl: process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN!,
    orgId: process.env.NEXT_PUBLIC_LUMOAUTH_ORG_ID!,
    token,
  });

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

Use a relative import when the project has no `@/` path alias. Use the same helper in a server component (`if (!(await can('billing.manage'))) notFound();`) and in a server action before it changes data. Import `LumoAuth` from `@lumoauth/client` in server code, not from `@lumoauth/nextjs`: the main entry of `@lumoauth/nextjs` is a `'use client'` module.

Permission slugs such as `reports.view` are defined in the organization. For roles, groups and permission design use `lumoauth-rbac`. For relationship checks (`lumo.zanzibar.check`) and attribute policies (`lumo.abac.check`) use `lumoauth-rebac` and `lumoauth-abac`.

### 7. Use components and hooks in client components (optional)

Wrap the app in `LumoAuthNextProvider`. It reads the session from `/api/auth/session`, so hooks return the same user that `auth()` returned on the server.

```tsx
// app/providers.tsx
'use client';

import type { ReactNode } from 'react';
import { LumoAuthNextProvider } from '@lumoauth/nextjs';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LumoAuthNextProvider
      domain={process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN!}
      orgId={process.env.NEXT_PUBLIC_LUMOAUTH_ORG_ID!}
      clientId={process.env.NEXT_PUBLIC_LUMOAUTH_CLIENT_ID!}
      afterSignOutUrl="/"
    >
      {children}
    </LumoAuthNextProvider>
  );
}
```

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

```tsx
// components/Header.tsx
'use client';

import { SignedIn, SignedOut, UserButton, Protect } from '@lumoauth/nextjs';

export function Header() {
  return (
    <header>
      <SignedOut>
        <a href="/api/auth/login">Sign in</a>
      </SignedOut>
      <SignedIn>
        <Protect permission="billing.manage">
          <a href="/billing">Billing</a>
        </Protect>
        <UserButton showName />
      </SignedIn>
    </header>
  );
}
```

Rules for this provider:

- Start sign-in with a link to `/api/auth/login`. Do not use `<SignIn>`, `<SignInButton>`, `<RedirectToSignIn>` or `signIn()` here. Those start a sign-in in the browser, and the browser cannot write the httpOnly cookie.
- Every file that uses a LumoAuth component or hook starts with `'use client'`.
- `<Protect>` and `usePermission()` hide interface elements. They do not protect data. Repeat each check on the server as in step 6.
- The provider reads the session when it mounts and does not refresh the token in the browser, because the refresh token stays on the server. Make decisions that matter in server code.

The components and hooks are the ones from `@lumoauth/react`. For their props and return values use `lumoauth-react`.

## Verify

1. Run `npm run dev` and open `http://localhost:3000`. No `missing required config` error appears.
2. Click **Sign in**. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` and shows the organization's login page.
3. Sign in. The browser returns to the `return_to` path, and the page shows the user's email in the server-rendered HTML (view source).
4. The browser has an httpOnly cookie named `lumo_session`. No token is in `localStorage` or `sessionStorage`.
5. Open a protected path in a private window. The browser is redirected to `/api/auth/login?return_to=...`.
6. Call the protected API route without the cookie: `curl -i http://localhost:3000/api/reports` returns `401`.
7. Click **Sign out**. The browser returns to `/`, and `/dashboard` redirects to sign-in again.
8. In the portal, **Audit logs** shows the sign-in.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `@lumoauth/nextjs is missing required config: ...` | A variable from step 2 is not set, or the dev server was not restarted. | Set the variables that the message names and restart. |
| `LUMOAUTH_SECRET must be set to at least 32 characters` | The secret is missing or short. | `openssl rand -hex 32`. |
| LumoAuth shows a redirect URI error instead of the login page | `{origin}/api/auth/callback` is not registered, or `NEXT_PUBLIC_REDIRECT_URI` differs from it by a port, a slash or `http`/`https`. | Register the exact URI and use the same string in the variable. |
| After sign-in the user lands on `/` signed out | The callback failed: `state` did not match, the sign-in took longer than 10 minutes, or the code exchange was refused. | Start again from `/api/auth/login`. Check the client ID and the redirect URI. |
| After sign-out the browser does not come back to the app | `{origin}/` is not a post-logout redirect URI of the application. | Add it under **Configuration → Logout**. |
| `getToken()` returns `null` while `isSignedIn` is `true` | The access token expired and the middleware did not run on this route. | Widen the `matcher` so that it covers the route. |
| The user is signed out about one hour after sign-in | The application is a confidential client. The middleware sends no client secret when it refreshes. | Use a public PKCE client. `LUMOAUTH_CLIENT_SECRET` is sent on the code exchange only. |
| Build error when a client component imports `@lumoauth/nextjs/server` | That entry is marked `server-only`. | Import server helpers only in server components, route handlers, server actions and middleware. |
| `403` with `requiredScopes` such as `["abac:read"]` | The token lacks a scope. | Pass `scope` to `createRouteHandler`, allow the scope on the application, and sign in again. See the reference file. |
| Hooks show "signed out" after `<SignInButton>` | A browser sign-in cannot store tokens in the cookie session. | Link to `/api/auth/login`. |

## Security rules

- Never put `LUMOAUTH_SECRET`, a client secret or an API key (`lmk_...`) in a `NEXT_PUBLIC_` variable or in a client component.
- Never log `getToken()` output, the cookie value or the callback URL.
- Changing `LUMOAUTH_SECRET` signs every user out. Use a different secret for each environment.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-react`: props and return values of the components and hooks that this package re-exports.
- `lumoauth-rbac`: define the roles and permissions that `can()` checks.
- `lumoauth-authorization`: choose between RBAC, ABAC and relationship checks.
- `lumoauth-node-backend`: admin operations from server code with an organization API key.
- `lumoauth-api-protection`: validate the access token in a separate API that this app calls.
- `lumoauth-branding`: change the hosted login page that users see.

## References

- [references/server-api.md](references/server-api.md): read it for every config option, the `auth()` fields, the route table, the middleware options, extra scopes and how the session cookie works.
- [references/browser-only-mode.md](references/browser-only-mode.md): read it for the `lumo init --framework next` starter, the browser-only mode with `<LumoAuthProvider>` and `<AuthCallback>`, and the Pages Router.
- https://docs.lumoauth.dev/quickstarts/nextjs
- https://docs.lumoauth.dev/cli/init
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
