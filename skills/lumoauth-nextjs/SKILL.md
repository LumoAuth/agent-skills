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
  server components or route handlers together with LumoAuth. Also for app builders that
  generate Next.js apps (v0, Bolt, Lovable) and for the callback or redirect URL of the app.
license: MIT
metadata:
  author: lumoauth
  version: "1.1.0"
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
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or **Portal → Applications → the app → Credentials** |
| Region | US (default) or EU | The portal address: `https://eu.app.lumoauth.dev/...` means EU. Ask only when you cannot tell. |

Do not ask for a redirect URI, a callback URL or the address of the app. The route handler receives the sign-in response at the fixed path `/api/auth/callback` and builds the full URL from the address of each request. The same code works on `localhost`, on a preview deployment and in production. The user registers that URL in LumoAuth after the app runs (step 8).

**The OAuth application.** Use a public client: PKCE required, no client secret. Every organization has one named **Starter App**, and its client ID works here. To create another one, open `{base}/orgs/{slug}/portal/applications`, click **New application**, choose **Single-page or mobile app** and click **Create application**. Do not use `lumo apps create --type spa`: the CLI creates a confidential client. Create public clients in the portal.

**New app instead of an existing one?** `lumo init --framework next --dir my-app --client-id CLIENT_ID` writes a starter that signs in from the browser. Read [references/browser-only-mode.md](references/browser-only-mode.md) for that starter and for the difference between the two modes. The steps below add the server-side session to any App Router app, including that starter.

## Steps

### 1. Install

```bash
npm install @lumoauth/nextjs@^1.4.1 @lumoauth/client
```

Version 1.4.1 or newer is required: older versions need `NEXT_PUBLIC_REDIRECT_URI` and `NEXT_PUBLIC_LUMOAUTH_DOMAIN`. `@lumoauth/nextjs` re-exports the components and hooks of `@lumoauth/react`. `@lumoauth/client` is listed too because server code imports the `LumoAuth` class from it in step 6.

### 2. Set the environment variables

Three variables are required:

```bash
# .env.local
NEXT_PUBLIC_LUMOAUTH_ORG_ID=acme-corp
NEXT_PUBLIC_LUMOAUTH_CLIENT_ID=your-client-id

# Server only. Encrypts the session cookie. At least 32 characters.
LUMOAUTH_SECRET=
```

One variable is optional:

| Variable | Default | Set it when |
|---|---|---|
| `NEXT_PUBLIC_LUMOAUTH_DOMAIN` | `https://app.lumoauth.dev` (US) | The organization is in the EU region: `https://eu.app.lumoauth.dev` |

Generate the secret with `openssl rand -hex 32` and paste the output. Some app builders ask for environment variables in a form, and you cannot run a command there. Then tell the user to run that command, or to use a random string of 32 characters or more from a password manager. Never give `LUMOAUTH_SECRET` a `NEXT_PUBLIC_` prefix: Next.js puts every `NEXT_PUBLIC_` value into the browser bundle. Check that `.env.local` is in `.gitignore`.

Do not add `NEXT_PUBLIC_REDIRECT_URI`. It pins the app to one address and is only for a proxy that hides the public address (see [references/server-api.md](references/server-api.md#the-callback-url)). When an app builder lists the variables that the user must fill in, list the three required ones and mention the EU domain as optional.

### 3. Mount the route handler

This one file adds `/api/auth/login`, `/api/auth/callback`, `/api/auth/session` and `/api/auth/logout`. Keep this exact path: the middleware and `protectPage()` redirect to `/api/auth/login`, and `/api/auth/callback` is the URL that the user registers in step 8.

```ts
// app/api/auth/[...lumoauth]/route.ts
import { createRouteHandler } from '@lumoauth/nextjs/server';

export const { GET, POST } = createRouteHandler();
```

The handler creates the PKCE verifier and `state`, sends `{origin}/api/auth/callback` as the redirect URI, checks `state` on the callback, exchanges the code and stores the session in the cookie `lumo_session`. `{origin}` is the address in the browser, read from the `X-Forwarded-Host` and `X-Forwarded-Proto` headers that Next.js sets on every request.

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
      domain={process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN}
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

`domain` is optional. When the variable is not set, the provider uses `https://app.lumoauth.dev`.

Rules for this provider:

- Start sign-in with a link to `/api/auth/login`. Do not use `<SignIn>`, `<SignInButton>`, `<RedirectToSignIn>` or `signIn()` here. Those start a sign-in in the browser, and the browser cannot write the httpOnly cookie.
- Every file that uses a LumoAuth component or hook starts with `'use client'`.
- `<Protect>` and `usePermission()` hide interface elements. They do not protect data. Repeat each check on the server as in step 6.
- The provider reads the session when it mounts and does not refresh the token in the browser, because the refresh token stays on the server. Make decisions that matter in server code.

The components and hooks are the ones from `@lumoauth/react`. For their props and return values use `lumoauth-react`.

### 8. Register the app's address in LumoAuth

Do this last, once the app runs. Tell the user these steps, with the address filled in when you know it.

For each address that the app runs on (`http://localhost:3000`, a preview address, the production domain), add two URLs to the OAuth application. Open `{base}/orgs/{slug}/portal/applications`, choose the application and open the **Configuration** tab:

| Field | Value | Example |
|---|---|---|
| **Redirect URIs** | `{origin}/api/auth/callback` | `https://my-app.vercel.app/api/auth/callback` |
| **Logout → Post-logout redirect URIs** | `{origin}/` | `https://my-app.vercel.app/` |

Click **Save configuration**. The match is exact: scheme, host, port and path. The Starter App does not include these URLs.

When the address is not known in advance, for example in an app builder preview: open the app and click **Sign in**. LumoAuth shows an **Invalid Redirect URL** page. The URL to add is the `redirect_uri=` parameter in the address bar of that page (URL-encoded: `%3A%2F%2F` is `://`, `%2F` is `/`); the page also names it. Add it, then sign in again. Sign-in does not work in a preview that is shown in a frame. The LumoAuth login page does not load in a frame, and the browser does not send the session cookie there. Open the preview in its own browser tab.

With the CLI, `--redirect-uris` replaces the whole list, so read the current list first and pass every URI. Show the command to the user before you run it:

```bash
lumo apps get CLIENT_ID          # prints redirectUris
lumo apps update CLIENT_ID --redirect-uris http://localhost:3000/auth/callback,http://localhost:3000/api/auth/callback
```

## Verify

1. Run `npm run dev` and open `http://localhost:3000`. No `missing required config` error appears.
2. Click **Sign in**. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` with `redirect_uri=http://localhost:3000/api/auth/callback` and shows the organization's login page. An **Invalid Redirect URL** page means that step 8 is not done for this address.
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
| The message names `domain` or `redirectUri` | `@lumoauth/nextjs` is older than 1.4.1. | `npm install @lumoauth/nextjs@^1.4.1`. |
| `LUMOAUTH_SECRET must be set to at least 32 characters` | The secret is missing or short. | `openssl rand -hex 32`. |
| LumoAuth shows **Invalid Redirect URL** | `{origin}/api/auth/callback` is not registered for this address. | Add the `redirect_uri` of that page under **Configuration → Redirect URIs** (step 8). |
| The login page does not load inside an app builder preview | The preview runs in a frame. | Open the preview in its own browser tab. |
| After sign-in the browser goes to `http://localhost:3000` instead of the public address | A proxy in front of the app sends neither `X-Forwarded-Host` nor the public `Host` header. | Set `NEXT_PUBLIC_REDIRECT_URI` to the public callback URL, for example `https://app.example.com/api/auth/callback`. |
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
