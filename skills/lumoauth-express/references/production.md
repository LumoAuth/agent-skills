# Production settings for `@lumoauth/express`

Read this page before an Express app with `@lumoauth/express` is deployed, or when sign-in works on a laptop and fails behind a load balancer.

## Session store

The middleware stores the PKCE verifier, the `state` value, the tokens and the user profile in the `express-session` session. The default store of `express-session` keeps sessions in the memory of one process. That fails in production in two ways:

- A restart or a new deployment signs every user out.
- With more than one instance, the callback can reach an instance that does not hold the session. The answer is `400` `invalid_state` or `No login in progress`.

Pass a `store` that all instances share. Any store that is compatible with `express-session` works, for example a Redis or PostgreSQL store package. Follow the README of the store package for its constructor; the `session()` call stays the same:

```ts
import session from 'express-session';

export function sessionMiddleware(store: session.Store) {
  return session({
    store,
    name: 'app.sid',
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  });
}
```

The session store holds access tokens and refresh tokens. Protect it like a credential store: require authentication on it, keep it off the public network, and do not dump its content into logs.

## Cookie settings

| Setting | Value | Reason |
|---|---|---|
| `httpOnly` | `true` | Scripts in the page cannot read the session cookie |
| `secure` | `true` in production | The cookie is sent over HTTPS only. Over plain HTTP the cookie is not set, so keep `false` for `http://localhost` |
| `sameSite` | `'lax'` | LumoAuth returns the browser to `/auth/callback` with a top-level redirect from another site. `'lax'` sends the cookie on that request. `'strict'` does not, and the callback then answers `No login in progress` |
| `maxAge` | The session length that the app owner wants | Without it the cookie lasts until the browser closes |
| `saveUninitialized` | `false` | No session and no cookie for visitors who never start a sign-in |

`SESSION_SECRET` signs the session ID cookie. Generate it with `openssl rand -hex 32` and read it from the environment. To rotate it without signing users out, pass an array to `secret`: the first entry signs new cookies and the other entries are still accepted.

## Behind a proxy or load balancer

The middleware builds the redirect URI from the request: `{req.protocol}://{Host header}{prefix}/callback`. Two things must be right behind a proxy that ends TLS:

1. **Protocol.** Call `app.set('trust proxy', 1)` when one proxy stands in front of the app (use the number of proxies, or `true` to trust every hop). Express then takes `req.protocol` from `X-Forwarded-Proto`. Without it the redirect URI starts with `http://` and LumoAuth rejects it. `express-session` also needs this setting to set a `secure` cookie behind the proxy.
2. **Host.** The middleware reads the `Host` header, not `X-Forwarded-Host`. Configure the proxy to pass the original `Host` header to the app.

```ts
import express from 'express';

const app = express();
app.set('trust proxy', 1);
```

Check the result: open `/auth/login` and read the `redirect_uri` parameter of the URL that the browser is sent to. It must equal the URI that is registered on the OAuth application, character for character.

## OAuth application settings for production

Do these in the portal on the application's **Configuration** tab, then click **Save configuration**. Show the user every change before you make it.

- **Redirect URIs**: add `https://app.example.com/auth/callback`. Keep the `http://localhost:3000/auth/callback` entry only on an application that is used for development. A separate application for each environment keeps the secrets apart.
- **Logout → Post-logout redirect URIs**: add the absolute URL that `postLogoutRedirect` uses, for example `https://app.example.com/`.
- **Grant types**: `authorization_code` and `refresh_token`.

From the CLI, `lumo apps update <client-id> --redirect-uris <uri>,<uri>` replaces the whole list of redirect URIs. Pass every URI that must stay.

## Sign-out that ends the LumoAuth session

```ts
import { lumoAuthMiddleware } from '@lumoauth/express';

export const lumoAuth = lumoAuthMiddleware({
  baseUrl: process.env.LUMO_BASE_URL!,
  organization: process.env.LUMO_ORG_ID!,
  clientId: process.env.LUMO_CLIENT_ID!,
  clientSecret: process.env.LUMO_CLIENT_SECRET || undefined,
  postLogoutRedirect: 'https://app.example.com/',
});
```

With an absolute, registered `postLogoutRedirect`, `/auth/logout` revokes the refresh token and sends the browser through the LumoAuth end-session endpoint. With a relative path, only the local session ends and the next sign-in can complete without the login page.

The route accepts `GET` and `POST`. Prefer a `POST` form for the sign-out button: with `sameSite: 'lax'` the browser does not send the session cookie on a `POST` from another site, but it does send it on a `GET` link from another site.

## Secrets

| Secret | Where it may be |
|---|---|
| `LUMO_CLIENT_SECRET` | Server environment or secrets manager only |
| `LUMOAUTH_API_KEY` (`lmk_...`) | Server environment or secrets manager only. Give it only the scopes that the app uses, for example `authz:check` |
| `SESSION_SECRET` | Server environment or secrets manager only |
| Access, refresh and ID tokens | The session store only |

If the client secret leaks, replace it: click **Regenerate** on the application's **Credentials** tab in the portal, or run `lumo apps rotate-secret <client-id>`. The old secret stops working, so deploy the new one right away.

## Checklist

- [ ] A shared session store is configured; the memory store is not used.
- [ ] `cookie.secure` is `true`, `sameSite` is `'lax'`, `httpOnly` is `true`.
- [ ] `trust proxy` is set and the proxy passes the original `Host` header.
- [ ] The production redirect URI and the post-logout redirect URI are registered.
- [ ] `postLogoutRedirect` is an absolute URL.
- [ ] All secrets come from the environment; `.env` is not committed.
- [ ] No log line prints `req.session`, tokens, cookies or the `Authorization` header.
- [ ] Permission checks deny the request when LumoAuth cannot be reached.
