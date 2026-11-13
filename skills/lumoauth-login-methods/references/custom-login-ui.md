# Custom login UI: magic link, email-first and password calls

Open this file only when the user wants the app to render its own sign-in form. The default and recommended path is the hosted login page: the app redirects to the authorization endpoint and the page shows every method that the organization has turned on.

All calls on this page are made from the browser to the LumoAuth origin. None of them needs or accepts a client secret or an API key. Never send one.

## Contents

- [Packages](#packages)
- [Social button in a custom UI](#social-button-in-a-custom-ui)
- [Email-first: `checkEmailExists` and `useEmailFirst`](#email-first-checkemailexists-and-useemailfirst)
- [Magic link: `requestMagicLink` and `useMagicLink`](#magic-link-requestmagiclink-and-usemagiclink)
- [Password: `loginWithPassword`](#password-loginwithpassword)
- [Raw endpoints](#raw-endpoints)

## Packages

| Package | What it provides | Requirement |
|---|---|---|
| `@lumoauth/client` | `AuthModule` with `requestMagicLink`, `checkEmailExists`, `loginWithPassword`, `buildAuthorizationUrl` | Node.js 18 or later for tooling |
| `@lumoauth/react` | `useMagicLink`, `useEmailFirst`, `useAuth` (inside `LumoAuthProvider`) | React 18 or later |

`@lumoauth/nextjs` re-exports `useMagicLink` and `useEmailFirst`.

```bash
npm install @lumoauth/client
```

```typescript
import { AuthModule } from '@lumoauth/client';

export const auth = new AuthModule({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'CLIENT_ID',
});
```

`clientId` is the public client ID of the application. Ask the user for it, or read it with `lumo apps list`. The React hooks need the app to be wrapped in `LumoAuthProvider` with `domain`, `orgId` and `clientId`. Use `lumoauth-react` for that setup.

## Social button in a custom UI

`buildAuthorizationUrl` accepts extra parameters. Pass `provider` to go straight to one provider. Store the returned `codeVerifier` and `state` until the callback, as for any PKCE sign-in.

```typescript
import { AuthModule } from '@lumoauth/client';

const auth = new AuthModule({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'CLIENT_ID',
});

export async function signInWithGoogle(): Promise<void> {
  const { url, codeVerifier, state } = await auth.buildAuthorizationUrl({
    redirectUri: 'http://localhost:3000/callback',
    scope: 'openid profile email',
    extraParams: { provider: 'google' },
  });
  sessionStorage.setItem('pkce_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);
  window.location.href = url;
}
```

In React, the context does the same and stores the PKCE values itself:

```tsx
import { useAuth } from '@lumoauth/react';

export function GoogleButton() {
  const { signInWithSocial } = useAuth();
  return (
    <button type="button" onClick={() => signInWithSocial('google')}>
      Continue with Google
    </button>
  );
}
```

The `provider` hint is accepted for `google`, `github`, `microsoft`, `facebook`, `apple` and `linkedin`.

## Email-first: `checkEmailExists` and `useEmailFirst`

`checkEmailExists(email)` posts to `POST /orgs/{orgId}/check-email` and resolves to an `EmailCheckResult`:

| Field | Type | Meaning |
|---|---|---|
| `exists` | `boolean` | Always `true` from the server. It says nothing about the address. `false` only when the request failed or was rate limited. |
| `hasPushDevice` | `boolean` | `true` when the address belongs to an active account with an active push device and the MFA policy allows push at sign-in |
| `hasPasskey` | `boolean` | Always `false`. Show a passkey button when `passkeyEnabled` is `true`. |
| `magicLinkEnabled` | `boolean` | Organization setting |
| `passkeyEnabled` | `boolean` | Organization setting |
| `passwordEnabled` | `boolean` | Organization setting |
| `maskedEmail` | `string` or `undefined` | Empty. Show the address that the user typed. |
| `pushInitiateUrl`, `pushStatusUrl`, `pushLoginUrl` | `string` or `undefined` | Present only when `hasPushDevice` is `true` |

The answer is the same for every address in the organization except `hasPushDevice`. Do not use it to tell a new user from an existing one. Offer sign-up from a separate link.

The method does not throw. On a network error, a `429` or another failure it resolves to an object with every flag `false`. Treat that as "fall back to the hosted login page".

```typescript
import { AuthModule } from '@lumoauth/client';

const auth = new AuthModule({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'CLIENT_ID',
});

export type NextStep = 'hosted' | 'choose-method';

export async function afterEmail(email: string): Promise<NextStep> {
  const result = await auth.checkEmailExists(email);
  if (!result.exists) {
    return 'hosted';
  }
  return 'choose-method';
}
```

In React, `useEmailFirst()` returns `{ checkEmail, isLoading, result, exists, reset }`. `checkEmail(email)` resolves to the full `EmailCheckResult` object, not to a boolean. Read `.exists` or the method flags from it.

```tsx
import { useState, type FormEvent } from 'react';
import { useEmailFirst } from '@lumoauth/react';

export function EmailStep({ onContinue }: { onContinue: (email: string, magicLink: boolean) => void }) {
  const [email, setEmail] = useState('');
  const { checkEmail, isLoading } = useEmailFirst();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await checkEmail(email);
    onContinue(email, result.magicLinkEnabled);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" disabled={isLoading}>Continue</button>
    </form>
  );
}
```

## Magic link: `requestMagicLink` and `useMagicLink`

These calls need version 1.5.0 or later of the JavaScript SDK. Earlier versions post to the form endpoint of the hosted page, which refuses them, and no email is sent.

`requestMagicLink({ email, returnTo?, captchaToken? })` posts JSON to `POST /orgs/{orgId}/api/v1/oauth/magic-link` with `email`, the configured `client_id` and, when set, `return_to` and `captcha_token`. It resolves to `{ sent: true }` when the server accepts the request. It throws `LumoAuthApiError` when the server refuses it (`code` is the reason) and `LumoAuthNetworkError` when the request cannot be made.

`useMagicLink()` returns `{ sendMagicLink, isLoading, isSent, error, errorCode, reset }`. `sendMagicLink(email, returnTo?, { captchaToken? }?)` calls `requestMagicLink`. Without `returnTo`, the user returns to the page that the form is on, and `LumoAuthProvider` finishes the sign-in there. With your own `returnTo`, call `signIn()` on that page.

```tsx
import { useState } from 'react';
import { useMagicLink } from '@lumoauth/react';

export function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const { sendMagicLink, isLoading, isSent, error, reset } = useMagicLink();

  if (isSent) {
    return (
      <div>
        <p>Check your inbox for a sign-in link.</p>
        <button type="button" onClick={reset}>Use a different email</button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void sendMagicLink(email); }}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" disabled={isLoading}>Send sign-in link</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

Limits that the agent must respect:

- The endpoint answers `404` with `magic_link_disabled` when magic link login is off for the organization.
- `sent: true` and `isSent` do not prove that an email was sent. The server gives the same answer for every address, known or not.
- A request from a browser must come from an origin that is listed under **Browser CORS origins** of the application. Otherwise the server answers `403` with `origin_not_allowed`.
- `returnTo` is an absolute `https` URL (`http` only on `localhost`) of at most 1,024 characters. Its origin must be a listed origin or the origin of a redirect URI of the application. Otherwise the server answers `400` with `invalid_return_to`.
- The link signs the user in at LumoAuth, not in the app. The app gets its tokens from the normal authorization request that it starts on the `returnTo` page. That request completes without a login page.
- When the organization has a CAPTCHA on the magic link step, render the widget in the form and pass its token as `captchaToken`. Without it the server answers `400` with `captcha_required`.

## Password: `loginWithPassword`

`loginWithPassword({ email, password })` posts JSON to `POST /orgs/{orgId}/api/v1/oauth/login/json` with the browser's cookies. It establishes the same browser session as the hosted page. It never returns tokens. After `complete`, continue the normal PKCE flow: the authorization endpoint issues a code without showing the login page.

It resolves to `{ status, challengeUrl? }` and does not throw. Handle every status that the server sends:

| `status` | Meaning | What the app does |
|---|---|---|
| `complete` | Signed in | Start the PKCE authorization redirect |
| `mfa_required` | A second factor is needed | Send the browser to `challengeUrl` on the LumoAuth origin |
| `invalid_credentials` | Wrong password, unknown address or locked account | Show one generic message |
| `blocked`, `inactive` | The account cannot sign in | Show a generic message |
| `rate_limited` | Too many attempts | Ask the user to wait |
| `captcha_required` | The organization requires a CAPTCHA | Use the hosted login page |
| `password_expired` | The password must be changed | Use the hosted login page |
| `invalid_request`, `not_found` | Bad body or unknown organization | Fix the call |
| `error` | Network failure (set by the SDK) | Retry or use the hosted page |

The app's origin must be in the application's allowed origins. Never log the password or keep it after the call.

## Raw endpoints

For a stack without the JavaScript SDK. All are relative to the region base URL.

| Endpoint | Body | Response |
|---|---|---|
| `POST /orgs/{orgId}/check-email` | Form: `email` | JSON: `exists`, `has_push_device`, `has_passkey`, `magic_link_enabled`, `passkey_enabled`, `password_enabled`, `masked_email`, `sso_url`, and the `push_*_url` fields when push is available. `429` when rate limited. |
| `POST /orgs/{orgId}/api/v1/oauth/magic-link` | JSON: `email`, `client_id`, optional `return_to` and `captcha_token` | JSON: `{"status": "sent"}`. An error answers with `error` and `message` |
| `POST /orgs/{orgId}/api/v1/oauth/login/json` | JSON: `email`, `password` | JSON: `status`, and `challenge_url` when `status` is `mfa_required` |

`sso_url` is set when an enterprise connection claims the email domain. Send the browser there instead of showing a password field. See `lumoauth-enterprise-sso`.

Docs: https://docs.lumoauth.dev/user-guide/authentication/magic-link and https://docs.lumoauth.dev/oauth/authorize
