import { useEffect, useState, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  AuthModule,
  EMPTY_TOKENS,
  LumoAuth,
  LumoAuthSession,
  type StoredTokens,
  type TokenStorage,
  type UserInfo,
} from '@lumoauth/client';

WebBrowser.maybeCompleteAuthSession();

const DOMAIN = process.env.EXPO_PUBLIC_LUMOAUTH_DOMAIN!.replace(/\/+$/, '');
const ORG_ID = process.env.EXPO_PUBLIC_LUMOAUTH_ORG_ID!;
const CLIENT_ID = process.env.EXPO_PUBLIC_LUMOAUTH_CLIENT_ID!;

// Both URIs use the scheme from app.json and must be registered on the OAuth application.
const REDIRECT_URI = 'myapp://auth/callback';
const POST_LOGOUT_REDIRECT_URI = 'myapp://auth/signed-out';

// ── Token storage in the device keystore ─────────────────────────────

const KEYS = {
  accessToken: 'lumoauth_access_token',
  refreshToken: 'lumoauth_refresh_token',
  idToken: 'lumoauth_id_token',
  expiresAt: 'lumoauth_expires_at',
} as const;

async function put(key: string, value: string | null): Promise<void> {
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

const secureTokenStorage: TokenStorage = {
  name: 'expo-secure-store',
  async get(): Promise<StoredTokens> {
    const [accessToken, refreshToken, idToken, expiresAt] = await Promise.all([
      SecureStore.getItemAsync(KEYS.accessToken),
      SecureStore.getItemAsync(KEYS.refreshToken),
      SecureStore.getItemAsync(KEYS.idToken),
      SecureStore.getItemAsync(KEYS.expiresAt),
    ]);
    if (!accessToken) return EMPTY_TOKENS;
    return { accessToken, refreshToken, idToken, expiresAt: expiresAt ? Number(expiresAt) : null };
  },
  async set(tokens: StoredTokens): Promise<void> {
    await Promise.all([
      put(KEYS.accessToken, tokens.accessToken),
      put(KEYS.refreshToken, tokens.refreshToken),
      put(KEYS.idToken, tokens.idToken),
      put(KEYS.expiresAt, tokens.expiresAt === null ? null : String(tokens.expiresAt)),
    ]);
  },
  async clear(): Promise<void> {
    await Promise.all(Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key)));
  },
};

// ── LumoAuth objects ─────────────────────────────────────────────────

const authModule = new AuthModule({ baseUrl: DOMAIN, orgId: ORG_ID, clientId: CLIENT_ID });

// Stores the tokens, refreshes the access token before it expires.
const session = new LumoAuthSession({
  auth: authModule,
  redirectUri: REDIRECT_URI,
  scope: 'openid profile email',
  storage: secureTokenStorage,
  crossTab: false,
});

/** Client for permission checks. It sends the current access token. */
export const lumo = new LumoAuth({
  baseUrl: DOMAIN,
  orgId: ORG_ID,
  clientId: CLIENT_ID,
  token: async () => (await session.getToken()) ?? '',
});

/** Resolves when stored tokens are loaded. */
export const ready: Promise<void> = session.hydrate();

/** A valid access token, or null when nobody is signed in. */
export function getToken(): Promise<string | null> {
  return session.getToken();
}

/** Read one query parameter from a deep link without the URL class. */
function queryParam(url: string, name: string): string | null {
  const query = url.split('#')[0].split('?')[1] ?? '';
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (decodeURIComponent(key) === name) return decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return null;
}

/**
 * Open the hosted login page in the system browser and finish the PKCE flow.
 * Returns false when the user closes the browser.
 */
export async function signIn(): Promise<boolean> {
  const { url, codeVerifier, state } = await session.buildAuthorizationUrl();

  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if (result.type !== 'success') return false;

  const error = queryParam(result.url, 'error');
  if (error) throw new Error(queryParam(result.url, 'error_description') ?? error);

  const code = queryParam(result.url, 'code');
  if (!code || queryParam(result.url, 'state') !== state) {
    throw new Error('Invalid sign-in callback');
  }

  const tokens = await authModule.exchangeCodeForTokens({
    code,
    codeVerifier,
    redirectUri: REDIRECT_URI,
  });
  await session.adopt(tokens);
  return true;
}

/** Revoke the tokens, clear the keystore and end the LumoAuth session in the system browser. */
export async function signOut(): Promise<void> {
  const { accessToken, refreshToken, idToken } = session.getTokens();
  if (refreshToken) {
    await authModule.revokeToken(refreshToken, accessToken ?? undefined, {
      tokenTypeHint: 'refresh_token',
    });
  } else if (accessToken) {
    await authModule.revokeToken(accessToken, accessToken);
  }
  await session.clearSession();
  lumo.clearCache();

  if (idToken) {
    const logoutUrl =
      `${DOMAIN}/orgs/${encodeURIComponent(ORG_ID)}/api/v1/oauth/logout` +
      `?id_token_hint=${encodeURIComponent(idToken)}` +
      `&post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT_REDIRECT_URI)}`;
    await WebBrowser.openAuthSessionAsync(logoutUrl, POST_LOGOUT_REDIRECT_URI);
  }
}

/** RBAC check for the signed-in user. False when signed out or on any error. */
export async function can(permission: string): Promise<boolean> {
  await ready;
  if (!session.getSnapshot().isSignedIn) return false;
  try {
    return await lumo.permissions.check(permission);
  } catch {
    return false;
  }
}

// ── React binding ────────────────────────────────────────────────────

export interface AuthValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  error: string | null;
  user: UserInfo | null;
}

/** Session state for components. Re-renders when the session changes. */
export function useAuth(): AuthValue {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (!snapshot.isSignedIn) {
      setUser(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await session.getToken();
      if (!token) return;
      try {
        const profile = await authModule.getUserInfo(token);
        if (!cancelled) setUser(profile);
      } catch {
        // A failed profile request does not end the session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot.isSignedIn]);

  return {
    isLoaded: snapshot.isLoaded,
    isSignedIn: snapshot.isSignedIn,
    error: snapshot.error,
    user,
  };
}
