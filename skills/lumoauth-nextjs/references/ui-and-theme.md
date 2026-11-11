# Interface: existing apps, theme and user components

Reference for the interface side of `@lumoauth/nextjs` 1.4.2 with the server session (`LumoAuthNextProvider`). The component props are in the `lumoauth-react` skill.

## Contents

- [Replace auth code that the app already has](#replace-auth-code-that-the-app-already-has)
- [Combine with an existing middleware](#combine-with-an-existing-middleware)
- [Which components work with the server session](#which-components-work-with-the-server-session)
- [Theme variables](#theme-variables)
- [Theme without shadcn/ui tokens](#theme-without-shadcnui-tokens)
- [Light and dark mode](#light-and-dark-mode)
- [The UserProfile card](#the-userprofile-card)
- [Render the profile on the server](#render-the-profile-on-the-server)
- [The account pages of LumoAuth](#the-account-pages-of-lumoauth)

## Replace auth code that the app already has

Apps from a template or an app builder often ship a sign-in screen that does nothing real. Keep what the user sees and replace what it does.

| The app has | Keep | Change |
|---|---|---|
| A sign-in page with an email and password form | The route, the layout, the heading, the styling | Remove the fields. Put one button in the same button style that links to `/api/auth/login?return_to=/path`. The LumoAuth login page asks for the credentials. |
| A **Sign in** button or link in the header | Its place and style | `href="/api/auth/login?return_to=/path"`. Use a plain `<a>`, not `<Link>`: the target is a route handler that redirects to another site. |
| A sign-up page or link | Its place and style | Point it to `/api/auth/login`. The login page of the organization links to registration when the organization allows it. |
| A **Sign out** button | Its place and style | A link to `/api/auth/logout`, or a form with `method="post"` and `action="/api/auth/logout"`. |
| A mock `AuthContext`, `useAuth()` or `useUser()` hook of the app | The components that read it, when the shape is simple | Delete the mock provider. Read `useUser()` from `@lumoauth/nextjs`, or keep the app's hook as a thin wrapper that maps `displayName`, `email` and `avatarUrl` to the field names that the components expect. |
| A hard-coded user (name, avatar) in a header or sidebar | The markup | Fill it from `currentUser()` in a server component, or from `useUser()` and `<UserAvatar>` in a client component. |
| An account, settings or profile page | The route and the layout | Fill it with the real user. Add what is missing from step 8 of `SKILL.md`: the picture, **Edit profile**, **Sign out**. Remove form fields that only pretended to save. |
| A guard such as `if (!user) redirect('/login')` | The intent | `protectPage({ returnTo })` in the page, and the path in `protect` of the middleware. Remove the mock check. |
| Tokens or a user in `localStorage` | Nothing | Delete the code. The session lives in the httpOnly cookie. |

Rules for new interface parts:

- Use the components of the project first: its `Button`, `Card`, `Avatar`, `DropdownMenu`, `Badge`. Use a LumoAuth component where the project has none.
- Copy class names and spacing from a page that exists. Do not add a colour, a font or a corner radius that the app does not use.
- Follow the file layout of the project: `components/` or `src/components/`, kebab-case or PascalCase file names, the import alias in `tsconfig.json`.
- Keep the text style of the app: the same capitalisation and the same language.

## Combine with an existing middleware

`lumoAuthMiddleware()` returns one function `(req: NextRequest) => Promise<NextResponse>`. Call it first and return its response. Add your own headers or cookies to that response. Do not create a second `NextResponse.next()`: the response of LumoAuth carries the refreshed session.

```ts
// proxy.ts (Next.js 16+) or middleware.ts (Next.js 14, 15)
import type { NextRequest } from 'next/server';
import { lumoAuthMiddleware } from '@lumoauth/nextjs/server';

const lumoAuth = lumoAuthMiddleware({ protect: ['/profile/:path*', '/dashboard/:path*'] });

export default async function proxy(req: NextRequest) {
  const res = await lumoAuth(req);

  // A redirect to sign-in: return it unchanged.
  if (res.headers.has('location')) return res;

  // The logic that the app had before, applied to the same response.
  res.headers.set('x-app-version', '1');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

When the existing middleware must itself redirect or rewrite (locales, feature flags), run that part before `lumoAuth(req)` and return early for those requests.

## Which components work with the server session

| Component or hook | With `LumoAuthNextProvider` |
|---|---|
| `<SignedIn>`, `<SignedOut>` | Yes |
| `<UserButton>`, `<UserAvatar>`, `<UserProfile>` | Yes |
| `<SignOutButton>`, `signOut()` | Yes. A link to `/api/auth/logout` does the same with less code. |
| `useUser()`, `useAuth()`, `useSession()` | Yes. `useUser()` returns `null` until the session has loaded; check `isLoaded` from `useAuth()`. |
| `<Protect>`, `usePermission()`, `useAbac()`, `useZanzibar()` | Yes, for hiding interface parts only |
| `<SignIn>`, `<SignInButton>`, `<RedirectToSignIn>`, `signIn()`, `<AuthCallback>` | No. They sign in from the browser, which cannot write the httpOnly cookie. Link to `/api/auth/login`. |

`useUser()` returns a `LumoAuthUser`: `id`, `sub`, `email`, `emailVerified`, `displayName`, `firstName`, `lastName`, `avatarUrl`, `roles`, `groups`, `mfaEnabled`, `claims`. With the default scopes `openid profile email`, rely on the name fields, `email`, `emailVerified` and `avatarUrl`. `avatarUrl` is the `picture` claim: the photo that the user set on the account page, or the one from a social sign-in. It is `undefined` when the account has none.

## Theme variables

Every ready-made component accepts `appearance={{ variables, className, theme }}`. `variables` is set as inline style on the root element of the component, so it wins over the defaults.

| Group | Variables |
|---|---|
| Brand | `--la-primary`, `--la-primary-hover`, `--la-primary-text`, `--la-link` |
| Surfaces | `--la-bg`, `--la-bg-subtle`, `--la-bg-muted`, `--la-bg-hover`, `--la-border`, `--la-border-focus`, `--la-card-shadow` |
| Text | `--la-text`, `--la-text-secondary`, `--la-text-muted` |
| States | `--la-danger`, `--la-danger-bg`, `--la-success`, `--la-success-bg` |
| Shape | `--la-radius-sm`, `--la-radius-md`, `--la-radius-lg`, `--la-radius-xl`, `--la-radius-full` |
| Type | `--la-font-family`, `--la-font-size-sm`, `--la-font-size-base`, `--la-font-size-lg` |

Notes:

- `--la-font-family: inherit` makes the components use the font of the app.
- `<UserAvatar>` and `<UserButton>` draw the initials in `--la-primary-text` on `--la-primary`. Map both, so that the initials can be read in a theme whose primary colour is light.

## Theme without shadcn/ui tokens

Find where the app defines its colours and map the same roles.

| The project has | Where to look | Value to write |
|---|---|---|
| shadcn/ui with Tailwind CSS 4 | `:root` and `.dark` in `app/globals.css`, values such as `oklch(...)` | `var(--primary)` |
| shadcn/ui with Tailwind CSS 3 | `:root` in `app/globals.css`, values such as `222 47% 11%` | `hsl(var(--primary))` |
| Its own CSS custom properties | `:root` in the global stylesheet | `var(--name-of-the-token)` |
| Tailwind CSS with a custom palette and no CSS variables | `theme.extend.colors` in `tailwind.config`, or `@theme` in the stylesheet | The colour value itself, for example `#0f62fe` |
| Plain CSS or CSS modules with fixed colours | The stylesheet of the header and the buttons | The colour values that those rules use |

A minimal mapping for an app with fixed colours:

```ts
// lib/lumoauth-appearance.ts
import type { AppearanceProps } from '@lumoauth/nextjs';

export const lumoAppearance: AppearanceProps = {
  variables: {
    '--la-font-family': 'inherit',
    '--la-primary': '#0f62fe',
    '--la-primary-hover': '#0043ce',
    '--la-primary-text': '#ffffff',
    '--la-link': '#0f62fe',
    '--la-bg': '#ffffff',
    '--la-bg-muted': '#f4f4f4',
    '--la-bg-hover': '#e8e8e8',
    '--la-border': '#e0e0e0',
    '--la-text': '#161616',
    '--la-text-secondary': '#525252',
    '--la-radius-md': '4px',
  },
};
```

Take each value from the stylesheet of the app. Do not invent a palette.

## Light and dark mode

Without a choice the components follow `prefers-color-scheme` of the operating system, not the theme of the app. A light app on a computer in dark mode gets dark components. Choose the theme in one of these ways:

| Way | How | Use it when |
|---|---|---|
| Map the variables to the tokens of the app | Step 7 of `SKILL.md` | The app has theme tokens. The tokens change with the theme of the app, so the components follow it. Prefer this. |
| Attribute on the page | `data-lumoauth-theme="light"` or `"dark"` on `<html>` or on any element that wraps the components. The classes `la-light` and `la-dark` do the same. | The app has a theme switch and no tokens to map. Set the attribute where the app sets its own theme. |
| One component | `appearance={{ theme: 'light' }}` | The app has one fixed theme |

## The UserProfile card

`<UserProfile>` is a ready-made card: picture or initials, name, email address with a **Verified** badge, and a **Sign out** button. Use it for a small account panel, or when the user wants no custom page.

```tsx
'use client';

import { UserProfile } from '@lumoauth/nextjs';
import { lumoAppearance } from '@/lib/lumoauth-appearance';

export function AccountCard() {
  return <UserProfile mode="compact" afterSignOutUrl="/" appearance={lumoAppearance} />;
}
```

- The card is at most 420 pixels wide and renders nothing while the user is signed out.
- `mode="compact"` shows the account details only. The default `mode="full"` adds the MFA status, the roles and the groups, each only when the UserInfo response holds that claim. With the default scopes it holds none of them, so both modes look the same.
- It has no **Edit profile** control. Add a link to the account page next to it.

## Render the profile on the server

`currentUser()` returns the same data on the server. Use it when the page must render without a loading state, or when the project builds its avatar with its own component.

```tsx
// app/profile/page.tsx
import { currentUser, protectPage, resolveConfig } from '@lumoauth/nextjs/server';

export default async function ProfilePage() {
  await protectPage({ returnTo: '/profile' });
  const user = await currentUser();
  const account = `${resolveConfig().domain.replace(/\/+$/, '')}/account`;

  return (
    <main>
      {user?.picture ? <img src={user.picture} alt="" width={96} height={96} /> : null}
      <h1>{user?.name ?? user?.email}</h1>
      <p>{user?.email}</p>
      <a href={`${account}/profile`} target="_blank" rel="noreferrer">Edit profile</a>
      <a href="/api/auth/logout">Sign out</a>
    </main>
  );
}
```

Use a plain `<img>` for `picture`. `next/image` refuses a host that is not listed in `next.config`, and the picture can come from any host. With `cacheComponents` on, this page needs `export const instant = false;`.

## The account pages of LumoAuth

The user edits the account on pages that LumoAuth hosts. The app links to them and builds no form of its own.

| Page | URL | What the user does there |
|---|---|---|
| Personal info | `{domain}/account/profile` | Name, photo link, phone number, address, email address |
| Security | `{domain}/account/security` | Password, two-step verification, passkeys, linked accounts |
| Sessions | `{domain}/account/sessions` | Signed-in devices |

`{domain}` is `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev`: `useAuth().config.domain` in a client component, `resolveConfig().domain` on the server. The **Manage account** entry of `<UserButton>` opens the first page.

- Open the pages in a new tab (`target="_blank"`), so that the user comes back to the app by closing the tab.
- The user is signed in there already, because sign-in to the app started a session at LumoAuth.
- The app reads the profile when a page loads. A change shows after a reload.
