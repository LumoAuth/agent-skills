---
name: lumoauth-angular
description: >-
  Adds LumoAuth sign-in, sign-out, token refresh, route guards, an HTTP interceptor and
  permission checks to an Angular app with the @lumoauth/client package. Builds an injectable
  LumoAuthService with signals on the LumoAuth client, AuthModule and the LumoAuthSession
  runtime, a callback component for the OAuth 2.0 authorization code flow with PKCE,
  functional CanActivateFn guards for signed-in users and for permissions, and an
  HttpInterceptorFn that sends the access token to the app's API. Use when the user asks to
  add login, authentication, OpenID Connect, protected routes, a bearer token interceptor,
  role-based UI or RBAC checks to an Angular 17 or newer app with standalone components, or
  mentions @lumoauth/client together with Angular. For React use lumoauth-react; for Vue use
  lumoauth-vue.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Angular

LumoAuth has no Angular-specific package. An Angular app uses `@lumoauth/client` inside one injectable service: `AuthModule` runs the OAuth 2.0 authorization code flow with PKCE, `LumoAuthSession` stores the tokens and refreshes the access token, and the `LumoAuth` client runs permission checks with the user's token. This skill adds the service, a callback component, two guards and an HTTP interceptor.

## When to use

- The project is an Angular 17 or newer app with standalone components (`app.config.ts`, `app.routes.ts`) that renders in the browser.
- The user wants sign-in, sign-out, protected routes, a token on API requests, or permission-based UI.

Do not use this skill when:

- The app is React, Next.js or Vue. Use `lumoauth-react`, `lumoauth-nextjs` or `lumoauth-vue`.
- The app renders on a server (Angular SSR). The service below reads `window` and `sessionStorage` when it is created. Ask the user how they want to proceed.
- The task is the API that receives the token. Use `lumoauth-api-protection`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | The portal URL `/orgs/{slug}/portal`, or `lumo whoami` |
| OAuth client ID | `lumo_...` or `client_...` | `lumo apps list` (column **Client ID**), or the **Angular** tab of the portal's **Quickstarts** page |
| App origin | `http://localhost:4200`, `https://app.example.com` | The dev server port and the production URL |

**The OAuth application** must be a public client: PKCE required, no client secret. It needs three entries on its **Configuration** tab in the portal (`{base}/orgs/{slug}/portal/applications`):

| Setting | Value | Why |
|---|---|---|
| **Redirect URIs** | `{origin}/auth/callback` | LumoAuth returns the code here. The match is exact. |
| **Browser CORS origins** | `{origin}` | The browser calls the token endpoint. Without the origin the request is blocked right after sign-in. |
| **Logout → Post-logout redirect URIs** | `{origin}/` | LumoAuth returns here after sign-out. |

Every organization has a public client named **Starter App**. It allows the redirect URI and the origin for `http://localhost:5173` and `http://localhost:3000`, but not for the Angular default port 4200. Choose one:

- Run the dev server on an allowed port: `npx ng serve --port 5173`. Add only the post-logout redirect URI `http://localhost:5173/`.
- Keep port 4200 and add `http://localhost:4200/auth/callback`, the origin `http://localhost:4200` and the post-logout URI `http://localhost:4200/`, then click **Save configuration**.

To create a separate application, click **New application**, choose **Single-page or mobile app**, enter the redirect URI and click **Create application**. Do not create it with `lumo apps create`: that command creates a confidential client and cannot set the CORS origin.

## Steps

### 1. Install

```bash
npm install @lumoauth/client
```

### 2. Add the configuration

```ts
// src/app/auth/lumoauth.config.ts
// These values are public. They identify the app; they are not secrets.
export const lumoauthConfig = {
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'your-client-id',
  scope: 'openid profile email',
  /** The app's own API. The interceptor sends the access token only to this origin. */
  apiBaseUrl: 'https://api.example.com',
} as const;
```

When the project already uses `src/environments/environment.ts`, put the values there. Never add a client secret or an API key (`lmk_...`): everything in the bundle is readable.

### 3. Create the service

Copy [assets/lumoauth.service.ts](assets/lumoauth.service.ts) from this skill to `src/app/auth/lumoauth.service.ts` without changes. Read the file first; it is the whole integration. `LumoAuthService` is provided in root and has these members:

| Member | Purpose |
|---|---|
| `isLoaded()`, `isSignedIn()`, `user()`, `error()` | Read-only signals |
| `ready` | Promise that resolves when stored tokens are loaded. Await it before the first auth decision. |
| `signIn(returnTo?)` | Stores the PKCE verifier, `state` and the return path, then redirects to the hosted login page |
| `handleCallback()` | Checks `state`, exchanges the code, stores the tokens, returns the path to open next |
| `signOut(returnTo?)` | Revokes the tokens, clears the local session and ends the LumoAuth session |
| `getToken()` | A valid access token, or `null` when nobody is signed in |
| `can(permission)` | RBAC check for the signed-in user. `false` when signed out or on any error. |
| `client` | The `LumoAuth` client, for other checks |

Inside, the service creates an `AuthModule`, a `LumoAuthSession` on top of it, and a `LumoAuth` client whose `token` function returns `session.getToken()`.

`LumoAuthSession` keeps the tokens in `sessionStorage`, refreshes the access token 60 seconds before it expires and keeps tabs in sync. Do not replace it with code that stores `access_token` by hand: such code has no refresh.

What the service guarantees: `buildAuthorizationUrl()` creates the PKCE verifier, the S256 challenge and a random `state`; `handleCallback()` rejects a callback whose `state` differs from the stored value; the verifier is used once and then removed.

### 4. Add the callback component

```ts
// src/app/auth/callback.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LumoAuthService } from './lumoauth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (error()) {
      <p role="alert">Sign-in failed: {{ error() }} <a routerLink="/">Back to start</a></p>
    } @else {
      <p>Signing in…</p>
    }
  `,
})
export class CallbackComponent implements OnInit {
  private readonly auth = inject(LumoAuthService);
  private readonly router = inject(Router);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const returnTo = await this.auth.handleCallback();
      await this.router.navigateByUrl(returnTo, { replaceUrl: true });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign-in failed');
    }
  }
}
```

### 5. Add the guards

```ts
// src/app/auth/auth.guards.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LumoAuthService } from './lumoauth.service';

/** Lets signed-in users pass. Sends everyone else to the hosted login page. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(LumoAuthService);
  await auth.ready;
  if (auth.isSignedIn()) return true;
  await auth.signIn(state.url);
  return false;
};

/** Lets users pass who hold the permission. Use it after authGuard. */
export function permissionGuard(permission: string): CanActivateFn {
  return async () => {
    const auth = inject(LumoAuthService);
    const router = inject(Router);
    await auth.ready;
    if (!auth.isSignedIn()) return false;
    return (await auth.can(permission)) ? true : router.parseUrl('/forbidden');
  };
}
```

Call `inject()` before the first `await`, as above. After an `await` the injection context is gone.

```ts
// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './auth/auth.guards';
import { CallbackComponent } from './auth/callback.component';
import { BillingComponent } from './billing.component';
import { DashboardComponent } from './dashboard.component';
import { ForbiddenComponent } from './forbidden.component';
import { HomeComponent } from './home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'auth/callback', component: CallbackComponent },
  { path: 'forbidden', component: ForbiddenComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  {
    path: 'billing',
    component: BillingComponent,
    canActivate: [authGuard, permissionGuard('billing.manage')],
  },
];
```

### 6. Add the HTTP interceptor

```ts
// src/app/auth/auth.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { lumoauthConfig } from './lumoauth.config';
import { LumoAuthService } from './lumoauth.service';

/** Adds the access token to requests for the app's own API, and to no other request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(`${lumoauthConfig.apiBaseUrl}/`)) return next(req);

  const auth = inject(LumoAuthService);
  return from(auth.getToken()).pipe(
    switchMap((token) =>
      next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req),
    ),
  );
};
```

```ts
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideHttpClient(withInterceptors([authInterceptor]))],
};
```

Keep the providers that `app.config.ts` already has and add these two. `getToken()` refreshes the token first when it expires within 30 seconds. The API must validate the token on every request: signature, issuer, audience, expiry and scopes. Use `lumoauth-api-protection`.

### 7. Show the user, check a permission, sign out

```ts
// src/app/home.component.ts
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LumoAuthService } from './auth/lumoauth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!auth.isLoaded()) {
      <p>Loading…</p>
    } @else if (auth.isSignedIn()) {
      <p>Signed in as {{ auth.user()?.email }}</p>
      <a routerLink="/dashboard">Open the dashboard</a>
      <button type="button" (click)="auth.signOut()">Sign out</button>
    } @else {
      <button type="button" (click)="auth.signIn('/dashboard')">Sign in</button>
    }
  `,
})
export class HomeComponent {
  readonly auth = inject(LumoAuthService);
}
```

```ts
// src/app/dashboard.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { LumoAuthService } from './auth/lumoauth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `
    <h1>Welcome, {{ auth.user()?.name ?? auth.user()?.email }}</h1>
    @if (canEdit()) {
      <button type="button">Edit document</button>
    }
  `,
})
export class DashboardComponent implements OnInit {
  readonly auth = inject(LumoAuthService);
  readonly canEdit = signal(false);

  async ngOnInit(): Promise<void> {
    this.canEdit.set(await this.auth.can('documents.edit'));
  }
}
```

`auth.user()` is the OpenID Connect UserInfo response: `sub`, `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture`.

A permission check in the browser hides interface elements and routes. It does not protect data: the API must check the same permission again. Permissions and roles are defined in the organization; use `lumoauth-rbac`.

## Verify

1. Run `npx ng build`. It reports no error.
2. Run the dev server on the port that the application allows and open the app. The page shows **Sign in**.
3. Click it. The browser goes to `{base}/orgs/{slug}/api/v1/oauth/authorize?...` with `code_challenge_method=S256` and shows the login page.
4. Sign in. The browser returns to `/auth/callback?code=...&state=...` and then to `/dashboard`.
5. In the network panel, `POST .../oauth/token` returns `200` and its body has no `client_secret`.
6. Open `/dashboard` in a private window. The guard redirects to the login page, and after sign-in the browser returns to `/dashboard`.
7. Open `/billing` as a user without `billing.manage`. The app shows `/forbidden`.
8. A request to `https://api.example.com/...` through `HttpClient` carries `Authorization: Bearer ...`. A request to another origin does not.
9. Click **Sign out**. The browser returns to `/`. Opening `/dashboard` asks for sign-in again.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| CORS error on `/oauth/token` after sign-in | The app origin is not under **Browser CORS origins**. | Add `{origin}` (no path, no trailing slash) and save. |
| LumoAuth shows a redirect URI error | The app runs on port 4200 and the application allows another port, or the URI differs in scheme or path. | Register `{origin}/auth/callback` exactly, or run `npx ng serve --port 5173` with the Starter App. |
| `Invalid sign-in callback` | The callback was opened in another tab or opened twice, or the page was reloaded on the callback route. | Start sign-in again in one tab. |
| `NG0203: inject() must be called from an injection context` | A guard or the interceptor calls `inject()` after an `await`. | Call every `inject()` first. |
| The guard redirects to login right after a successful sign-in | The guard does not `await auth.ready`. | Keep the `await` before reading `isSignedIn()`. |
| After sign-out the browser stays on a LumoAuth page | `{origin}/` is not a post-logout redirect URI. | Add it under **Configuration → Logout**. |
| After sign-out, **Sign in** signs the same user in without a password | The app cleared only its own tokens. | Use `signOut()` from the service; it also ends the LumoAuth session. |
| The user is signed out about one hour after sign-in | The app stores `access_token` by hand and never refreshes it. | Use `LumoAuthSession` as in step 3 and read the token with `getToken()`. |
| No `Authorization` header on API requests | `provideHttpClient(withInterceptors([authInterceptor]))` is missing, or the request URL does not start with `apiBaseUrl`. | Register the interceptor and use absolute API URLs. |
| `403` with `requiredScopes: ["abac:read"]` from `client.abac` | The token lacks the scope. | Add the scope to `lumoauthConfig.scope` and to the application, then sign in again. |

## Security rules

- No client secret, API key or agent credential in the app.
- Always compare `state` on the callback, and use each PKCE verifier once.
- Do not log tokens or the callback URL. Do not put a token in a URL.
- The interceptor sends the token to one origin only. Do not widen that check to "every request".
- Tokens in `sessionStorage` can be read by any script on the page. Keep third-party scripts off pages that hold a session.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-api-protection`: validate the access token in the API that this app calls.
- `lumoauth-rbac`: define the roles and permissions that the guard and `can()` check.
- `lumoauth-oauth-oidc`: the protocol details behind this flow.
- `lumoauth-login-methods`: social login, magic link and email-first on the hosted login page.
- `lumoauth-branding`: style the hosted login page.

## References

- [assets/lumoauth.service.ts](assets/lumoauth.service.ts): the service that step 3 copies into the app.
- [references/client-api.md](references/client-api.md): read it for the members of `LumoAuth`, `AuthModule` and `LumoAuthSession`, the storage adapters, scopes and error classes.
- [references/recipes.md](references/recipes.md): read it for a structural permission directive, bulk checks, relationship and attribute checks, social sign-in, sign-up, shared sessions across tabs, a `401` from the API, environment files and the production checklist.
- https://docs.lumoauth.dev/quickstarts/angular
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
