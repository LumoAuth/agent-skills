---
name: lumoauth-vue
description: >-
  Adds LumoAuth sign-in, sign-out, token refresh, route guards and permission checks to a
  Vue 3 single-page app with the @lumoauth/client package. Builds a small auth module and
  composables (useAuth, usePermission) on the LumoAuth client, AuthModule and the
  LumoAuthSession runtime, a callback route for the OAuth 2.0 authorization code flow with
  PKCE, vue-router navigation guards, and a fetch helper that sends the access token to an
  API. Use when the user asks to add login, authentication, OpenID Connect, protected
  routes, role-based UI or RBAC checks to a Vue, Vue Router, Vite or Pinia app, or mentions
  @lumoauth/client together with Vue, the Composition API or VITE_LUMOAUTH_* variables. For
  React use lumoauth-react; for Angular use lumoauth-angular.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Vue 3

LumoAuth has no Vue-specific package. A Vue app uses `@lumoauth/client` directly: `AuthModule` runs the OAuth 2.0 authorization code flow with PKCE, `LumoAuthSession` stores the tokens and refreshes the access token, and the `LumoAuth` client runs permission checks with the user's token. This skill adds one auth module, two composables, a callback route and a router guard.

## When to use

- The project is a Vue 3 app that renders in the browser (Vite, Composition API, `vue-router` 4).
- The user wants sign-in, sign-out, protected routes, permission-based UI or an access token for API calls.

Do not use this skill when:

- The app is React or Next.js. Use `lumoauth-react` or `lumoauth-nextjs`.
- The app is Angular. Use `lumoauth-angular`.
- The app renders on a server (Nuxt with SSR). The module below reads `window` when it loads, and the LumoAuth documentation has no Nuxt guide. Ask the user how they want to proceed; a generic OpenID Connect integration is described in `lumoauth-oauth-oidc`.
- The task is the API that receives the token. Use `lumoauth-api-protection`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or the **Vue** tab of the portal's **Quickstarts** page |
| App origin | `http://localhost:5173`, `https://app.example.com` | The dev server port and the production URL |

**The OAuth application** must be a public client: PKCE required, no client secret. It needs three entries on its **Configuration** tab in the portal (`{base}/orgs/{slug}/portal/applications`):

| Setting | Value | Why |
|---|---|---|
| **Redirect URIs** | `{origin}/auth/callback` | LumoAuth returns the code here. The match is exact. |
| **Browser CORS origins** | `{origin}` | The browser calls the token endpoint. Without the origin the request is blocked right after sign-in. |
| **Logout → Post-logout redirect URIs** | `{origin}/` | LumoAuth returns here after sign-out. |

Every organization has a public client named **Starter App**. It already allows the redirect URI and the origin for `http://localhost:5173` (the Vite default) and `http://localhost:3000`. Add the post-logout redirect URI to it. For another origin add all three entries and click **Save configuration**.

To create a separate application, click **New application**, choose **Single-page or mobile app**, enter the redirect URI and click **Create application**. Do not create it with `lumo apps create`: that command creates a confidential client and cannot set the CORS origin.

## Steps

### 1. Install

```bash
npm install @lumoauth/client
```

The steps assume `vue-router` 4 with `createWebHistory()`. With hash mode the callback URL has no usable path; keep history mode for the callback route.

### 2. Set the configuration values

```bash
# .env.local
VITE_LUMOAUTH_DOMAIN=https://app.lumoauth.dev
VITE_LUMOAUTH_ORG_ID=acme-corp
VITE_LUMOAUTH_CLIENT_ID=your-client-id
```

The three values are public. Never add a client secret or an API key (`lmk_...`) to the app: every `VITE_` value ends up in the bundle.

### 3. Create the auth module

One module owns the session. Components and the router import from it.

Copy [assets/lumoauth.ts](assets/lumoauth.ts) from this skill to `src/auth/lumoauth.ts` without changes. Read the file first; it is the whole integration. It exports:

| Export | Purpose |
|---|---|
| `auth` | Read-only reactive state: `isLoaded`, `isSignedIn`, `user`, `error` |
| `ready` | Promise that resolves when stored tokens are loaded. Await it before the first auth decision. |
| `signIn(returnTo?)` | Stores the PKCE verifier, `state` and the return path, then redirects to the hosted login page |
| `handleCallback()` | Checks `state`, exchanges the code, stores the tokens, returns the path to open next |
| `signOut(returnTo?)` | Revokes the tokens, clears the local session and ends the LumoAuth session |
| `getToken()` | A valid access token, or `null` when nobody is signed in |
| `lumo` | A `LumoAuth` client for permission checks that sends the current access token |

Inside, the module creates an `AuthModule`, a `LumoAuthSession` on top of it, and a `LumoAuth` client whose `token` function returns `session.getToken()`.

`LumoAuthSession` keeps the tokens in `sessionStorage`, refreshes the access token 60 seconds before it expires and keeps tabs in sync. Do not replace it with code that stores `access_token` by hand: such code has no refresh.

What the module guarantees: `buildAuthorizationUrl()` creates the PKCE verifier, the S256 challenge and a random `state`; `handleCallback()` rejects a callback whose `state` differs from the stored value; the verifier is used once and then removed.

### 4. Add the composables

```ts
// src/auth/composables.ts
import { ref, watch, type Ref } from 'vue';
import { auth, getToken, lumo, signIn, signOut } from './lumoauth';

export function useAuth() {
  return { auth, signIn, signOut, getToken };
}

/** Reactive RBAC check for the signed-in user. A failed request counts as denied. */
export function usePermission(permission: string): { allowed: Ref<boolean>; loading: Ref<boolean> } {
  const allowed = ref(false);
  const loading = ref(true);

  watch(
    () => [auth.isLoaded, auth.isSignedIn] as const,
    async ([isLoaded, isSignedIn]) => {
      if (!isLoaded) return;
      if (!isSignedIn) {
        allowed.value = false;
        loading.value = false;
        return;
      }
      loading.value = true;
      try {
        allowed.value = await lumo.permissions.check(permission);
      } catch {
        allowed.value = false;
      } finally {
        loading.value = false;
      }
    },
    { immediate: true },
  );

  return { allowed, loading };
}
```

### 5. Add the callback route and the router guard

```vue
<!-- src/views/AuthCallback.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { handleCallback } from '../auth/lumoauth';

const router = useRouter();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const returnTo = await handleCallback();
    await router.replace(returnTo);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Sign-in failed';
  }
});
</script>

<template>
  <p v-if="error" role="alert">Sign-in failed: {{ error }} <RouterLink to="/">Back to start</RouterLink></p>
  <p v-else>Signing in…</p>
</template>
```

```ts
// src/router.ts
import { createRouter, createWebHistory } from 'vue-router';
import { auth, lumo, ready, signIn } from './auth/lumoauth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    permission?: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/Home.vue') },
    { path: '/auth/callback', component: () => import('./views/AuthCallback.vue') },
    { path: '/forbidden', component: () => import('./views/Forbidden.vue') },
    {
      path: '/dashboard',
      component: () => import('./views/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/billing',
      component: () => import('./views/Billing.vue'),
      meta: { requiresAuth: true, permission: 'billing.manage' },
    },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;

  await ready;
  if (!auth.isSignedIn) {
    await signIn(to.fullPath);
    return false;
  }

  if (to.meta.permission) {
    try {
      if (!(await lumo.permissions.check(to.meta.permission))) return { path: '/forbidden' };
    } catch {
      return { path: '/forbidden' };
    }
  }
  return true;
});
```

Register the router in `src/main.ts` with `createApp(App).use(router).mount('#app')` as usual. The auth module needs no plugin.

### 6. Show the user, check a permission, sign out

```vue
<!-- src/views/Dashboard.vue -->
<script setup lang="ts">
import { useAuth, usePermission } from '../auth/composables';

const { auth, signOut } = useAuth();
const { allowed: canEdit, loading } = usePermission('documents.edit');
</script>

<template>
  <main>
    <h1>Welcome, {{ auth.user?.name ?? auth.user?.email }}</h1>
    <button v-if="!loading && canEdit">Edit document</button>
    <button @click="signOut()">Sign out</button>
  </main>
</template>
```

```vue
<!-- src/views/Home.vue -->
<script setup lang="ts">
import { useAuth } from '../auth/composables';

const { auth, signIn } = useAuth();
</script>

<template>
  <p v-if="!auth.isLoaded">Loading…</p>
  <RouterLink v-else-if="auth.isSignedIn" to="/dashboard">Open the dashboard</RouterLink>
  <button v-else @click="signIn('/dashboard')">Sign in</button>
</template>
```

`auth.user` is the OpenID Connect UserInfo response: `sub`, `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture`.

### 7. Call an API with the access token

```ts
// src/api.ts
import { getToken } from './auth/lumoauth';

const API_BASE = 'https://api.example.com';

/** Sends the access token to the app's own API only. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
```

`getToken()` refreshes the token first when it expires within 30 seconds. Call it for each request. The API must validate the token on every request: signature, issuer, audience, expiry and scopes. Use `lumoauth-api-protection`.

A permission check in the browser hides interface elements. It does not protect data: the API must check the same permission again. Permissions and roles are defined in the organization; use `lumoauth-rbac`.

## Verify

1. Run `npm run dev` and open `http://localhost:5173`. The page shows **Sign in**.
2. Click it. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` with `code_challenge_method=S256` and shows the login page.
3. Sign in. The browser returns to `/auth/callback?code=...&state=...` and then to `/dashboard`, which shows the user's name.
4. In the network panel, `POST .../oauth/token` returns `200` and its body has no `client_secret`.
5. Open `/dashboard` in a private window. The guard redirects to the login page, and after sign-in the browser returns to `/dashboard`.
6. Open `/billing` as a user without `billing.manage`. The app shows `/forbidden`.
7. Click **Sign out**. The browser returns to `/`. Opening `/dashboard` asks for sign-in again.
8. Run `npx vue-tsc --noEmit` (or the project's type check). It reports no error.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| CORS error on `/oauth/token` after sign-in | The app origin is not under **Browser CORS origins**. | Add `{origin}` (no path, no trailing slash) and save. |
| LumoAuth shows a redirect URI error | `{origin}/auth/callback` is not registered, or the port or scheme differs. | Register the exact URI. |
| `Invalid sign-in callback` | The callback was opened in another tab or opened twice, or the page was reloaded on the callback route. The verifier and `state` are in the `sessionStorage` of the tab that started sign-in. | Start sign-in again in one tab. |
| The guard redirects to login right after a successful sign-in | The guard does not `await ready`, so it reads the state before the tokens are loaded. | Keep `await ready` in `beforeEach`. |
| After sign-out the browser stays on a LumoAuth page | `{origin}/` is not a post-logout redirect URI. | Add it under **Configuration → Logout**. |
| After sign-out, **Sign in** signs the same user in without a password | The app cleared only its own tokens. | Use `signOut()` from the module; it also ends the LumoAuth session through `buildEndSessionUrl()`. |
| The user is signed out about one hour after sign-in | The app stores `tokens.access_token` by hand and never refreshes it. | Use `LumoAuthSession` as in step 3 and read the token with `getToken()`. |
| `lumo.abac.check` throws `403` with `requiredScopes: ["abac:read"]` | The token lacks the scope. | Add the scope to the `scope` option and to the application, then sign in again. See the reference file. |
| `client.abac requires orgId` | The `LumoAuth` client was created without `orgId`. | Pass `orgId` as in step 3. |
| `No access token or API key provided.` from a check | A check ran while nobody was signed in. | Run checks after `auth.isSignedIn` is `true`, and catch the error as "denied". |
| A new tab starts signed out | Tokens are in `sessionStorage`, which is per tab. | Pass `storage: localStorageAdapter()` to `LumoAuthSession`; see the reference file. |

## Security rules

- No client secret, API key or agent credential in the app.
- Always compare `state` on the callback, and use each PKCE verifier once.
- Do not log tokens or the callback URL. Do not put a token in a URL.
- Tokens in `sessionStorage` or `localStorage` can be read by any script on the page. Keep third-party scripts off pages that hold a session.
- Send the access token only to the app's own API.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-api-protection`: validate the access token in the API that this app calls.
- `lumoauth-rbac`: define the roles and permissions that the guard and `usePermission` check.
- `lumoauth-oauth-oidc`: the protocol details behind this flow, and integration through a generic OpenID Connect library.
- `lumoauth-login-methods`: social login, magic link and email-first on the hosted login page.
- `lumoauth-branding`: style the hosted login page.

## References

- [assets/lumoauth.ts](assets/lumoauth.ts): the auth module that step 3 copies into the app.
- [references/client-api.md](references/client-api.md): read it for the members of `LumoAuth`, `AuthModule` and `LumoAuthSession`, the storage adapters, scopes and error classes.
- [references/recipes.md](references/recipes.md): read it for a `v-can` directive, bulk checks, relationship and attribute checks, social sign-in, sign-up, a Pinia store, axios and the production checklist.
- https://docs.lumoauth.dev/quickstarts/vue
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
