# @lumoauth/react: storage, scopes, checks, sign-in variants and theming

Secondary topics for `@lumoauth/react` 1.4.0. The main path is in `SKILL.md`.

## Contents

- [Choose where tokens are stored](#choose-where-tokens-are-stored)
- [Request more scopes](#request-more-scopes)
- [Use the LumoAuth client directly](#use-the-lumoauth-client-directly)
- [Relationship and attribute checks](#relationship-and-attribute-checks)
- [Social sign-in buttons](#social-sign-in-buttons)
- [Sign-up](#sign-up)
- [Magic link and email-first](#magic-link-and-email-first)
- [Your own email and password form](#your-own-email-and-password-form)
- [Theming](#theming)
- [Production checklist](#production-checklist)

## Choose where tokens are stored

Adapters are exported by `@lumoauth/client` (installed with `@lumoauth/react`; add it as a direct dependency when you import from it).

| Adapter | Readable by a script on the page | Survives reload | Shared across tabs |
|---|---|---|---|
| `sessionStorageAdapter()` (browser default) | yes | yes, in the same tab | no |
| `localStorageAdapter()` | yes | yes, also after a browser restart | yes |
| `memoryStorageAdapter()` | in memory only | no | no |
| `cookieStorageAdapter(options?)` | no | yes | yes |

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LumoAuthProvider } from '@lumoauth/react';
import { localStorageAdapter } from '@lumoauth/client';
import App from './App';

// Create the adapter once, at module level. A new adapter in each render rebuilds the session.
const storage = localStorageAdapter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LumoAuthProvider
      domain={import.meta.env.VITE_LUMOAUTH_DOMAIN}
      orgId={import.meta.env.VITE_LUMOAUTH_ORG_ID}
      clientId={import.meta.env.VITE_LUMOAUTH_CLIENT_ID}
      storage={storage}
    >
      <App />
    </LumoAuthProvider>
  </React.StrictMode>,
);
```

Guidance:

- Keep the default for most apps. A new tab then starts signed out and signs in again through the redirect; the user normally sees no login form, because the LumoAuth session still exists.
- Use `localStorageAdapter()` when users expect one session in every tab. Tokens then stay on disk until sign-out.
- `cookieStorageAdapter()` keeps tokens in an httpOnly cookie. It needs a server on the same origin that runs the code exchange and the refresh and serves a session endpoint and a logout endpoint. `@lumoauth/nextjs` provides that server side; use `lumoauth-nextjs`.
- For another store, implement the `TokenStorage` interface: `name`, `get()`, `set(tokens)`, `clear()` and an optional `subscribe(onExternalChange)`.

With `crossTab` (default `true`), a refresh in one tab is sent to the other tabs, and only one tab refreshes. LumoAuth rotates refresh tokens: each refresh returns a new refresh token, and the old one stops working.

## Request more scopes

The provider requests `openid profile email`. Most checks need nothing more.

| Call | Scope on the user's token |
|---|---|
| `usePermission`, `<Protect permission>`, `permissions.check`, `checkBulk`, `checkAny`, `checkAll` | none |
| `<Protect zanzibar>` and `useZanzibar` about the signed-in user | none |
| `useAbac`, `<Protect abac>`, `abac.check`, `abac.isAllowed`, `abac.getMyAttributes` | `abac:read` |
| `permissions.list()`, `permissions.listSlugs()` | `authz:read` |
| A relationship check about another subject | `authz:check` |

To request a scope:

1. Add it under **Configuration → Allowed scopes** of the application in the portal and save.
2. Add it to the provider: `scope="openid profile email abac:read"`.
3. Sign out and sign in again.

A missing scope makes the hooks return `allowed: false`. A direct client call throws `LumoAuthPermissionDeniedError`; its `requiredScopes` lists the missing scopes.

## Use the LumoAuth client directly

`useLumoAuth()` returns a `LumoAuth` client that sends the session's access token. Use it for checks that the hooks do not cover.

```tsx
// src/components/DocumentActions.tsx
import { useEffect, useState } from 'react';
import { useLumoAuth, useSession } from '@lumoauth/react';

export function DocumentActions() {
  const lumo = useLumoAuth();
  const { isActive } = useSession();
  const [can, setCan] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    lumo.permissions
      .checkBulk(['document.edit', 'document.delete', 'document.share'])
      .then(({ results }) => {
        if (!cancelled) setCan(results);
      })
      .catch(() => {
        if (!cancelled) setCan({});
      });
    return () => {
      cancelled = true;
    };
  }, [lumo, isActive]);

  return (
    <>
      {can['document.edit'] && <button>Edit</button>}
      {can['document.delete'] && <button>Delete</button>}
      {can['document.share'] && <button>Share</button>}
    </>
  );
}
```

| Call | Returns |
|---|---|
| `lumo.permissions.check(slug, context?)` | `Promise<boolean>` |
| `lumo.permissions.checkBulk(slugs, context?)` | `Promise<{ results: Record<string, boolean> }>` |
| `lumo.permissions.checkAny(slugs)`, `checkAll(slugs)` | `Promise<boolean>` |
| `lumo.permissions.listSlugs()` | `Promise<Set<string>>`; needs `authz:read` |
| `lumo.zanzibar.check({ object, relation, subject })` | `Promise<boolean>` |
| `lumo.abac.isAllowed(resourceType, action, resourceId?)` | `Promise<boolean>`; needs `abac:read` |
| `lumo.abac.check({ resourceType, action, resourceId?, context? })` | `Promise<{ allowed, reason, matchedPolicies, ... }>`; needs `abac:read` |
| `lumo.clearCache()` | Clears cached permission results |

The client caches `permissions.check` results in memory for 5 minutes. Call `lumo.clearCache()` after the user's roles or groups change.

Errors: `LumoAuthAuthenticationError` (401), `LumoAuthPermissionDeniedError` (403), `LumoAuthRateLimitError`, `LumoAuthNetworkError`, `LumoAuthValidationError`. All extend `LumoAuthError` and are exported by `@lumoauth/client`.

## Relationship and attribute checks

```tsx
// src/components/DocumentEditor.tsx
import { Protect, useUser, useZanzibar } from '@lumoauth/react';

export function DocumentEditor({ documentId }: { documentId: string }) {
  return (
    <Protect
      zanzibar={{ object: `document:${documentId}`, relation: 'editor' }}
      fallback={<p>Read only</p>}
    >
      <textarea />
    </Protect>
  );
}

export function OwnerBadge({ documentId }: { documentId: string }) {
  const user = useUser();
  const { allowed } = useZanzibar({
    object: `document:${documentId}`,
    relation: 'owner',
    subject: `user:${user?.sub ?? 'unknown'}`,
  });
  return allowed ? <span>Owner</span> : null;
}

export function ExportButton() {
  return (
    <Protect abac={{ resourceType: 'report', action: 'export' }}>
      <button>Export</button>
    </Protect>
  );
}
```

- `<Protect zanzibar>` without `subject` asks about `user:{sub}` of the signed-in user. The relationship tuple in LumoAuth must name the user by that `sub` value.
- `useZanzibar` needs `subject`.
- Relationship tuples and policies are defined in the organization. Use `lumoauth-rebac` and `lumoauth-abac`.

## Social sign-in buttons

The hosted login page already shows the social providers that the organization has turned on. To show buttons inside the app, list the providers yourself; the card cannot read which ones are enabled.

```tsx
// src/pages/SignInPage.tsx
import { SignIn } from '@lumoauth/react';

export default function SignInPage() {
  return <SignIn socialProviders={['google', 'github']} signUpUrl="/sign-up" />;
}
```

Each button starts the PKCE redirect with a `provider` parameter, so the user goes straight to that provider. LumoAuth accepts `google`, `github`, `microsoft`, `facebook`, `apple` and `linkedin`. For a provider that the organization has not set up, the user sees the hosted login page. The same redirect is available as `useAuth().signInWithSocial('google')`. To set up providers use `lumoauth-login-methods`.

## Sign-up

The hosted login page has a sign-up link when the organization allows self-registration. A user who registers there continues into the app. For most apps the sign-in redirect is therefore enough for both cases.

`<SignUp />` and `useAuth().signUp()` open the registration page of the organization directly. That request carries no PKCE challenge and no `state`, so do not rely on it to bring the new user back into the app.

To open the registration page directly and return to the app signed in, start a normal authorization request with `prompt=create`:

```tsx
// src/components/CreateAccountButton.tsx
import { useAuth, useLumoAuth } from '@lumoauth/react';

export function CreateAccountButton() {
  const lumo = useLumoAuth();
  const { config } = useAuth();

  async function start() {
    const { url, codeVerifier, state } = await lumo.auth.buildAuthorizationUrl({
      redirectUri: config.redirectUri ?? `${window.location.origin}/auth/callback`,
      scope: 'openid profile email',
      extraParams: { prompt: 'create' },
    });
    // The provider reads these two keys on the callback (version 1.4.0).
    sessionStorage.setItem('lumoauth_pkce_verifier', codeVerifier);
    sessionStorage.setItem('lumoauth_pkce_state', state);
    window.location.assign(url);
  }

  return <button onClick={start}>Create account</button>;
}
```

`<AuthCallback>` then completes the flow as for a sign-in. When the organization or the application has turned self-registration off, LumoAuth shows the login page. Check the two storage keys again after an SDK upgrade.

## Magic link and email-first

The hosted login page offers magic link and email-first sign-in when the organization has turned them on, with no code in the app. Use the hooks only for a custom screen. To turn the methods on use `lumoauth-login-methods`.

```tsx
// src/components/MagicLinkForm.tsx
import { useState, type FormEvent } from 'react';
import { useMagicLink } from '@lumoauth/react';

export function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const { sendMagicLink, isLoading, isSent, error, reset } = useMagicLink();

  if (isSent) {
    return (
      <div>
        <p>If an account exists for {email}, a sign-in link is on its way.</p>
        <button onClick={reset}>Use another email</button>
      </div>
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMagicLink(email);
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Sending…' : 'Send sign-in link'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

The response never tells whether the account exists. Word the confirmation the same way.

The hook needs `@lumoauth/react` 1.5.0 or later, magic link login turned on for the organization, and the origin of the app under **Browser CORS origins** of the application. The user opens the link, confirms on the LumoAuth page and returns to the page with the form. `LumoAuthProvider` then finishes the sign-in by itself. When the server refuses the request, `error` holds the message and `errorCode` the reason, for example `origin_not_allowed` or `captcha_required`.

`useEmailFirst().checkEmail(email)` returns an `EmailCheckResult`:

| Field | Type | Meaning |
|---|---|---|
| `exists` | `boolean` | `true` when LumoAuth answered, for every address. It does not say whether the address has an account. `false` when the check was not available. |
| `passwordEnabled`, `passkeyEnabled`, `magicLinkEnabled` | `boolean` | Methods that the organization has turned on |
| `hasPasskey`, `hasPushDevice` | `boolean` | Always `false`. The answer is the same for every address. |
| `maskedEmail` | `undefined` | Never set |

The check needs a version of `@lumoauth/react` later than 1.5.0 and the origin of the app under **Browser CORS origins** of the application.

```tsx
// src/components/EmailStep.tsx
import { useState, type FormEvent } from 'react';
import { useAuth, useEmailFirst } from '@lumoauth/react';

export function EmailStep() {
  const [email, setEmail] = useState('');
  const { checkEmail, isLoading, result } = useEmailFirst();
  const { signIn } = useAuth();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await checkEmail(email);
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" disabled={isLoading}>Continue</button>
      {result && <button type="button" onClick={() => signIn()}>Continue to sign-in</button>}
    </form>
  );
}
```

`checkEmail` resolves to an object, not a boolean: read `.exists`. It never throws for a network failure or an unknown address; every flag is then `false`, and the screen falls back to the hosted login page.

## Your own email and password form

The supported way to keep a custom form is `auth.loginWithPassword()` followed by the normal PKCE redirect. The call creates a LumoAuth session and returns no tokens. `signIn()` then returns from the authorization endpoint without showing the login page.

```tsx
// src/components/PasswordForm.tsx
import { useState, type FormEvent } from 'react';
import { useAuth, useLumoAuth } from '@lumoauth/react';

export function PasswordForm() {
  const lumo = useLumoAuth();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const result = await lumo.auth.loginWithPassword({ email, password });
    if (result.status === 'complete') {
      await signIn();
    } else if (result.status === 'mfa_required' && result.challengeUrl) {
      window.location.assign(result.challengeUrl);
    } else {
      setMessage('Sign-in failed. Check the email and password and try again.');
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit">Sign in</button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
```

- `status` is one of `complete`, `mfa_required`, `invalid_credentials`, `blocked`, `inactive`, `rate_limited`, `invalid_request`, `error`. Show one generic message for every failure.
- The request is sent with `credentials: 'include'` to the LumoAuth origin, so the app origin must be under **Browser CORS origins**.
- The flow depends on a session cookie that the browser stores for the LumoAuth origin from a cross-site request. Test it in every browser that the app supports. Prefer the redirect to the hosted login page when in doubt.
- Never store or log the password.

## Theming

Every ready-made component (`SignIn`, `SignUp`, `UserButton`, `UserAvatar`, `UserProfile`) accepts `appearance`.

```tsx
// src/pages/SignInPage.tsx
import { SignIn } from '@lumoauth/react';

export default function SignInPage() {
  return (
    <SignIn
      appearance={{
        theme: 'dark',
        className: 'my-sign-in',
        variables: { '--la-primary': '#0f62fe', '--la-radius-md': '4px' },
      }}
    />
  );
}
```

| Option | Type | Description |
|---|---|---|
| `theme` | `'light' \| 'dark'` | Forces a theme for this component. Without it the component follows a theme attribute on an ancestor, and otherwise the system setting. |
| `className` | `string` | Extra class on the root element of the component |
| `variables` | `Record<string, string>` | CSS custom properties, set on the root element of the component |

CSS custom properties that the stylesheet defines:

| Group | Properties |
|---|---|
| Brand | `--la-primary`, `--la-primary-hover`, `--la-primary-text`, `--la-link` |
| Surfaces | `--la-bg`, `--la-bg-subtle`, `--la-bg-muted`, `--la-bg-hover`, `--la-border`, `--la-border-focus`, `--la-overlay`, `--la-card-shadow` |
| Text | `--la-text`, `--la-text-secondary`, `--la-text-muted` |
| States | `--la-danger`, `--la-danger-bg`, `--la-success`, `--la-success-bg` |
| Shape | `--la-radius-sm`, `--la-radius-md`, `--la-radius-lg`, `--la-radius-xl`, `--la-radius-full` |
| Type | `--la-font-family`, `--la-font-size-sm`, `--la-font-size-base`, `--la-font-size-lg`, `--la-font-size-xl`, `--la-font-size-2xl` |

To theme all components at once, set the properties in the app's stylesheet:

```css
:root {
  --la-primary: #0f62fe;
  --la-primary-hover: #0043ce;
  --la-font-family: 'Inter', sans-serif;
}
```

To follow the app's own theme switch in place of the system setting, set `data-lumoauth-theme="dark"` or `data-lumoauth-theme="light"` on the `<html>` element, or on any element that wraps the components. The classes `la-dark` and `la-light` do the same. On version 1.4.1 or older, a light theme inside a dark system setting needs the attribute on `<html>`.

The styles are injected at runtime in a `<style id="lumoauth-react-styles">` tag. Class names start with `la-`. A Content Security Policy must allow that inline style element.

These options style the components inside the app. The hosted login page is styled in the portal; use `lumoauth-branding`.

## Production checklist

- Register the production redirect URI `https://app.example.com/auth/callback`, the origin `https://app.example.com` and the post-logout URI `https://app.example.com/` on the application. Remove `localhost` entries from a production application.
- Build with the production values of the three configuration variables.
- Serve `index.html` for `/auth/callback` and every other client route.
- Keep the app on `https`.
- Enforce every permission in the API, not only in `<Protect>`.
