# React Native recipes for LumoAuth

Secondary patterns on top of the auth module from `SKILL.md` (`auth/lumoauth.ts`, copied from `assets/lumoauth.ts`).

## Contents

- [Gate the whole app behind sign-in](#gate-the-whole-app-behind-sign-in)
- [Check several permissions in one request](#check-several-permissions-in-one-request)
- [Relationship and attribute checks](#relationship-and-attribute-checks)
- [Sign in with a social provider](#sign-in-with-a-social-provider)
- [Open the sign-up page](#open-the-sign-up-page)
- [Request more scopes](#request-more-scopes)
- [Refresh when the app returns to the foreground](#refresh-when-the-app-returns-to-the-foreground)
- [Bare React Native](#bare-react-native)
- [How the flow works](#how-the-flow-works)
- [Production checklist](#production-checklist)

## Gate the whole app behind sign-in

```tsx
// auth/RequireAuth.tsx
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Button, View } from 'react-native';
import { signIn, useAuth } from './lumoauth';

/** Renders children for a signed-in user and a sign-in button for everyone else. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

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
  return <>{children}</>;
}
```

Wrap the root navigator or a group of screens in `<RequireAuth>`. `useAuth()` reads one shared session, so the hook can be used in any number of components.

## Check several permissions in one request

```tsx
// components/DocumentActions.tsx
import { useEffect, useState } from 'react';
import { Button, View } from 'react-native';
import { lumo, useAuth } from '../auth/lumoauth';

export function DocumentActions() {
  const { isSignedIn } = useAuth();
  const [can, setCan] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isSignedIn) {
      setCan({});
      return;
    }
    let cancelled = false;
    lumo.permissions
      .checkBulk(['document.edit', 'document.delete'])
      .then(({ results }) => {
        if (!cancelled) setCan(results);
      })
      .catch(() => {
        if (!cancelled) setCan({});
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  return (
    <View>
      {can['document.edit'] && <Button title="Edit" onPress={() => {}} />}
      {can['document.delete'] && <Button title="Delete" onPress={() => {}} />}
    </View>
  );
}
```

The client caches `permissions.check` results in memory for 5 minutes. `signOut()` in the module clears the cache.

## Relationship and attribute checks

Add these functions to `auth/lumoauth.ts`:

```ts
/** Is this user in the relation to the object? Example: ('document:doc-123', 'editor', user.sub). */
export async function hasRelation(object: string, relation: string, sub: string): Promise<boolean> {
  try {
    return await lumo.zanzibar.check({ object, relation, subject: `user:${sub}` });
  } catch {
    return false;
  }
}

/** Does an attribute policy allow the action? The token needs the scope abac:read. */
export async function isAllowed(resourceType: string, action: string, resourceId?: string): Promise<boolean> {
  try {
    return await lumo.abac.isAllowed(resourceType, action, resourceId);
  } catch {
    return false;
  }
}
```

- Pass `user.sub` from `useAuth()` as `sub`. `object` and `subject` use the form `namespace:id`.
- A relationship check about another user needs the scope `authz:check`; run it on a server.
- Tuples and policies are defined in the organization. Use `lumoauth-rebac` and `lumoauth-abac`.

## Sign in with a social provider

The hosted login page lists the providers that the organization has turned on, so most apps need only `signIn()`. To go straight to one provider, give `signIn` an optional parameter in `auth/lumoauth.ts`:

```ts
export type SocialProvider = 'google' | 'github' | 'microsoft' | 'facebook' | 'apple' | 'linkedin';

export async function signIn(provider?: SocialProvider): Promise<boolean> {
  const { url, codeVerifier, state } = await session.buildAuthorizationUrl(
    provider ? { provider } : undefined,
  );

  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if (result.type !== 'success') return false;

  const error = queryParam(result.url, 'error');
  if (error) throw new Error(queryParam(result.url, 'error_description') ?? error);

  const code = queryParam(result.url, 'code');
  if (!code || queryParam(result.url, 'state') !== state) {
    throw new Error('Invalid sign-in callback');
  }

  const tokens = await authModule.exchangeCodeForTokens({ code, codeVerifier, redirectUri: REDIRECT_URI });
  await session.adopt(tokens);
  return true;
}
```

This replaces the `signIn` function of the module. For a provider that the organization has not set up, the user sees the hosted login page. To set up providers use `lumoauth-login-methods`.

## Open the sign-up page

The same function with `{ prompt: 'create' }` in place of `{ provider }` opens the registration page of the organization. The new user returns to the app signed in. When the organization or the application has turned self-registration off, LumoAuth shows the login page.

## Request more scopes

1. Add the scope under **Configuration → Allowed scopes** of the application in the portal and save.
2. Change the `scope` option of `LumoAuthSession` in `auth/lumoauth.ts`, for example `scope: 'openid profile email abac:read'`.
3. Sign out and sign in again.

`abac:read` is needed for `lumo.abac.*`, `authz:read` for `lumo.permissions.list()` and `listSlugs()`.

## Refresh when the app returns to the foreground

The session schedules a refresh with a timer. A timer does not run while the app is in the background. `getToken()` covers this case: it refreshes first when the token has expired or expires within 30 seconds. To update the interface as soon as the app is active again:

```tsx
// auth/useForegroundRefresh.ts
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getToken } from './lumoauth';

/** Call once in the root component. */
export function useForegroundRefresh(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getToken();
    });
    return () => subscription.remove();
  }, []);
}
```

When the refresh token is no longer valid, the session ends and `useAuth()` returns `isSignedIn: false` with `error: 'refresh_failed'`. Show the sign-in button again.

## Bare React Native

The LumoAuth documentation describes the Expo setup and names one replacement for a project without Expo: store tokens with `react-native-keychain` in place of `expo-secure-store`. Keep the `TokenStorage` shape of the asset file (`name`, `get`, `set`, `clear`) and change only the three storage calls.

The asset file also uses `expo-web-browser` for the browser session and `polyfills.ts` uses `expo-crypto` for random bytes. Ask the user before you add Expo modules to a bare project or replace them with other libraries. Any replacement must keep these properties: the login page opens in the system browser, the result returns through the registered redirect URI, and the random bytes come from the operating system.

## How the flow works

1. `session.buildAuthorizationUrl()` creates a PKCE verifier, its S256 challenge and a random `state`, and returns the URL of `{base}/orgs/{slug}/api/v1/oauth/authorize`.
2. `WebBrowser.openAuthSessionAsync(url, 'myapp://auth/callback')` opens the system browser. The user signs in on the hosted login page.
3. LumoAuth redirects to `myapp://auth/callback?code=...&state=...`. The operating system hands the URL to the app, and the promise resolves with it.
4. The module compares `state`, then `authModule.exchangeCodeForTokens()` posts the code and the verifier to the token endpoint. No client secret is sent.
5. `session.adopt()` stores the access token, the refresh token and the ID token in the keystore and schedules the refresh.
6. LumoAuth rotates refresh tokens. Each refresh returns a new refresh token, and the session stores it.
7. `signOut()` revokes the refresh token, clears the keystore and opens `{base}/orgs/{slug}/api/v1/oauth/logout` with the ID token, so the browser session ends too.

## Production checklist

- Use a separate OAuth application for the production app, with only the production redirect URI and post-logout redirect URI.
- Choose a scheme that is unlikely to collide with another app, for example the reverse domain name `com.example.app`. The redirect URI is then `com.example.app://auth/callback`; register exactly that string.
- Keep PKCE required on the application.
- Do not ship a client secret, an API key or test credentials in the bundle.
- Enforce every permission in the API.
