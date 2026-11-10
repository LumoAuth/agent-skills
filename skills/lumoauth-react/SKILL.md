---
name: lumoauth-react
description: >-
  Adds LumoAuth sign-in, sign-out, protected routes and permission checks to a React
  single-page app with the @lumoauth/react package. Covers LumoAuthProvider, the AuthCallback
  route, SignIn, SignUp, UserButton, SignedIn, SignedOut, RedirectToSignIn, Protect, the hooks
  useAuth, useUser, useSession, useLumoAuth, usePermission, useZanzibar, useAbac, useMagicLink
  and useEmailFirst, calling an API with the access token from getToken(), token storage
  adapters and theming with the appearance prop. Use when the user asks to add login,
  authentication, OAuth 2.0 / OpenID Connect with PKCE, a user menu, route guards or
  role-based UI to a React app built with Vite, React Router, Remix in SPA mode or Create
  React App, or to a Next.js Pages Router app, or mentions @lumoauth/react. For the Next.js
  App Router use lumoauth-nextjs instead.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for React single-page apps

Add sign-in to a React app with `@lumoauth/react`. The provider runs the OAuth 2.0 authorization code flow with PKCE in the browser, stores the tokens, refreshes the access token before it expires and shares the session across tabs. Components and hooks read the session from the provider.

## When to use

- The project is a React 18 or newer app that renders in the browser: Vite, React Router, Create React App, or a Next.js Pages Router app.
- The user wants sign-in, a user menu, protected routes, permission-based UI, or an access token for API calls.

Do not use this skill when:

- The app uses the Next.js App Router. Use `lumoauth-nextjs`; it keeps tokens in an httpOnly cookie.
- The app is Vue or Angular. Use `lumoauth-vue` or `lumoauth-angular`.
- The app is React Native or Expo. Use `lumoauth-react-native`.
- The task is the API that receives the token. Use `lumoauth-api-protection` or `lumoauth-node-backend`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or the **React** tab of the portal's **Quickstarts** page |
| App origin | `http://localhost:5173`, `https://app.example.com` | The dev server port and the production URL |

**The OAuth application** must be a public client: PKCE required, no client secret. A browser app cannot keep a secret. It needs three entries, all on the application's **Configuration** tab in the portal (`{base}/orgs/{slug}/portal/applications`):

| Setting | Value | Why |
|---|---|---|
| **Redirect URIs** | `{origin}/auth/callback` | LumoAuth returns the code here. The match is exact. |
| **Browser CORS origins** | `{origin}` | The browser calls the token endpoint. Without the origin the request is blocked right after sign-in. |
| **Logout → Post-logout redirect URIs** | `{origin}/` | LumoAuth returns here after sign-out. |

Every organization has a public client named **Starter App**. It already allows the redirect URI and the origin for `http://localhost:5173` (Vite) and `http://localhost:3000`. It has no post-logout redirect URI at first; add one. For any other origin, add all three entries and click **Save configuration**.

To create a separate application, click **New application** in the portal, choose **Single-page or mobile app**, enter the redirect URI and click **Create application**. Then add the origin and the post-logout URI. Do not create it with `lumo apps create`: that command creates a confidential client and cannot set the CORS origin.

## Steps

### 1. Install

```bash
npm install @lumoauth/react
```

`@lumoauth/client` is installed with it. The routing examples use React Router (`npm install react-router`); keep the router that the app already has.

### 2. Set the configuration values

For Vite:

```bash
# .env.local
VITE_LUMOAUTH_DOMAIN=https://app.lumoauth.dev
VITE_LUMOAUTH_ORG_ID=acme-corp
VITE_LUMOAUTH_CLIENT_ID=your-client-id
```

These three values are public. Never add a client secret or an API key (`lmk_...`) to a browser app: every `VITE_` value ends up in the bundle.

### 3. Wrap the app in the provider

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { LumoAuthProvider } from '@lumoauth/react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LumoAuthProvider
      domain={import.meta.env.VITE_LUMOAUTH_DOMAIN}
      orgId={import.meta.env.VITE_LUMOAUTH_ORG_ID}
      clientId={import.meta.env.VITE_LUMOAUTH_CLIENT_ID}
      afterSignInUrl="/dashboard"
      afterSignOutUrl="/"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LumoAuthProvider>
  </React.StrictMode>,
);
```

Without a `redirectUri` prop the provider uses `{window.location.origin}/auth/callback`. Pass `redirectUri` only when the callback route has another path.

### 4. Add the callback route and a route guard

`<AuthCallback>` checks `state`, exchanges the code for tokens with the PKCE verifier, loads the user and then navigates to `afterSignInUrl`.

```tsx
// src/auth/RequireAuth.tsx
import type { ReactNode } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn } from '@lumoauth/react';

export function RequireAuth({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>{children}</SignedIn>
    </>
  );
}
```

```tsx
// src/App.tsx
import { Routes, Route } from 'react-router';
import { AuthCallback, SignedIn, SignedOut, SignInButton, UserButton } from '@lumoauth/react';
import { RequireAuth } from './auth/RequireAuth';
import Dashboard from './pages/Dashboard';

function Home() {
  return (
    <header>
      <SignedOut>
        <SignInButton>
          <button>Sign in</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton showName />
      </SignedIn>
    </header>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/auth/callback"
        element={
          <AuthCallback
            loading={<p>Signing in…</p>}
            error={(message) => <p>Sign-in failed: {message}</p>}
          />
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

`<SignedIn>` and `<SignedOut>` render nothing until the session has loaded, so no content flashes. `<SignInButton>` and `<RedirectToSignIn />` send the browser to the hosted login page of the organization. That page handles passwords, passkeys, social login, MFA and sign-up. To render a sign-in card inside the app, use `<SignIn />`.

The dev server must return `index.html` for `/auth/callback`. Vite does this by default. In production, configure the host to serve `index.html` for unknown paths.

### 5. Read the user and call an API

```tsx
// src/pages/Dashboard.tsx
import { useState } from 'react';
import { useAuth, useUser } from '@lumoauth/react';

export default function Dashboard() {
  const user = useUser();
  const { getToken, signOut } = useAuth();
  const [orders, setOrders] = useState<unknown>(null);

  async function loadOrders() {
    const token = await getToken();
    if (!token) return;
    const res = await fetch('https://api.example.com/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setOrders(await res.json());
  }

  return (
    <main>
      <h1>Welcome, {user?.displayName}</h1>
      <p>{user?.email}</p>
      <button onClick={loadOrders}>Load orders</button>
      <button onClick={() => signOut()}>Sign out</button>
      {orders !== null && <pre>{JSON.stringify(orders, null, 2)}</pre>}
    </main>
  );
}
```

- `getToken()` returns a valid access token and refreshes it first when it expires within 30 seconds. It returns `null` when nobody is signed in. Call it before each request; do not keep the token in component state.
- `signOut()` revokes the access token, clears the stored tokens and sends the browser to the LumoAuth logout endpoint, which returns to `afterSignOutUrl`.
- The API must validate the token on every request: signature, issuer, audience, expiry and scopes. Use `lumoauth-api-protection`.

### 6. Show content by permission

```tsx
// src/components/BillingArea.tsx
import { Protect, usePermission } from '@lumoauth/react';

export function BillingArea() {
  return (
    <Protect permission="billing.manage" fallback={<p>You do not have access to billing.</p>}>
      <h2>Billing</h2>
    </Protect>
  );
}

export function EditButton() {
  const { allowed, isLoading } = usePermission('documents.edit');
  if (isLoading || !allowed) return null;
  return <button>Edit document</button>;
}
```

`<Protect>` and the check hooks call LumoAuth with the user's access token. A failed request counts as "denied". They hide interface elements in the browser. They do not protect data: the API must check the same permission again.

`<Protect>` also accepts `zanzibar={{ object: 'document:doc-123', relation: 'editor' }}` for a relationship check about the signed-in user and `abac={{ resourceType: 'document', action: 'edit', resourceId: 'doc-123' }}` for an attribute policy. ABAC checks need the scope `abac:read`; see the reference file. Permissions and roles are defined in the organization; use `lumoauth-rbac` for that.

## Verify

1. Run the dev server and open the app. The console shows no error from `LumoAuthProvider`.
2. Click **Sign in**. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` with `code_challenge_method=S256` and shows the login page.
3. Sign in. The browser returns to `/auth/callback?code=...&state=...` and then to `/dashboard`, which shows the user's name.
4. In the network panel, the `POST .../oauth/token` request returns `200` and its body contains no `client_secret`.
5. Open `/dashboard` in a private window. The browser is redirected to the login page.
6. Click **Sign out**. The browser returns to `/`, and `/dashboard` asks for sign-in again.
7. In the portal, the **Check it worked** step on the **React** tab of the **Quickstarts** page shows the sign-in, and **Audit logs** lists it.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The callback page fails with a CORS error on `/oauth/token` | The app origin is not under **Browser CORS origins**. | Add `{origin}` (no path, no trailing slash) and save. |
| LumoAuth shows a redirect URI error | `{origin}/auth/callback` is not registered, or the port or scheme differs. | Register the exact URI, or pass the registered one as `redirectUri`. |
| `useLumoAuthContext must be used within <LumoAuthProvider>` | A component or hook renders outside the provider. | Move the provider to the root, above the router. |
| The callback shows `Invalid state parameter` | The callback URL was opened in another tab, or opened twice. The verifier and `state` are in the `sessionStorage` of the tab that started sign-in. | Start sign-in again in one tab. |
| After sign-out the browser stays on a LumoAuth page | `{origin}{afterSignOutUrl}` is not a post-logout redirect URI. | Add it under **Configuration → Logout**. |
| A new tab starts signed out | Tokens are in `sessionStorage`, which is per tab. | Pass `storage={localStorageAdapter()}`; see the reference file for the trade-off. |
| `useAbac` or `<Protect abac>` always denies | The token lacks `abac:read`. | Add the scope to the provider's `scope` prop and to the application, then sign in again. |
| `useZanzibar` always denies and TypeScript reports a missing `subject` | The hook needs `subject`. Only `<Protect zanzibar>` fills it in. | Pass `subject: 'user:' + user.sub`. |
| The session is rebuilt on every render | A new `storage` adapter is created in each render. | Create the adapter once at module level. |
| Sign-in with `authStrategy="password"` fails | The token endpoint does not offer the password grant. | Remove the prop. The default `pkce` is the supported flow. |
| The user registers through `<SignUp />` and does not come back to the app | `<SignUp />` opens the registration page without a return to the app. | Let users register from the hosted login page, or use the `prompt=create` recipe in the reference file. |

## Security rules

- No client secret, API key or agent credential in the app. A public client and PKCE are the whole client authentication.
- Do not log tokens or the callback URL. Do not put a token in a URL.
- The default `sessionStorage` and `localStorageAdapter()` can be read by any script on the page. Keep third-party scripts off pages that hold a session, and use a Content Security Policy.
- Request only the scopes that the app uses.
- Every check in the browser is a display decision. Enforce access in the API.

## Related skills

- `lumoauth-nextjs`: Next.js App Router with a server-side session.
- `lumoauth-api-protection`: validate the access token in the API that this app calls.
- `lumoauth-rbac`: define the roles and permissions that `<Protect>` checks.
- `lumoauth-login-methods`: turn on social login, magic link and email-first for the hosted login page.
- `lumoauth-branding`: style the hosted login page.

## References

- [references/components-and-hooks.md](references/components-and-hooks.md): read it for every component prop, hook return value, the `LumoAuthUser` fields and the `useAuth()` value.
- [references/advanced.md](references/advanced.md): read it for token storage adapters, extra scopes, the `LumoAuth` client from `useLumoAuth()`, relationship and attribute checks, social buttons, sign-up, magic link, email-first, a custom password form and theming.
- https://docs.lumoauth.dev/quickstarts/react
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/access-control/roles-permissions
