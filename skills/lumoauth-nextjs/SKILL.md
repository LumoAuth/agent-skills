---
name: lumoauth-nextjs
description: >-
  Adds LumoAuth sign-in, server-side sessions, route protection, a themed profile page and
  permission checks to a Next.js App Router app with the @lumoauth/nextjs package. Covers
  createRouteHandler (login, callback, session, logout), lumoAuthMiddleware in middleware.ts
  or proxy.ts, auth(), currentUser() and protectPage() from @lumoauth/nextjs/server,
  LumoAuthNextProvider, UserButton, UserAvatar and UserProfile styled with the theme of the
  app, an existing login page or mock auth that must become real, and the redirect URL to
  register. Use when the user asks to add login, authentication, sign-in, sign-out, a
  profile or account page, sessions, middleware protection, OAuth 2.0 / OpenID Connect with
  PKCE, or authorization to a Next.js app, or mentions @lumoauth/nextjs,
  NEXT_PUBLIC_LUMOAUTH_* variables, LUMOAUTH_SECRET or server components together with
  LumoAuth. Also for app builders that generate Next.js apps (v0, Bolt, Lovable) and for
  the callback or redirect URL of a preview or published app.
license: MIT
metadata:
  author: lumoauth
  version: "1.3.0"
---

# LumoAuth for Next.js

Add sign-in to a Next.js App Router app with `@lumoauth/nextjs`. The app's own server runs the OAuth 2.0 authorization code flow with PKCE and keeps the tokens in an encrypted httpOnly cookie. Signed-in users get a profile page in the style of the app.

## When to use

- The project is a Next.js 14 or newer app that uses the App Router (`app/` directory), and the user wants sign-in, sign-out, a profile page, protected pages or permission checks.

Do not use this skill when:

- The app uses the Pages Router (`pages/` only) or is a React single-page app without Next.js. Use `lumoauth-react`.
- The task is a separate API that receives bearer tokens (`lumoauth-api-protection`) or needs admin calls with an API key (`lumoauth-node-backend`).

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or **Portal → Applications → the app → Credentials** |
| Region | US (default) or EU | The portal address: `https://eu.app.lumoauth.dev/...` means EU. Ask only when you cannot tell. |

Do not ask for a redirect URI or for the address of the app. The route handler receives the sign-in response at the fixed path `/api/auth/callback` and builds the full URL from the address of each request, so the same code works on `localhost`, in a preview and in production. The user registers that URL in LumoAuth after the app runs (step 9).

**The OAuth application.** Use a public client: PKCE required, no client secret. Every organization has one named **Starter App**, and its client ID works here. To create another one, open `{base}/orgs/{slug}/portal/applications`, click **New application**, choose **Single-page or mobile app** and click **Create application**. Do not use `lumo apps create --type spa`: the CLI creates a confidential client.

## Fit the app that is already there

Read the project before you write any interface: the layout, the header, pages such as `login`, `sign-in`, `account` or `profile`, mock auth code (`AuthContext`, a `useAuth` hook, a `login()` stub, a hard-coded user), an existing `middleware.ts` or `proxy.ts`, and the theme tokens (`app/globals.css`, the Tailwind config, `components.json`).

- Keep the routes, file names, layout and look that exist. Replace the logic behind them. Do not add a second sign-in page, header or user menu next to one that exists.
- A sign-in page or dialog stays, in its own style. Its button becomes a link to `/api/auth/login?return_to=/path`. Remove the email and password fields: the LumoAuth login page asks for the credentials, and the app never collects a password.
- A sign-out control becomes a link to `/api/auth/logout`. A user menu, avatar or account page shows the real user.
- Delete the mock session code. Route guards become `protect` patterns (step 4) and `protectPage()` (step 5).
- Build with the project's own components (Button, Card, Avatar, DropdownMenu) and class names. Add no new colours, fonts or corner radii. LumoAuth components take the theme of the app from step 7.
- When the app has no sign-in control, add a **Sign in** link to the existing header, in its style.

[references/ui-and-theme.md](references/ui-and-theme.md) has the piece-by-piece table and the way to keep an existing middleware.

## Steps

### 1. Install

```bash
npm install @lumoauth/nextjs@^1.4.2 @lumoauth/react@^1.4.2 @lumoauth/client@^1.4.2
```

Version 1.4.2 or newer is required. The three packages are named so that a project with an older lock file gets the new version of each.

### 2. Set the environment variables

```bash
# .env.local
NEXT_PUBLIC_LUMOAUTH_ORG_ID=acme-corp
NEXT_PUBLIC_LUMOAUTH_CLIENT_ID=your-client-id

# Server only. Encrypts the session cookie. At least 32 characters.
LUMOAUTH_SECRET=

# Only for the EU region. The default is https://app.lumoauth.dev (US).
# NEXT_PUBLIC_LUMOAUTH_DOMAIN=https://eu.app.lumoauth.dev
```

Generate the secret with `openssl rand -hex 32`. When an app builder asks for the variables in a form, list the three required ones and tell the user to run that command or to use a random string of 32 characters or more. Never give `LUMOAUTH_SECRET` a `NEXT_PUBLIC_` prefix: that puts the value into the browser bundle. Keep `.env.local` in `.gitignore`. Do not add `NEXT_PUBLIC_REDIRECT_URI`: it pins the app to one address.

### 3. Mount the route handler

This file adds `/api/auth/login`, `/callback`, `/session` and `/logout`. Keep this exact path.

```ts
// app/api/auth/[...lumoauth]/route.ts
import { createRouteHandler } from '@lumoauth/nextjs/server';

export const { GET, POST } = createRouteHandler();
```

### 4. Add the middleware

It refreshes the access token and sends signed-out visitors of protected paths to sign-in. Name the file `proxy.ts` on Next.js 16 or newer and `middleware.ts` on Next.js 14 and 15. Put it in the project root, or in `src/` when the app uses `src/app`.

```ts
// proxy.ts (Next.js 16+) or middleware.ts (Next.js 14, 15)
import { lumoAuthMiddleware } from '@lumoauth/nextjs/server';

export default lumoAuthMiddleware({ protect: ['/profile/:path*', '/dashboard/:path*'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

Every path that `protect` does not list stays public. Keep the matcher wide: a route that the middleware does not run on gets no token refresh.

### 5. Read the session on the server

Sign-in and sign-out are plain links. `return_to` accepts only a path on the same site.

```tsx
// app/page.tsx
import { auth, currentUser } from '@lumoauth/nextjs/server';

export default async function HomePage() {
  const { isSignedIn } = await auth();
  if (!isSignedIn) {
    return <a href="/api/auth/login?return_to=/profile">Sign in</a>;
  }

  const user = await currentUser();
  return <p>Signed in as {user?.name ?? user?.email}</p>;
}
```

- `auth()` decrypts the cookie and makes no network call. It returns `{ isSignedIn, userId, getToken }`.
- `currentUser()` calls the UserInfo endpoint and returns `{ sub, email, email_verified, name, given_name, family_name, picture }` or `null`.
- `protectPage({ returnTo: '/profile' })` redirects a signed-out visitor to sign-in. Otherwise it returns the same object as `auth()`.

**Next.js 16 with `cacheComponents: true` in `next.config`** (new projects have it): a page or layout that calls `auth()`, `currentUser()` or `protectPage()` also needs `export const instant = false;`. Or move the call into a child component inside `<Suspense>`. Without one of the two, `next build` fails with `encountered uncached or runtime data during prerendering`. Without `cacheComponents`, the `instant` export is itself a build error.

### 6. Add the provider and the user menu

Client components read the same session through `LumoAuthNextProvider`.

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

Wrap `{children}` in `app/layout.tsx` with `<Providers>`. Then put the user menu in the header that the app has:

```tsx
// in the header component; the file starts with 'use client'
import Link from 'next/link';
import { SignedIn, SignedOut, UserButton } from '@lumoauth/nextjs';
import { lumoAppearance } from '@/lib/lumoauth-appearance';

<SignedOut>
  <a href="/api/auth/login?return_to=/profile">Sign in</a>
</SignedOut>
<SignedIn>
  <Link href="/profile">Profile</Link>
  <UserButton afterSignOutUrl="/" appearance={lumoAppearance} />
</SignedIn>
```

`<UserButton>` shows the picture or the initials and opens a menu with **Manage account** and **Sign out**. Rules:

- Start sign-in with a link to `/api/auth/login`. Do not use `<SignIn>`, `<SignInButton>`, `<RedirectToSignIn>` or `signIn()`: a sign-in that starts in the browser cannot write the httpOnly cookie.
- Every file that uses a LumoAuth component or hook starts with `'use client'`.

### 7. Give the components the theme of the app

Without this step the components are purple, and they follow the colour scheme of the operating system, not the theme of the app. Map their variables to the tokens of the app once, and pass the object to every LumoAuth component.

```ts
// lib/lumoauth-appearance.ts
import type { AppearanceProps } from '@lumoauth/nextjs';

export const lumoAppearance: AppearanceProps = {
  variables: {
    '--la-font-family': 'inherit',
    '--la-bg': 'var(--card)',
    '--la-bg-subtle': 'var(--muted)',
    '--la-bg-muted': 'var(--muted)',
    '--la-bg-hover': 'var(--accent)',
    '--la-border': 'var(--border)',
    '--la-border-focus': 'var(--ring)',
    '--la-text': 'var(--card-foreground)',
    '--la-text-secondary': 'var(--muted-foreground)',
    '--la-text-muted': 'var(--muted-foreground)',
    '--la-primary': 'var(--primary)',
    '--la-primary-hover': 'var(--primary)',
    '--la-primary-text': 'var(--primary-foreground)',
    '--la-link': 'var(--primary)',
    '--la-danger': 'var(--destructive)',
    '--la-radius-md': 'var(--radius)',
    '--la-radius-xl': 'var(--radius)',
    '--la-card-shadow': 'none',
  },
};
```

The right-hand values are the shadcn/ui tokens that app builders generate (`:root` in `app/globals.css`). Read the tokens of this project and use its names. When a token holds bare HSL channels (`--primary: 222 47% 11%`), write `hsl(var(--primary))`. The components then follow the app in light and in dark mode. For a project without such tokens, read the reference file.

### 8. Build the profile page

Signed-in users get a page at `/profile`, or the account page that the app has. It shows the picture, the name, the email address and the account details, with **Edit profile** and **Sign out**. Users change the name, the picture and the password on the account pages that LumoAuth hosts: `{domain}/account/profile` and `{domain}/account/security`. Link to them. Do not build an edit form.

```tsx
// app/profile/page.tsx
import { protectPage } from '@lumoauth/nextjs/server';
import { ProfileDetails } from '@/components/profile-details';

// export const instant = false;   // only with cacheComponents, see step 5

export default async function ProfilePage() {
  await protectPage({ returnTo: '/profile' });
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <ProfileDetails />
    </main>
  );
}
```

```tsx
// components/profile-details.tsx
'use client';

import { UserAvatar, useAuth, useUser } from '@lumoauth/nextjs';
import { lumoAppearance } from '@/lib/lumoauth-appearance';

export function ProfileDetails() {
  const user = useUser();
  const { isLoaded, config } = useAuth();

  if (!isLoaded || !user) {
    return <div className="h-80 animate-pulse rounded-xl border bg-muted/40" aria-busy="true" />;
  }

  const account = `${config.domain.replace(/\/+$/, '')}/account`;
  const rows = [
    { label: 'Full name', value: user.displayName },
    { label: 'Email', value: user.email },
    { label: 'User ID', value: String(user.sub ?? user.id) },
  ].filter((row) => row.value);

  return (
    <section className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="h-28 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent" />

      <div className="px-6 pb-6">
        <div className="-mt-12 flex items-end justify-between gap-4">
          <span className="inline-flex rounded-full ring-4 ring-card">
            <UserAvatar size={96} appearance={lumoAppearance} />
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <a
              href={`${account}/profile`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Edit profile
            </a>
            <a
              href="/api/auth/logout"
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Sign out
            </a>
          </div>
        </div>

        <h1 className="mt-4 truncate text-2xl font-semibold tracking-tight">{user.displayName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="truncate">{user.email}</span>
          <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
            {user.emailVerified ? 'Verified' : 'Not verified'}
          </span>
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-5 border-t px-6 py-6 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
            <dd className="mt-1 truncate text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-6 py-4">
        <p className="text-sm text-muted-foreground">Password, two-step verification and signed-in devices</p>
        <a href={`${account}/security`} target="_blank" rel="noreferrer" className="text-sm font-medium underline-offset-4 hover:underline">
          Security settings
        </a>
      </div>
    </section>
  );
}
```

This is a starting point, not a fixed design. The example uses Tailwind CSS with shadcn/ui tokens. Keep the parts (picture, name, email, details, **Edit profile**, **Sign out**, security link) and restyle them with the components and classes of this project, so that the page looks like the rest of the app. `<UserAvatar>` shows the picture when the account has one and the initials otherwise.

### 9. Register the addresses of the app in LumoAuth

Sign-in works on an address only after that address is registered on the OAuth application. Open `{base}/orgs/{slug}/portal/applications`, choose the application, open the **Configuration** tab, add two URLs and click **Save configuration**:

| Field | Value | Example |
|---|---|---|
| **Redirect URIs** | `{origin}/api/auth/callback` | `https://my-app.vercel.app/api/auth/callback` |
| **Logout → Post-logout redirect URIs** | `{origin}/` | `https://my-app.vercel.app/` |

The match is exact: scheme, host, port and path. An app has more than one address: `http://localhost:3000`, the preview of an app builder, the published app. The preview and the published app have different hosts (on v0: `https://name.v0.build` and `https://name.vercel.app`). Each address that people sign in on needs its own two entries.

**Never work the address out.** Do not build it from the project name or from the domain of the app builder, and do not present a preview address as the address of the published app. Use one of these sources:

1. Ask the running app. Request `{address}/api/auth/login` without following the redirect (`curl -sI {address}/api/auth/login`). The `Location` header holds the exact value in `redirect_uri=` (URL-encoded). An answer that is not a redirect to LumoAuth means that the address is wrong or needs a sign-in of its own.
2. Ask the user to read it from the browser, with the message below.

Tell the user this, in your own words. Write a full URL only when you got it from source 1; then say which address it belongs to.

> 1. Open the app in its own browser tab, not in the preview frame of the builder. Copy its address up to the end of the domain, for example `https://my-app.vercel.app`.
> 2. In LumoAuth, open **Applications → your application → Configuration**. Add that address followed by `/api/auth/callback` to **Redirect URIs**, and that address followed by `/` to **Post-logout redirect URIs**. Save.
> 3. Click **Sign in** in the app. If LumoAuth shows **Invalid Redirect URL**, look at the address bar of that page: the value after `redirect_uri=` is the URL to register (`%3A%2F%2F` is `://`, `%2F` is `/`).
> 4. Repeat this for every other address of the app, such as the preview and the published app.

Sign-in does not work inside a preview frame: the LumoAuth login page does not load in a frame.

## Verify

1. `npm run build` passes.
2. Click **Sign in**. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` and shows the login page of the organization. An **Invalid Redirect URL** page means that step 9 is not done for this address.
3. Sign in. The browser returns to the `return_to` path. The profile page shows the picture or the initials, the name and the email address, in the colours and the font of the app, in light and in dark mode.
4. Open `/profile` in a private window. The browser is redirected to sign-in.
5. Click **Sign out**. The browser returns to `/`, and `/profile` redirects to sign-in again.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows **Invalid Redirect URL** | `{origin}/api/auth/callback` is not registered for this address, or another address of the app was registered. | Register the `redirect_uri` value from the address bar of that page (step 9). |
| `next build` fails with `uncached or runtime data during prerendering` | `cacheComponents` is on and a page reads the session. | `export const instant = false;` on that page, or `<Suspense>` (step 5). |
| `@lumoauth/nextjs is missing required config: ...` | A variable from step 2 is not set, or the dev server was not restarted. | Set the variables that the message names and restart. |
| After sign-in the user lands on `/` signed out | The callback failed: the sign-in took longer than 10 minutes, or the code exchange was refused. | Start again from `/api/auth/login`. Check the client ID. |
| After sign-out the browser does not come back to the app | `{origin}/` is not a post-logout redirect URI of the application. | Add it under **Configuration → Logout**. |

## Security rules

- Never put `LUMOAUTH_SECRET`, a client secret or an API key (`lmk_...`) in a `NEXT_PUBLIC_` variable or in a client component.
- Never log `getToken()` output, the cookie value or the callback URL.
- A session proves who the user is, not what the user may do. Check each permission on the server with the user's access token; [references/server-api.md](references/server-api.md#check-permissions-on-the-server) has the helper.

## Related skills

- `lumoauth-react`: props and return values of the components and hooks that this package re-exports.
- `lumoauth-rbac`: define the roles and permissions that the server checks.
- `lumoauth-branding`: change the hosted login page that users see.

## References

- [references/ui-and-theme.md](references/ui-and-theme.md): read it when the app already has sign-in pages, mock auth or a middleware, when the project has no shadcn/ui tokens, or for the ready-made `<UserProfile>` card.
- [references/server-api.md](references/server-api.md): read it for every config option, the `auth()` fields, the route table, the middleware options, permission checks, extra scopes and how the session cookie works.
- [references/browser-only-mode.md](references/browser-only-mode.md): read it for the `lumo init --framework next` starter (a new app that signs in from the browser) and the Pages Router.
- https://docs.lumoauth.dev/quickstarts/nextjs
