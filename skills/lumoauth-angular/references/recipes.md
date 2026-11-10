# Angular recipes for LumoAuth

Secondary patterns on top of `LumoAuthService` from `SKILL.md` (`src/app/auth/lumoauth.service.ts`).

## Contents

- [A structural permission directive](#a-structural-permission-directive)
- [Check several permissions in one request](#check-several-permissions-in-one-request)
- [Relationship and attribute checks](#relationship-and-attribute-checks)
- [Sign in with a social provider](#sign-in-with-a-social-provider)
- [Open the sign-up page](#open-the-sign-up-page)
- [Share the session across tabs](#share-the-session-across-tabs)
- [Request more scopes](#request-more-scopes)
- [Handle a 401 from the API](#handle-a-401-from-the-api)
- [Values for each environment](#values-for-each-environment)
- [Check the issuer on the callback](#check-the-issuer-on-the-callback)
- [Production checklist](#production-checklist)

## A structural permission directive

```ts
// src/app/auth/can.directive.ts
import { Directive, Input, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import { LumoAuthService } from './lumoauth.service';

/** Renders the element only when the signed-in user has the permission. */
@Directive({ selector: '[appCan]', standalone: true })
export class CanDirective {
  private readonly auth = inject(LumoAuthService);
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly view = inject(ViewContainerRef);
  private latest = 0;

  @Input({ required: true })
  set appCan(permission: string) {
    const request = ++this.latest;
    this.view.clear();
    void this.auth.can(permission).then((allowed) => {
      if (allowed && request === this.latest) {
        this.view.clear();
        this.view.createEmbeddedView(this.template);
      }
    });
  }
}
```

```ts
// src/app/toolbar.component.ts
import { Component } from '@angular/core';
import { CanDirective } from './auth/can.directive';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CanDirective],
  template: `<button type="button" *appCan="'billing.manage'">Open billing</button>`,
})
export class ToolbarComponent {}
```

## Check several permissions in one request

```ts
// src/app/document-actions.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { LumoAuthService } from './auth/lumoauth.service';

@Component({
  selector: 'app-document-actions',
  standalone: true,
  template: `
    @if (can()['document.edit']) {
      <button type="button">Edit</button>
    }
    @if (can()['document.delete']) {
      <button type="button">Delete</button>
    }
  `,
})
export class DocumentActionsComponent implements OnInit {
  private readonly auth = inject(LumoAuthService);
  readonly can = signal<Record<string, boolean>>({});

  async ngOnInit(): Promise<void> {
    await this.auth.ready;
    if (!this.auth.isSignedIn()) return;
    try {
      const { results } = await this.auth.client.permissions.checkBulk(['document.edit', 'document.delete']);
      this.can.set(results);
    } catch {
      this.can.set({});
    }
  }
}
```

`client.permissions.checkAny(slugs)` and `checkAll(slugs)` return one boolean.

## Relationship and attribute checks

Add these methods to `LumoAuthService`:

```ts
  /** Is the signed-in user in this relation to the object? Example: ('document:doc-123', 'editor'). */
  async hasRelation(object: string, relation: string): Promise<boolean> {
    await this.ready;
    const sub = this.user()?.sub;
    if (!sub) return false;
    try {
      return await this.client.zanzibar.check({ object, relation, subject: `user:${sub}` });
    } catch {
      return false;
    }
  }

  /** Does an attribute policy allow the action? The token needs the scope abac:read. */
  async isAllowed(resourceType: string, action: string, resourceId?: string): Promise<boolean> {
    await this.ready;
    if (!this.isSignedIn()) return false;
    try {
      return await this.client.abac.isAllowed(resourceType, action, resourceId);
    } catch {
      return false;
    }
  }
```

- `object` and `subject` use the form `namespace:id`. The tuple in LumoAuth must name the user by the `sub` value.
- `user()` is filled shortly after sign-in. `hasRelation` returns `false` until then.
- A relationship check about another user needs the scope `authz:check`; run it on a server.
- Tuples and policies are defined in the organization. Use `lumoauth-rebac` and `lumoauth-abac`.

## Sign in with a social provider

Add this method to `LumoAuthService`. It differs from `signIn` only in the extra parameter.

```ts
  /** Redirect straight to a social provider that the organization has set up. */
  async signInWith(
    provider: 'google' | 'github' | 'microsoft' | 'facebook' | 'apple' | 'linkedin',
    returnTo = '/',
  ): Promise<void> {
    const { url, codeVerifier, state } = await this.session.buildAuthorizationUrl({ provider });
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    window.location.assign(url);
  }
```

For a provider that the organization has not set up, the user sees the hosted login page. The hosted login page already lists the enabled providers, so most apps need only `signIn()`. To set up providers use `lumoauth-login-methods`.

## Open the sign-up page

```ts
  /** Open the registration page. The new user returns to the app signed in. */
  async signUp(returnTo = '/'): Promise<void> {
    const { url, codeVerifier, state } = await this.session.buildAuthorizationUrl({ prompt: 'create' });
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    window.location.assign(url);
  }
```

Add it to `LumoAuthService`. The callback is the same as for sign-in. When the organization or the application has turned self-registration off, LumoAuth shows the login page.

## Share the session across tabs

Change the import and the session in `lumoauth.service.ts`:

```ts
import { AuthModule, LumoAuth, LumoAuthSession, localStorageAdapter, type UserInfo } from '@lumoauth/client';
```

```ts
  private readonly session = new LumoAuthSession({
    auth: this.authModule,
    redirectUri: this.redirectUri,
    scope: lumoauthConfig.scope,
    storage: localStorageAdapter(),
  });
```

With `localStorageAdapter()` every tab reads the same tokens, and they stay on disk after the browser closes. With the default `sessionStorage`, a new tab starts signed out and signs in through the redirect; the user normally sees no login form, because the LumoAuth session still exists. Both stores can be read by any script on the page.

## Request more scopes

1. Add the scope under **Configuration → Allowed scopes** of the application in the portal and save.
2. Change `scope` in `lumoauth.config.ts`, for example `'openid profile email abac:read'`.
3. Sign out and sign in again.

`abac:read` is needed for `client.abac.*`, `authz:read` for `client.permissions.list()` and `listSlugs()`.

## Handle a 401 from the API

When the API rejects the token, send the user through sign-in again.

```ts
// src/app/auth/auth.interceptor.ts
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { lumoauthConfig } from './lumoauth.config';
import { LumoAuthService } from './lumoauth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(`${lumoauthConfig.apiBaseUrl}/`)) return next(req);

  const auth = inject(LumoAuthService);
  return from(auth.getToken()).pipe(
    switchMap((token) =>
      next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req),
    ),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        void auth.signIn();
      }
      return throwError(() => error);
    }),
  );
};
```

A `403` means that the user is signed in and lacks access. Show a message; do not start sign-in.

## Values for each environment

Projects that use Angular environment files keep the values there:

```ts
// src/environments/environment.ts
export const environment = {
  production: true,
  lumoauth: {
    baseUrl: 'https://app.lumoauth.dev',
    orgId: 'acme-corp',
    clientId: 'your-production-client-id',
    scope: 'openid profile email',
    apiBaseUrl: 'https://api.example.com',
  },
};
```

```ts
// src/app/auth/lumoauth.config.ts
import { environment } from '../../environments/environment';

export const lumoauthConfig = environment.lumoauth;
```

Create the files with `ng generate environments` when the project has none. Use a separate OAuth application for production, with only production URLs.

## Check the issuer on the callback

LumoAuth adds an `iss` parameter to the callback URL. Comparing it with the issuer of the organization protects an app that signs in with more than one authorization server. Read the expected value from the `issuer` field of `{base}/orgs/{slug}/api/v1/.well-known/openid-configuration`, and add this to `handleCallback()` before the code exchange:

```ts
    const expectedIssuer = 'https://app.lumoauth.dev/orgs/acme-corp/api/v1';
    const iss = params.get('iss');
    if (iss && iss !== expectedIssuer) throw new Error('Unexpected issuer');
```

On a custom domain the issuer differs from this pattern; always copy it from the discovery document. Use `lumoauth-oauth-oidc` for the details.

## Production checklist

- Register `https://app.example.com/auth/callback`, the origin `https://app.example.com` and the post-logout URI `https://app.example.com/` on the application. Remove `localhost` entries from a production application.
- Configure the host to serve `index.html` for `/auth/callback` and every other client route.
- Keep the app on `https`.
- Keep `apiBaseUrl` exact, so the interceptor sends the token to one origin.
- Enforce every permission in the API.
