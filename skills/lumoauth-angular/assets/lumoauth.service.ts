import { Injectable, signal } from '@angular/core';
import { AuthModule, LumoAuth, LumoAuthSession, type UserInfo } from '@lumoauth/client';
import { lumoauthConfig } from './lumoauth.config';

const VERIFIER_KEY = 'lumoauth_pkce_verifier';
const STATE_KEY = 'lumoauth_pkce_state';
const RETURN_TO_KEY = 'lumoauth_return_to';

@Injectable({ providedIn: 'root' })
export class LumoAuthService {
  private readonly redirectUri = `${window.location.origin}/auth/callback`;

  private readonly authModule = new AuthModule({
    baseUrl: lumoauthConfig.baseUrl,
    orgId: lumoauthConfig.orgId,
    clientId: lumoauthConfig.clientId,
  });

  // Stores tokens (sessionStorage by default), refreshes the access token before it
  // expires and keeps tabs in sync.
  private readonly session = new LumoAuthSession({
    auth: this.authModule,
    redirectUri: this.redirectUri,
    scope: lumoauthConfig.scope,
  });

  /** Client for authorization checks. It sends the current access token. */
  readonly client = new LumoAuth({
    baseUrl: lumoauthConfig.baseUrl,
    orgId: lumoauthConfig.orgId,
    clientId: lumoauthConfig.clientId,
    token: async () => (await this.session.getToken()) ?? '',
  });

  private readonly loaded = signal(false);
  private readonly signedIn = signal(false);
  private readonly profile = signal<UserInfo | null>(null);
  private readonly lastError = signal<string | null>(null);

  readonly isLoaded = this.loaded.asReadonly();
  readonly isSignedIn = this.signedIn.asReadonly();
  readonly user = this.profile.asReadonly();
  readonly error = this.lastError.asReadonly();

  /** Resolves when stored tokens are loaded. Await it before the first auth decision. */
  readonly ready: Promise<void>;

  constructor() {
    this.session.subscribe(() => this.sync());
    this.ready = this.session.hydrate();
  }

  /** A valid access token, or null when nobody is signed in. */
  getToken(): Promise<string | null> {
    return this.session.getToken();
  }

  /** Redirect to the hosted login page. `returnTo` is a path in this app. */
  async signIn(returnTo: string = window.location.pathname + window.location.search): Promise<void> {
    const { url, codeVerifier, state } = await this.session.buildAuthorizationUrl();
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    window.location.assign(url);
  }

  /** Finish sign-in on the callback route. Returns the path to open next. */
  async handleCallback(): Promise<string> {
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

    const tokens = await this.authModule.exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: this.redirectUri,
    });
    await this.session.adopt(tokens);

    return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  }

  /** Revoke the tokens, clear the local session and end the LumoAuth session. */
  async signOut(returnTo = '/'): Promise<void> {
    const { accessToken, refreshToken, idToken } = this.session.getTokens();
    if (refreshToken) {
      await this.authModule.revokeToken(refreshToken, accessToken ?? undefined, {
        tokenTypeHint: 'refresh_token',
      });
    } else if (accessToken) {
      await this.authModule.revokeToken(accessToken, accessToken);
    }
    await this.session.clearSession(null, { emit: false });
    window.location.replace(
      this.authModule.buildEndSessionUrl({
        idTokenHint: idToken ?? undefined,
        postLogoutRedirectUri: new URL(returnTo, window.location.origin).toString(),
      }),
    );
  }

  /** RBAC check for the signed-in user. False when signed out or on any error. */
  async can(permission: string): Promise<boolean> {
    await this.ready;
    if (!this.signedIn()) return false;
    try {
      return await this.client.permissions.check(permission);
    } catch {
      return false;
    }
  }

  private sync(): void {
    const snapshot = this.session.getSnapshot();
    this.loaded.set(snapshot.isLoaded);
    this.signedIn.set(snapshot.isSignedIn);
    this.lastError.set(snapshot.error);
    if (!snapshot.isSignedIn) {
      this.profile.set(null);
      this.client.clearCache();
    } else if (!this.profile()) {
      void this.loadUser();
    }
  }

  private async loadUser(): Promise<void> {
    const token = await this.session.getToken();
    if (!token) return;
    try {
      this.profile.set(await this.authModule.getUserInfo(token));
    } catch {
      // A failed profile request does not end the session.
    }
  }
}
