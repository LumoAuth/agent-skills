import { reactive, readonly } from 'vue';
import { AuthModule, LumoAuth, LumoAuthSession, type UserInfo } from '@lumoauth/client';

const baseUrl = import.meta.env.VITE_LUMOAUTH_DOMAIN as string;
const orgId = import.meta.env.VITE_LUMOAUTH_ORG_ID as string;
const clientId = import.meta.env.VITE_LUMOAUTH_CLIENT_ID as string;
const redirectUri = `${window.location.origin}/auth/callback`;

const VERIFIER_KEY = 'lumoauth_pkce_verifier';
const STATE_KEY = 'lumoauth_pkce_state';
const RETURN_TO_KEY = 'lumoauth_return_to';

const authModule = new AuthModule({ baseUrl, orgId, clientId });

// Stores tokens (sessionStorage by default), refreshes the access token before it
// expires and keeps tabs in sync.
const session = new LumoAuthSession({
  auth: authModule,
  redirectUri,
  scope: 'openid profile email',
});

/** Client for permission checks. It sends the current access token. */
export const lumo = new LumoAuth({
  baseUrl,
  orgId,
  clientId,
  token: async () => (await session.getToken()) ?? '',
});

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: UserInfo | null;
  error: string | null;
}

const state = reactive<AuthState>({ isLoaded: false, isSignedIn: false, user: null, error: null });

/** Read-only reactive state for templates and computed values. */
export const auth = readonly(state);

async function loadUser(): Promise<void> {
  const token = await session.getToken();
  if (!token) return;
  try {
    state.user = await authModule.getUserInfo(token);
  } catch {
    // A failed profile request does not end the session.
  }
}

session.subscribe(() => {
  const snapshot = session.getSnapshot();
  state.isLoaded = snapshot.isLoaded;
  state.isSignedIn = snapshot.isSignedIn;
  state.error = snapshot.error;
  if (!snapshot.isSignedIn) {
    state.user = null;
    lumo.clearCache();
  } else if (!state.user) {
    void loadUser();
  }
});

/** Resolves when stored tokens are loaded. Await it before the first auth decision. */
export const ready: Promise<void> = session.hydrate();

/** A valid access token, or null when nobody is signed in. */
export function getToken(): Promise<string | null> {
  return session.getToken();
}

/** Redirect to the hosted login page. `returnTo` is a path in this app. */
export async function signIn(returnTo: string = window.location.pathname + window.location.search): Promise<void> {
  const { url, codeVerifier, state: oauthState } = await session.buildAuthorizationUrl();
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, oauthState);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  window.location.assign(url);
}

/** Finish sign-in on the callback route. Returns the path to open next. */
export async function handleCallback(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
  const savedState = sessionStorage.getItem(STATE_KEY);
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? '/';
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);

  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') ?? error);

  const code = params.get('code');
  if (!code || !codeVerifier || !savedState || params.get('state') !== savedState) {
    throw new Error('Invalid sign-in callback');
  }

  const tokens = await authModule.exchangeCodeForTokens({ code, codeVerifier, redirectUri });
  await session.adopt(tokens);

  return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
}

/** Revoke the tokens, clear the local session and end the LumoAuth session. */
export async function signOut(returnTo = '/'): Promise<void> {
  const { accessToken, refreshToken, idToken } = session.getTokens();
  if (refreshToken) {
    await authModule.revokeToken(refreshToken, accessToken ?? undefined, { tokenTypeHint: 'refresh_token' });
  } else if (accessToken) {
    await authModule.revokeToken(accessToken, accessToken);
  }
  await session.clearSession(null, { emit: false });
  window.location.replace(
    authModule.buildEndSessionUrl({
      idTokenHint: idToken ?? undefined,
      postLogoutRedirectUri: new URL(returnTo, window.location.origin).toString(),
    }),
  );
}
