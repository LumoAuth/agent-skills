---
name: lumoauth-react-native
description: >-
  Adds LumoAuth sign-in, sign-out, token refresh and permission checks to a React Native or
  Expo mobile app. Uses the @lumoauth/client package (AuthModule, LumoAuthSession, LumoAuth)
  with expo-web-browser for the system browser, a custom URI scheme deep link as the redirect
  URI, expo-secure-store for token storage, and the OAuth 2.0 authorization code flow with
  PKCE for a public native client without a client secret. Use when the user asks to add
  login, authentication, OpenID Connect, secure token storage, a deep-link callback or RBAC
  checks to a React Native, Expo, iOS or Android app, or mentions @lumoauth/client together
  with Expo, expo-auth-session, expo-secure-store or EXPO_PUBLIC_LUMOAUTH_* variables. For
  React web apps use lumoauth-react.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for React Native and Expo

LumoAuth has no React Native package. A mobile app uses `@lumoauth/client` for the protocol and Expo modules for the device: the system browser shows the hosted login page, a custom URI scheme brings the result back to the app, and the device keystore holds the tokens. The flow is the OAuth 2.0 authorization code flow with PKCE. A mobile app is a public client: it has no client secret.

## When to use

- The project is an Expo app (SDK 49 or newer) or a React Native app that has the Expo modules installed.
- The user wants sign-in, sign-out, a stored session that survives an app restart, an access token for API calls, or permission checks.

Do not use this skill when:

- The app is a React web app. Use `lumoauth-react`. Its components render HTML and do not run in React Native.
- The user wants the approval app for push sign-in. That is a LumoAuth product feature; use `lumoauth-mfa-passkeys`.
- The task is the API that receives the token. Use `lumoauth-api-protection`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | **Organization slug** on the portal's **Get started** page, or `lumo whoami` |
| OAuth client ID | `client_...` | The application's **Credentials** tab in the portal, or `lumo apps list` |
| URI scheme of the app | `myapp` | `expo.scheme` in `app.json`. Ask the user when it is not set. |

**The OAuth application.** Create one for the mobile app; do not reuse the application of a web app.

1. Open `{base}/orgs/{slug}/portal/applications` and click **New application**.
2. Enter an **Application name** and choose **Single-page or mobile app**. This creates a public client that requires PKCE and has no client secret.
3. Enter the **Redirect URI** `myapp://auth/callback` (with the app's own scheme) and click **Create application**.
4. On the **Configuration** tab, add `myapp://auth/signed-out` under **Logout → Post-logout redirect URIs**. Under **Application metadata**, set **Application type** to **Native application (mobile / desktop)**. Click **Save configuration**.

Redirect URIs match exactly. A native app needs no entry under **Browser CORS origins**. Do not create the application with `lumo apps create`: that command creates a confidential client.

## Steps

### 1. Install

```bash
npm install @lumoauth/client
npx expo install expo-web-browser expo-secure-store expo-crypto
```

### 2. Register the URI scheme

```json
{
  "expo": {
    "scheme": "myapp"
  }
}
```

Merge the `scheme` key into the existing `app.json`. The scheme must be the one in the registered redirect URI. A custom scheme needs a development build or a production build of the app (`npx expo run:ios`, `npx expo run:android`); rebuild the native app after you change the scheme.

### 3. Set the configuration values

```bash
# .env
EXPO_PUBLIC_LUMOAUTH_DOMAIN=https://app.lumoauth.dev
EXPO_PUBLIC_LUMOAUTH_ORG_ID=acme-corp
EXPO_PUBLIC_LUMOAUTH_CLIENT_ID=your-client-id
```

The three values are public. Never add a client secret or an API key (`lmk_...`) to a mobile app: everything in the app bundle can be extracted.

### 4. Check the runtime

`@lumoauth/client` uses these globals: `fetch`, `URLSearchParams`, `TextEncoder`, `btoa` and `crypto.getRandomValues`. Add this file and import it before any other import in the app entry file.

```ts
// polyfills.ts
import * as ExpoCrypto from 'expo-crypto';

type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array };
const scope = globalThis as unknown as { crypto?: CryptoLike } & Record<string, unknown>;

// PKCE needs secure random bytes. Use the device's generator when the runtime has none.
if (!scope.crypto) scope.crypto = {};
if (typeof scope.crypto.getRandomValues !== 'function') {
  scope.crypto.getRandomValues = (array) => ExpoCrypto.getRandomValues(array);
}

for (const name of ['fetch', 'URLSearchParams', 'TextEncoder', 'btoa']) {
  if (typeof scope[name] === 'undefined') {
    throw new Error(`@lumoauth/client needs the global "${name}". Add a polyfill for it before this check.`);
  }
}
```

```ts
// index.ts (or the first line of app/_layout.tsx with Expo Router)
import './polyfills';
```

The file changes nothing on a runtime that already has the globals. When the check throws, add a polyfill for the named global above the loop. Never replace `crypto.getRandomValues` with `Math.random`.

### 5. Add the auth module

Copy [assets/lumoauth.ts](assets/lumoauth.ts) from this skill to `auth/lumoauth.ts` in the app. Read the file first; it is the whole integration. Change the scheme in `REDIRECT_URI` and `POST_LOGOUT_REDIRECT_URI` to the app's scheme. It exports:

| Export | Purpose |
|---|---|
| `useAuth()` | Hook that returns `{ isLoaded, isSignedIn, user, error }` and re-renders when the session changes |
| `signIn()` | Opens the hosted login page in the system browser, checks `state`, exchanges the code with the PKCE verifier, stores the tokens. Returns `false` when the user closes the browser. |
| `signOut()` | Revokes the tokens, clears the keystore and ends the LumoAuth session in the system browser |
| `getToken()` | A valid access token, or `null` when nobody is signed in. Refreshes first when the token expires within 30 seconds. |
| `can(permission)` | RBAC check for the signed-in user. `false` when signed out or on any error. |
| `lumo` | A `LumoAuth` client for other checks |
| `ready` | Promise that resolves when the stored tokens are loaded |

Inside, the module creates an `AuthModule`, a `LumoAuthSession` whose `storage` is a `TokenStorage` object backed by `expo-secure-store`, and a `LumoAuth` client whose `token` function returns `session.getToken()`. `LumoAuthSession` refreshes the access token with the refresh token, so the user stays signed in across app restarts.

Keep these properties when you adapt the file:

- Tokens go to `expo-secure-store` only. Not to `AsyncStorage`, not to component state that is persisted.
- The PKCE verifier and `state` stay in memory for the duration of one sign-in.
- The login page opens in the system browser through `WebBrowser.openAuthSessionAsync`. Do not load it in a `WebView`: an embedded view can read what the user types, and it does not share the browser's existing sign-in.

### 6. Use it in a screen

```tsx
// app/index.tsx (or any screen component)
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, View } from 'react-native';
import { can, signIn, signOut, useAuth } from '../auth/lumoauth';

export default function HomeScreen() {
  const { isLoaded, isSignedIn, user } = useAuth();
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isSignedIn) {
      setCanEdit(false);
      return;
    }
    void can('documents.edit').then((allowed) => {
      if (!cancelled) setCanEdit(allowed);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  async function onSignIn() {
    try {
      await signIn();
    } catch (e) {
      Alert.alert('Sign-in failed', e instanceof Error ? e.message : 'Try again.');
    }
  }

  if (!isLoaded) return <ActivityIndicator />;

  if (!isSignedIn) {
    return (
      <View>
        <Button title="Sign in" onPress={onSignIn} />
      </View>
    );
  }

  return (
    <View>
      <Text>Signed in as {user?.email ?? user?.sub ?? '…'}</Text>
      {canEdit && <Button title="Edit document" onPress={() => {}} />}
      <Button title="Sign out" onPress={() => void signOut()} />
    </View>
  );
}
```

`user` is the OpenID Connect UserInfo response: `sub`, `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture`. It is `null` for a moment after sign-in.

### 7. Call an API with the access token

```ts
// api.ts
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

Call `getToken()` for each request. The API must validate the token on every request: signature, issuer, audience, expiry and scopes. Use `lumoauth-api-protection`.

A permission check in the app hides interface elements. It does not protect data: the API must check the same permission again. Permissions and roles are defined in the organization; use `lumoauth-rbac`.

## Verify

1. Run `npx tsc --noEmit`. It reports no error.
2. Start a development build on a device or simulator (`npx expo run:ios` or `npx expo run:android`). The app starts without an error from `polyfills.ts`.
3. Tap **Sign in**. The system browser opens `{base}/orgs/{slug}/api/v1/oauth/authorize?...` and shows the login page of the organization.
4. Sign in. The browser closes, and the screen shows the user's email.
5. Close the app completely and open it again. The user is still signed in.
6. Tap **Sign out**. The browser opens and closes, and the screen shows **Sign in**. Tap **Sign in** again: the login page asks for credentials.
7. In the portal, **Audit logs** lists the sign-in, and the application's page shows the type **Mobile / native app**.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows a redirect URI error | `myapp://auth/callback` is not registered, or the scheme or path differs. | Register the exact URI. Use the same string in `REDIRECT_URI`. |
| The browser stays open after sign-in and the app never gets the result | The app does not handle the scheme: it runs in Expo Go, or the native app was not rebuilt after the scheme was set. | Set `expo.scheme`, then run a development build. |
| `Property 'crypto' doesn't exist` or `crypto.getRandomValues is not a function` | `polyfills.ts` is not imported first. | Import it on the first line of the entry file. |
| `Invalid sign-in callback` | The returned `state` differs from the one that this sign-in created. | Start sign-in again. Do not start two sign-ins at the same time. |
| The token request fails with `invalid_client` | The application is confidential. A mobile app sends no secret. | Create the application as **Single-page or mobile app**. |
| The user is signed out when the access token expires | The app stores `access_token` by hand and never uses the refresh token. | Use `LumoAuthSession` as in the asset file and read the token with `getToken()`. |
| The session is lost on every app start | `LumoAuthSession` was created without `storage`. The default adapters use web storage, which React Native does not have. | Pass the `expo-secure-store` storage object. |
| After sign-out, **Sign in** signs the same user in without a password | Only the local tokens were cleared. The system browser still has the LumoAuth session. | Use `signOut()` from the module and register the post-logout redirect URI. |
| After sign-out the browser stays on a LumoAuth page | `myapp://auth/signed-out` is not a post-logout redirect URI of the application. | Add it under **Configuration → Logout**. |
| `403` with `requiredScopes: ["abac:read"]` from `lumo.abac` | The token lacks the scope. | Add the scope to the `scope` option and to the application, then sign in again. |

## Security rules

- No client secret, API key or agent credential in the app.
- Use PKCE and compare `state` on every sign-in. The asset file does both.
- Store tokens only in the device keystore. Do not log tokens or the redirect URL.
- Use the system browser, never an embedded `WebView`, for the login page.
- Any app on the device can claim a custom URI scheme. PKCE keeps an intercepted code useless, so never turn PKCE off for the application.
- Send the access token only to the app's own API over `https`.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-api-protection`: validate the access token in the API that the app calls.
- `lumoauth-rbac`: define the roles and permissions that `can()` checks.
- `lumoauth-oauth-oidc`: the protocol details, and integration through another OpenID Connect library such as `expo-auth-session`.
- `lumoauth-login-methods`: social login, magic link and email-first on the hosted login page.
- `lumoauth-mfa-passkeys`: MFA and passkeys on the hosted login page.

## References

- [assets/lumoauth.ts](assets/lumoauth.ts): the auth module that step 5 copies into the app.
- [references/client-api.md](references/client-api.md): read it for the members of `LumoAuth`, `AuthModule` and `LumoAuthSession`, the `TokenStorage` interface, scopes and error classes.
- [references/recipes.md](references/recipes.md): read it for a protected navigation layout, bulk checks, relationship and attribute checks, social sign-in, sign-up, extra scopes, bare React Native and the production checklist.
- https://docs.lumoauth.dev/quickstarts/react-native
- https://docs.lumoauth.dev/tracks/frontend
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
