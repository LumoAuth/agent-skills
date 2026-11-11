# Browser-only mode, the `lumo init` starter and the Pages Router

`@lumoauth/nextjs` supports two ways to sign in. Use one of them in an app, not both.

| | Server session (the steps in `SKILL.md`) | Browser-only (this file) |
|---|---|---|
| Who exchanges the code | The Next.js server (`/api/auth/callback`) | The browser (`<AuthCallback />`) |
| Where tokens are kept | Encrypted httpOnly cookie | `sessionStorage` of the tab (default) |
| Server components can read the user | Yes, with `auth()` | No |
| First render | Correct for the signed-in user | Signed out, then updated after the page loads |
| Provider | `LumoAuthNextProvider` | `LumoAuthProvider` |
| Redirect URI | `{origin}/api/auth/callback` | `{origin}/auth/callback` |
| Browser CORS origin on the application | Not needed | Required: `{origin}` |
| Works with the Starter App unchanged | No, add the redirect URI | Yes, on `http://localhost:3000` |

Choose the server session for a production app. Choose browser-only for a quick prototype, or when the user asks for the starter.

## Contents

- [Scaffold a new app with the CLI](#scaffold-a-new-app-with-the-cli)
- [Add browser-only mode by hand](#add-browser-only-mode-by-hand)
- [Protect pages and call an API](#protect-pages-and-call-an-api)
- [Move from browser-only mode to the server session](#move-from-browser-only-mode-to-the-server-session)
- [Pages Router](#pages-router)

## Scaffold a new app with the CLI

```bash
lumo login --org acme-corp
lumo apps list                      # copy the Client ID of "Starter App"
lumo init --framework next --dir my-app --client-id CLIENT_ID
cd my-app && npm install && npm run dev
```

`lumo login` opens the browser to approve the CLI and stores the organization slug and the base URL. `lumo init` reads them and writes `.env.local`. It creates nothing in the organization.

Flags of `lumo init`:

| Flag | Meaning |
|---|---|
| `--framework` | `next`, `express`, `fastapi` or `go`. Required. |
| `--dir` | Target directory. Default `.`. Created when missing. |
| `--client-id` | OAuth client ID for `.env.local`. Without it the file holds a placeholder. |
| `--org` | Organization slug for `.env.local`. Default: the slug of the current CLI login. |
| `--force` | Overwrite files that exist. Without it, existing files are skipped. |

The starter is a Next.js 14 App Router project with nine files. The three that matter:

| File | Content |
|---|---|
| `app/layout.tsx` | Wraps the app in `<LumoAuthProvider>` from `@lumoauth/nextjs` |
| `app/page.tsx` | Shows `<SignIn />` when signed out; the user's name and `<UserButton />` when signed in |
| `app/auth/callback/page.tsx` | Mounts `<AuthCallback afterSignInUrl="/" />` |

`.env.local` holds `NEXT_PUBLIC_LUMOAUTH_DOMAIN`, `NEXT_PUBLIC_LUMOAUTH_ORG_ID` and `NEXT_PUBLIC_LUMOAUTH_CLIENT_ID`.

The Starter App allows the redirect URI `http://localhost:3000/auth/callback` and the origin `http://localhost:3000`, so the starter signs in without any change in the portal. The **Next.js** tab of the portal's **Quickstarts** page shows the same `lumo init` command with the client ID filled in.

## Add browser-only mode by hand

The application needs the redirect URI `{origin}/auth/callback` and the origin `{origin}` under **Configuration → Browser CORS origins**. Without the origin, the browser blocks the token request (CORS) right after sign-in.

```bash
npm install @lumoauth/nextjs
```

```bash
# .env.local
NEXT_PUBLIC_LUMOAUTH_ORG_ID=acme-corp
NEXT_PUBLIC_LUMOAUTH_CLIENT_ID=your-client-id
# EU region only. The code falls back to https://app.lumoauth.dev (US).
# NEXT_PUBLIC_LUMOAUTH_DOMAIN=https://eu.app.lumoauth.dev
```

```tsx
// app/providers.tsx
'use client';

import type { ReactNode } from 'react';
import { LumoAuthProvider } from '@lumoauth/nextjs';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LumoAuthProvider
      domain={process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN || 'https://app.lumoauth.dev'}
      orgId={process.env.NEXT_PUBLIC_LUMOAUTH_ORG_ID!}
      clientId={process.env.NEXT_PUBLIC_LUMOAUTH_CLIENT_ID!}
      afterSignInUrl="/dashboard"
      afterSignOutUrl="/"
    >
      {children}
    </LumoAuthProvider>
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
// app/auth/callback/page.tsx
'use client';

import { AuthCallback } from '@lumoauth/nextjs';

export default function CallbackPage() {
  return <AuthCallback afterSignInUrl="/dashboard" loading={<p>Signing in…</p>} />;
}
```

```tsx
// app/page.tsx
'use client';

import { SignedIn, SignedOut, SignIn, UserButton } from '@lumoauth/nextjs';

export default function HomePage() {
  return (
    <main>
      <SignedOut>
        <SignIn />
      </SignedOut>
      <SignedIn>
        <UserButton showName />
      </SignedIn>
    </main>
  );
}
```

Without a `redirectUri` prop the provider uses `{window.location.origin}/auth/callback`. `<SignIn />` renders a card with a **Sign in with email** button that redirects to the hosted login page of the organization.

Sign-out (`<UserButton />`, `<SignOutButton>`, `signOut()`) sends the browser to the LumoAuth logout endpoint with `post_logout_redirect_uri={origin}{afterSignOutUrl}`. LumoAuth returns to the app only when that exact URL, for example `http://localhost:3000/`, is listed under **Configuration → Logout → Post-logout redirect URIs** of the application. The Starter App has no such entry at first, so add it. Without it the user is signed out but stays on a LumoAuth page.

## Protect pages and call an API

A page that must not render for a signed-out visitor:

```tsx
// app/dashboard/page.tsx
'use client';

import { SignedIn, SignedOut, RedirectToSignIn, Protect, useUser } from '@lumoauth/nextjs';

export default function DashboardPage() {
  const user = useUser();
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <h1>Welcome, {user?.displayName}</h1>
        <Protect permission="billing.manage" fallback={<p>No access to billing.</p>}>
          <a href="/billing">Billing</a>
        </Protect>
      </SignedIn>
    </>
  );
}
```

In this mode the server cannot read the session. A route handler receives the access token as a bearer header and checks the permission with it:

```tsx
// components/ReportsButton.tsx
'use client';

import { useAuth } from '@lumoauth/nextjs';

export function ReportsButton() {
  const { getToken } = useAuth();

  async function load() {
    const token = await getToken();
    if (!token) return;
    const res = await fetch('/api/reports', { headers: { Authorization: `Bearer ${token}` } });
    console.log(res.status);
  }

  return <button onClick={load}>Load reports</button>;
}
```

```ts
// app/api/reports/route.ts
import { LumoAuth } from '@lumoauth/client';

export async function GET(request: Request): Promise<Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const lumo = new LumoAuth({
    baseUrl: process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN || 'https://app.lumoauth.dev',
    orgId: process.env.NEXT_PUBLIC_LUMOAUTH_ORG_ID!,
    token,
  });

  let allowed = false;
  try {
    allowed = await lumo.permissions.check('reports.view');
  } catch {
    allowed = false;
  }
  if (!allowed) return Response.json({ error: 'forbidden' }, { status: 403 });

  return Response.json({ reports: [] });
}
```

Install `@lumoauth/client` as a direct dependency for the route handler (`npm install @lumoauth/client`). LumoAuth rejects an invalid or expired token, so the check fails closed. To read claims from the token in the handler, validate it first; use `lumoauth-api-protection`.

For every component, hook and provider prop in this mode, use `lumoauth-react`.

## Move from browser-only mode to the server session

1. Register `{origin}/api/auth/callback` as a redirect URI and `{origin}/` as a post-logout redirect URI.
2. Install `@lumoauth/nextjs@^1.4.1` and add `LUMOAUTH_SECRET` to `.env.local`. Do not add `NEXT_PUBLIC_REDIRECT_URI`: the route handler derives the callback URL from each request.
3. Add the route handler and the middleware (steps 3 and 4 of `SKILL.md`).
4. Replace `LumoAuthProvider` with `LumoAuthNextProvider` and remove its `redirectUri` prop.
5. Replace `<SignIn />`, `<SignInButton>` and `<RedirectToSignIn />` with links to `/api/auth/login`, or with `protectPage()` in server components.
6. Delete `app/auth/callback/page.tsx`.
7. Change route handlers to read the token with `auth()` in place of the `Authorization` header.

## Pages Router

`@lumoauth/nextjs` does not support the Pages Router. In a Pages Router app, install `@lumoauth/react` and put `<LumoAuthProvider>` in `pages/_app.tsx`:

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app';
import { LumoAuthProvider } from '@lumoauth/react';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <LumoAuthProvider
      domain={process.env.NEXT_PUBLIC_LUMOAUTH_DOMAIN || 'https://app.lumoauth.dev'}
      orgId={process.env.NEXT_PUBLIC_LUMOAUTH_ORG_ID!}
      clientId={process.env.NEXT_PUBLIC_LUMOAUTH_CLIENT_ID!}
    >
      <Component {...pageProps} />
    </LumoAuthProvider>
  );
}
```

```tsx
// pages/auth/callback.tsx
import { AuthCallback } from '@lumoauth/react';

export default function CallbackPage() {
  return <AuthCallback afterSignInUrl="/" />;
}
```

This is browser-only mode: the same redirect URI, the same CORS origin, and the same components and hooks. Use `lumoauth-react` for the rest.
