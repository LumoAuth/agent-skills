# Vue recipes for LumoAuth

Secondary patterns on top of the auth module from `SKILL.md` (`src/auth/lumoauth.ts`). Each recipe imports from that module.

## Contents

- [Check several permissions in one request](#check-several-permissions-in-one-request)
- [A v-can directive](#a-v-can-directive)
- [Relationship and attribute checks](#relationship-and-attribute-checks)
- [Sign in with a social provider](#sign-in-with-a-social-provider)
- [Open the sign-up page](#open-the-sign-up-page)
- [Share the session across tabs](#share-the-session-across-tabs)
- [Request more scopes](#request-more-scopes)
- [Expose the state through Pinia](#expose-the-state-through-pinia)
- [Send the token with axios](#send-the-token-with-axios)
- [Check the issuer on the callback](#check-the-issuer-on-the-callback)
- [Production checklist](#production-checklist)

## Check several permissions in one request

```ts
// src/auth/usePermissions.ts
import { ref, watch, type Ref } from 'vue';
import { auth, lumo } from './lumoauth';

/** One request for many permission slugs. Missing or failed checks count as denied. */
export function usePermissions(slugs: string[]): { can: Ref<Record<string, boolean>>; loading: Ref<boolean> } {
  const can = ref<Record<string, boolean>>({});
  const loading = ref(true);

  watch(
    () => [auth.isLoaded, auth.isSignedIn] as const,
    async ([isLoaded, isSignedIn]) => {
      if (!isLoaded) return;
      if (!isSignedIn) {
        can.value = {};
        loading.value = false;
        return;
      }
      loading.value = true;
      try {
        can.value = (await lumo.permissions.checkBulk(slugs)).results;
      } catch {
        can.value = {};
      } finally {
        loading.value = false;
      }
    },
    { immediate: true },
  );

  return { can, loading };
}
```

```vue
<script setup lang="ts">
import { usePermissions } from '../auth/usePermissions';

const { can } = usePermissions(['document.edit', 'document.delete']);
</script>

<template>
  <button v-if="can['document.edit']">Edit</button>
  <button v-if="can['document.delete']">Delete</button>
</template>
```

`lumo.permissions.checkAny(slugs)` and `checkAll(slugs)` return one boolean.

## A v-can directive

```ts
// src/auth/vCan.ts
import type { Directive } from 'vue';
import { lumo } from './lumoauth';

/** Hides the element until the permission check passes. Usage: v-can="'billing.manage'" */
export const vCan: Directive<HTMLElement, string> = {
  async mounted(el, binding) {
    const display = el.style.display;
    el.style.display = 'none';
    try {
      if (await lumo.permissions.check(binding.value)) el.style.display = display;
    } catch {
      // Stay hidden.
    }
  },
};
```

```ts
// src/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { vCan } from './auth/vCan';

createApp(App).use(router).directive('can', vCan).mount('#app');
```

The directive hides an element; it stays in the DOM. Use `v-if` with `usePermission` for content that must not render.

## Relationship and attribute checks

```ts
// src/auth/checks.ts
import { auth, lumo } from './lumoauth';

/** Is the signed-in user an editor of this document? */
export async function canEditDocument(documentId: string): Promise<boolean> {
  const sub = auth.user?.sub;
  if (!sub) return false;
  try {
    return await lumo.zanzibar.check({
      object: `document:${documentId}`,
      relation: 'editor',
      subject: `user:${sub}`,
    });
  } catch {
    return false;
  }
}

/** Does an attribute policy allow this action? The token needs the scope abac:read. */
export async function canExportReport(reportId: string): Promise<boolean> {
  try {
    return await lumo.abac.isAllowed('report', 'export', reportId);
  } catch {
    return false;
  }
}
```

- `object` and `subject` use the form `namespace:id`. The tuple in LumoAuth must name the user by the `sub` value.
- A relationship check about another user needs the scope `authz:check`; run it on a server.
- Tuples and policies are defined in the organization. Use `lumoauth-rebac` and `lumoauth-abac`.

## Sign in with a social provider

Add a function next to `signIn` in `src/auth/lumoauth.ts`. It differs only in the extra parameter.

```ts
/** Redirect straight to a social provider that the organization has set up. */
export async function signInWith(provider: 'google' | 'github' | 'microsoft' | 'facebook' | 'apple' | 'linkedin', returnTo = '/'): Promise<void> {
  const { url, codeVerifier, state: oauthState } = await session.buildAuthorizationUrl({ provider });
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, oauthState);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  window.location.assign(url);
}
```

For a provider that the organization has not set up, the user sees the hosted login page. The hosted login page already lists the enabled providers, so most apps need only `signIn()`. To set up providers use `lumoauth-login-methods`.

## Open the sign-up page

```ts
/** Open the registration page. The new user returns to the app signed in. */
export async function signUp(returnTo = '/'): Promise<void> {
  const { url, codeVerifier, state: oauthState } = await session.buildAuthorizationUrl({ prompt: 'create' });
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, oauthState);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  window.location.assign(url);
}
```

Add it to `src/auth/lumoauth.ts`. The callback is the same as for sign-in. When the organization or the application has turned self-registration off, LumoAuth shows the login page.

## Share the session across tabs

```ts
// src/auth/lumoauth.ts (changed lines)
import { AuthModule, LumoAuth, LumoAuthSession, localStorageAdapter, type UserInfo } from '@lumoauth/client';

const session = new LumoAuthSession({
  auth: authModule,
  redirectUri,
  scope: 'openid profile email',
  storage: localStorageAdapter(),
});
```

With `localStorageAdapter()` every tab reads the same tokens, and they stay on disk after the browser closes. With the default `sessionStorage`, a new tab starts signed out and signs in through the redirect; the user normally sees no login form, because the LumoAuth session still exists. Both stores can be read by any script on the page.

## Request more scopes

1. Add the scope under **Configuration → Allowed scopes** of the application in the portal and save.
2. Change the `scope` option of `LumoAuthSession`, for example `scope: 'openid profile email abac:read'`.
3. Sign out and sign in again.

`abac:read` is needed for `lumo.abac.*`, `authz:read` for `lumo.permissions.list()` and `listSlugs()`.

## Expose the state through Pinia

The auth module already exports reactive state. A store is only a convenience for apps that keep all state in Pinia.

```ts
// src/stores/auth.ts
import { computed } from 'vue';
import { defineStore } from 'pinia';
import { auth, signIn, signOut } from '../auth/lumoauth';

export const useAuthStore = defineStore('auth', () => {
  const isLoaded = computed(() => auth.isLoaded);
  const isSignedIn = computed(() => auth.isSignedIn);
  const user = computed(() => auth.user);
  return { isLoaded, isSignedIn, user, signIn, signOut };
});
```

Do not copy tokens into a store, and do not persist the store: the session object owns the tokens.

## Send the token with axios

```ts
// src/api.ts
import axios from 'axios';
import { getToken } from './auth/lumoauth';

export const api = axios.create({ baseURL: 'https://api.example.com' });

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});
```

Attach the interceptor to an instance with a fixed `baseURL`, not to the global `axios`, so the token goes to the app's own API only.

## Check the issuer on the callback

LumoAuth adds an `iss` parameter to the callback URL. Comparing it with the issuer of the organization protects an app that signs in with more than one authorization server. Read the expected value from the `issuer` field of `{base}/orgs/{slug}/api/v1/.well-known/openid-configuration`, and add this to `handleCallback()` before the code exchange:

```ts
const EXPECTED_ISSUER = 'https://app.lumoauth.dev/orgs/acme-corp/api/v1';

const iss = params.get('iss');
if (iss && iss !== EXPECTED_ISSUER) throw new Error('Unexpected issuer');
```

On a custom domain the issuer differs from this pattern; always copy it from the discovery document. Use `lumoauth-oauth-oidc` for the details.

## Production checklist

- Register `https://app.example.com/auth/callback`, the origin `https://app.example.com` and the post-logout URI `https://app.example.com/` on the application. Remove `localhost` entries from a production application.
- Build with the production values of the three `VITE_LUMOAUTH_*` variables.
- Configure the host to serve `index.html` for `/auth/callback` and every other client route.
- Keep the app on `https`.
- Enforce every permission in the API.
