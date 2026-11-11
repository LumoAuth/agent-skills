# @lumoauth/react components and hooks

Reference for `@lumoauth/react` 1.4.0. Peer dependencies: `react` and `react-dom` 18 or newer. `@lumoauth/nextjs` re-exports everything in this file, so the tables also apply to Next.js client components.

## Contents

- [LumoAuthProvider](#lumoauthprovider)
- [Sign-in components](#sign-in-components)
- [User components](#user-components)
- [Control components](#control-components)
- [Unstyled buttons](#unstyled-buttons)
- [Protect](#protect)
- [Hooks](#hooks)
- [The useAuth() value](#the-useauth-value)
- [LumoAuthUser](#lumoauthuser)
- [Exported types](#exported-types)

## LumoAuthProvider

Holds the session. Wrap the app once, above every LumoAuth component and hook.

| Prop | Type | Default | Description |
|---|---|---|---|
| `domain` | `string` | required | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `orgId` | `string` | required | Organization slug |
| `clientId` | `string` | required | OAuth client ID of a public client |
| `redirectUri` | `string` | `{origin}/auth/callback` | Callback URL. It must be registered on the application. |
| `scope` | `string` | `'openid profile email'` | Space-separated scopes for sign-in. The application must allow each scope. |
| `afterSignInUrl` | `string` | `'/'` | Where `<AuthCallback>` navigates after sign-in |
| `afterSignUpUrl` | `string` | none | Used by `<SignUpButton>` and as the default sign-up link of `<SignIn>` |
| `afterSignOutUrl` | `string` | `'/'` | Where LumoAuth returns after sign-out. Register `{origin}{afterSignOutUrl}` as a post-logout redirect URI. |
| `storage` | `TokenStorage` | `sessionStorage` in a browser, memory on a server | Where tokens are stored. Adapters come from `@lumoauth/client`. |
| `crossTab` | `boolean` | `true` | Share the session across tabs. One tab does each refresh. |
| `authStrategy` | `'pkce' \| 'password'` | `'pkce'` | Leave the default. The token endpoint does not offer the password grant. |
| `children` | `ReactNode` | required | The app |

Behavior:

- On mount the provider loads stored tokens. When the URL holds `code` and `state`, it completes the callback first, on any route.
- It refreshes the access token 60 seconds before expiry when the session has a refresh token.
- It loads the user from the OpenID Connect UserInfo endpoint after sign-in and after a reload.
- It injects the component styles in a `<style>` tag. No CSS import is needed.

## Sign-in components

### `<SignIn>`

Renders a sign-in card. The **Sign in with email** button redirects to the hosted login page. Renders nothing when the user is signed in.

| Prop | Type | Default | Description |
|---|---|---|---|
| `afterSignInUrl` | `string` | provider value, then `'/'` | Not used by the redirect flow; set `afterSignInUrl` on `<AuthCallback>` or the provider. |
| `signUpUrl` | `string` | provider `afterSignUpUrl`, then `'/sign-up'` | Target of the **Sign up** link in the card |
| `socialProviders` | `string[]` | `[]` | One button for each entry. Each button sends the user straight to that provider. |
| `appearance` | `AppearanceProps` | none | Theme, class name and CSS variables |

### `<SignUp>`

Renders a card with a **Create account** button that opens the registration page of the organization. Renders nothing when the user is signed in.

| Prop | Type | Default | Description |
|---|---|---|---|
| `afterSignUpUrl` | `string` | provider value, then `'/'` | Not used by the redirect flow |
| `signInUrl` | `string` | `'/sign-in'` | Target of the **Sign in** link in the card |
| `appearance` | `AppearanceProps` | none | |

### `<AuthCallback>`

Finishes sign-in on the callback route: reads `code` and `state` from the URL, compares `state` with the stored value, exchanges the code with the PKCE verifier, then sets `window.location.href` to the target. In React Strict Mode the exchange still runs once.

| Prop | Type | Default | Description |
|---|---|---|---|
| `afterSignInUrl` | `string` | provider `afterSignInUrl`, then `'/'` | Target after success. Only same-origin targets are accepted. |
| `loading` | `ReactNode` | a spinner card | Shown during the exchange |
| `error` | `ReactNode \| ((error: string) => ReactNode)` | an error card with a **Return home** button | Shown when sign-in fails |

## User components

### `<UserButton>`

Avatar button with a menu: the user's name and email, **Manage account** (opens `{domain}/account/profile`) and **Sign out**. Renders nothing when nobody is signed in.

| Prop | Type | Default | Description |
|---|---|---|---|
| `showName` | `boolean` | `false` | Show the display name next to the avatar |
| `afterSignOutUrl` | `string` | provider value, then `'/'` | Target after sign-out |
| `appearance` | `AppearanceProps` | none | |

### `<UserAvatar>`

The user's picture, or initials when there is no picture. Shows a placeholder icon when nobody is signed in.

| Prop | Type | Default |
|---|---|---|
| `size` | `number` (pixels) | `32` |
| `shape` | `'circle' \| 'square'` | `'circle'` |
| `appearance` | `AppearanceProps` | none |

### `<UserProfile>`

Profile card with account details, security status, roles and a sign-out action. The MFA row, the roles and the groups appear only when the UserInfo response holds the `mfa_enabled`, `roles` and `groups` claims (version 1.4.2 or newer; older versions show MFA as **Disabled** without the claim).

| Prop | Type | Default | Description |
|---|---|---|---|
| `mode` | `'full' \| 'compact'` | `'full'` | `compact` shows account details only |
| `afterSignOutUrl` | `string` | provider value, then `'/'` | |
| `appearance` | `AppearanceProps` | none | |

## Control components

| Component | Props | Behavior |
|---|---|---|
| `<SignedIn>` | `children` | Renders children when the session has loaded and the user is signed in |
| `<SignedOut>` | `children` | Renders children when the session has loaded and nobody is signed in |
| `<RedirectToSignIn>` | `signInUrl?` | Starts the sign-in redirect when it renders. Renders nothing. |

Both `<SignedIn>` and `<SignedOut>` render nothing while the session loads.

## Unstyled buttons

| Component | Props | Behavior |
|---|---|---|
| `<SignInButton>` | `children?`, `className?`, `signInUrl?` | Starts the sign-in redirect |
| `<SignUpButton>` | `children?`, `className?`, `signUpUrl?` | Navigates to `signUpUrl`, then the provider's `afterSignUpUrl`, then `/sign-up`. This is a route of the app. |
| `<SignOutButton>` | `children?`, `className?`, `afterSignOutUrl?` | Signs the user out |

With `children`, the component wraps them in a clickable `<span role="button">` and ignores `className`. Without `children`, it renders a `<button>` with `className` and a default label.

```tsx
import { SignInButton, SignOutButton } from '@lumoauth/react';

export function AuthButtons() {
  return (
    <>
      <SignInButton className="btn" />
      <SignOutButton afterSignOutUrl="/">
        <button className="btn">Log out</button>
      </SignOutButton>
    </>
  );
}
```

## Protect

Renders `children` when the check passes and `fallback` otherwise. Shows a spinner while the check runs. Pass one of `permission`, `zanzibar` or `abac`; with none of them it checks only that a user is signed in.

| Prop | Type | Description |
|---|---|---|
| `permission` | `string` | Permission slug, for example `billing.manage` |
| `zanzibar` | `{ object: string; relation: string; subject?: string }` | Relationship check. Without `subject` it asks about `user:{sub}` of the signed-in user. |
| `abac` | `{ resourceType: string; action: string; resourceId?: string }` | Attribute policy check. Needs the scope `abac:read`. |
| `fallback` | `ReactNode` | Shown when access is denied. Default: nothing. |
| `children` | `ReactNode` | Shown when access is granted |

When several check props are set, `permission` wins, then `zanzibar`, then `abac`.

## Hooks

Every hook must run under `<LumoAuthProvider>`.

| Hook | Returns |
|---|---|
| `useAuth()` | The full context value; see the next section |
| `useUser()` | `LumoAuthUser \| null` |
| `useSession()` | `{ isActive: boolean; isLoaded: boolean; getToken: () => Promise<string \| null>; status: 'loading' \| 'authenticated' \| 'unauthenticated' }` |
| `useSignIn()` | `{ signIn; signInWithRedirect; isLoading: boolean }` |
| `useLumoAuth()` | A `LumoAuth` client from `@lumoauth/client` that sends the session's access token |
| `usePermission(slug: string)` | `{ allowed: boolean; isLoading: boolean }` |
| `useZanzibar({ object, relation, subject })` | `{ allowed: boolean; isLoading: boolean }`. All three fields are required strings. |
| `useAbac({ resourceType, action, resourceId? })` | `{ allowed: boolean; isLoading: boolean }`. Needs the scope `abac:read`. |
| `useMagicLink()` | `{ sendMagicLink: (email: string, redirectUri?: string) => Promise<void>; isLoading: boolean; isSent: boolean; error: string \| null; reset: () => void }` |
| `useEmailFirst()` | `{ checkEmail: (email: string) => Promise<EmailCheckResult>; isLoading: boolean; result: EmailCheckResult \| null; exists: boolean \| null; reset: () => void }` |

The three check hooks return `allowed: false` while loading, when nobody is signed in, and when the request fails.

`object` and `subject` of a relationship check use the form `namespace:id`, for example `document:doc-123` and `user:5f0c...`. A check about a subject other than the caller needs the scope `authz:check`; run such checks on a server.

## The useAuth() value

| Field | Type | Description |
|---|---|---|
| `status` | `'loading' \| 'authenticated' \| 'unauthenticated'` | |
| `isLoaded` | `boolean` | The first session check has finished |
| `isSignedIn` | `boolean` | |
| `user` | `LumoAuthUser \| null` | `null` for a short time after `isSignedIn` turns `true`, until UserInfo returns |
| `signIn()` | `() => Promise<void> \| void` | Starts the sign-in redirect |
| `signInWithRedirect()` | `() => void` | Same redirect |
| `signInWithSocial(provider)` | `(provider: string) => void` | Redirect straight to a social provider |
| `signUp(params)` | `(params) => Promise<void>` | Opens the registration page of the organization |
| `signOut(options?)` | `(options?: { afterSignOutUrl?: string }) => Promise<void>` | Revokes the access token, clears the tokens and navigates to the LumoAuth logout endpoint. The promise does not resolve, because the page unloads. |
| `getToken()` | `() => Promise<string \| null>` | A valid access token; refreshes first when it expires within 30 seconds |
| `handleCallback()` | `() => Promise<void>` | The code exchange that `<AuthCallback>` runs |
| `sendMagicLink(email, redirectUri?)` | `Promise<void>` | Requests a magic link email |
| `checkEmail(email)` | `Promise<EmailCheckResult>` | Sign-in methods that the address can use |
| `config` | `{ domain; orgId; clientId; redirectUri?; afterSignInUrl?; afterSignUpUrl?; afterSignOutUrl? }` | The provider configuration |

Pass `signOut` to an event handler through a wrapper: `onClick={() => signOut()}`. A bare `onClick={signOut}` passes the click event as the options object.

## LumoAuthUser

Built from the UserInfo response.

| Field | Type | Source claim |
|---|---|---|
| `id` | `string \| number` | `sub` |
| `sub` | `string \| undefined` | `sub` |
| `email` | `string` | `email` (empty string when absent) |
| `emailVerified` | `boolean` | `email_verified` |
| `firstName`, `lastName` | `string \| undefined` | `given_name`, `family_name` |
| `displayName` | `string` | `name`, else first and last name, else the email |
| `avatarUrl` | `string \| undefined` | `picture` |
| `mfaEnabled` | `boolean` | `mfa_enabled` |
| `roles` | `string[]` | `roles` (empty when the response has no such claim) |
| `groups` | `string[]` | `groups` (empty when the response has no such claim) |
| `claims` | `Record<string, unknown>` | The whole UserInfo response |

Do not base access decisions on `user.roles` in the browser. Use `<Protect>` for display and check permissions on the server.

## Exported types

`LumoAuthProviderProps`, `LumoAuthUser`, `AuthState`, `AuthStatus`, `LumoAuthContextValue`, `SignInProps`, `SignUpProps`, `UserButtonProps`, `UserAvatarProps`, `UserProfileProps`, `ProtectProps`, `AppearanceProps`, `AuthCallbackProps`, `SignedInProps`, `SignedOutProps`, `SignInButtonProps`, `SignUpButtonProps`, `SignOutButtonProps`, `RedirectToSignInProps`, `UseMagicLinkReturn`, `UseEmailFirstReturn`, `LumoAuthConfig`.
