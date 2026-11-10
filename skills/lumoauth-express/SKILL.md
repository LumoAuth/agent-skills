---
name: lumoauth-express
description: >-
  Adds LumoAuth sign-in to an Express app with the `@lumoauth/express`
  middleware: `express-session`, `lumoAuthMiddleware()` and its options, the
  `/auth/login`, `/auth/callback` and `/auth/logout` routes, `req.user`,
  `requireAuth()` with scopes and an `authorize` hook, permission checks with
  `LumoAuthBackend`, token refresh, sign-out, production session store and
  cookie settings, and the `lumo init --framework express` starter. Use when
  the user wants login, logout, sessions or protected routes in an Express.js
  or Node.js server-rendered app or backend-for-frontend with LumoAuth, mentions
  `@lumoauth/express`, `lumoAuthMiddleware`, `requireAuth` or `express-session`
  with LumoAuth, or sees `session_middleware_missing`, `invalid_state` or a
  redirect URI mismatch on `/auth/callback`. Not for APIs that receive bearer
  tokens from another app (use lumoauth-node-backend).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Express

Add sign-in, sign-out and route protection to an Express app with `@lumoauth/express`. The middleware runs the OAuth 2.0 authorization code flow with PKCE against the organization's hosted login page and keeps the tokens in the server-side session.

## When to use

- The Express app owns the browser session: it renders pages, or it serves a same-origin frontend and its API.
- The user asks for login, logout, `req.user`, protected routes, or scope and permission checks on routes.

Do not use this skill when:

- The Express app is an API that receives `Authorization: Bearer` tokens from a separate frontend, a mobile app or another service. Use `lumoauth-node-backend`.
- The app is Next.js (`lumoauth-nextjs`) or a browser-only React app (`lumoauth-react`).
- The server is Fastify, Hono, Koa or Nest. Use `lumoauth-node-backend`.

## Before you start

Requirements, from the package manifest: Node.js 18 or newer, `express` 4.18 or newer, `express-session` 1.17 or newer.

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). It is the host of the organization's portal URL. |
| Organization slug | The `{orgId}` in `https://app.lumoauth.dev/orgs/{orgId}/portal/`. Example: `acme-corp`. |
| Client ID | An OAuth application in the organization. See below. |
| Client secret | Shown once when a **Web application** is created. A public PKCE client has none. |
| Redirect URI | `{app origin}/auth/callback`, registered on the application. Development: `http://localhost:3000/auth/callback`. Production: `https://app.example.com/auth/callback`. |
| Session secret | A random string that the app owner generates, for example `openssl rand -hex 32`. |

Find or create the OAuth application in one of these ways:

- **Portal.** Open **Applications** (`/orgs/{orgId}/portal/applications`) and click **New application**. Keep the protocol **OpenID Connect**, enter an **Application name**, choose **Web application**, enter the **Redirect URI** and click **Create application**. The next page shows the client secret once. The client ID stays on the application's **Credentials** tab. Add more redirect URIs later on the **Configuration** tab under **Redirect URIs**, then click **Save configuration**.
- **Portal Quickstarts page.** The **Express.js** tab shows the `.env` values for the organization and the selected client.
- **CLI.** `lumo apps list` prints the client IDs. To create a client, show this command to the user before you run it:

  ```bash
  lumo apps create --name "Express app" --redirect-uris http://localhost:3000/auth/callback -o json
  ```

  The JSON output holds the client ID in `data.clientId` and the secret in `data.secret`. The secret is not shown again. Without `-o json` the command prints only a success line, and the secret is lost; `lumo apps rotate-secret <client-id>` then issues a new one. The created client is confidential, requires PKCE and has the grant types `authorization_code` and `refresh_token`.

Every organization also has a **Starter App**. It is a public PKCE client (no secret) that already allows `http://localhost:3000/auth/callback`. It is enough for local development.

Redirect URIs match exactly: scheme, host, port and path. `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`.

## Steps

### Option A: scaffold a new app

Use this for an empty directory. `lumo login` must have run first, so that `.env` gets the organization slug and base URL.

```bash
lumo init --framework express --dir ./my-app
cd ./my-app && npm install && npm start
```

The command writes `README.md`, `.env`, `.gitignore`, `package.json` and `server.js` (JavaScript, ES modules). Existing files are skipped unless `--force` is passed. `--org` overrides the slug, and `--client-id` pre-fills the client ID. Without `--client-id`, set `LUMO_CLIENT_ID` in `.env` before the first sign-in. Set `LUMO_CLIENT_SECRET` too when the client is confidential. The result is the same code as Option B.

### Option B: add to an existing app

1. Install the packages.

   ```bash
   npm install @lumoauth/express express express-session dotenv
   npm install -D typescript tsx @types/express @types/express-session
   ```

2. Add the configuration to `.env`. Keep `.env` out of version control. The middleware reads no environment variables itself; these names match the `lumo init` starter and the portal's Quickstarts page.

   ```bash
   LUMO_BASE_URL=https://app.lumoauth.dev
   LUMO_ORG_ID=acme-corp
   LUMO_CLIENT_ID=
   LUMO_CLIENT_SECRET=
   SESSION_SECRET=
   PORT=3000
   ```

3. Mount `express-session` first, then `lumoAuthMiddleware` once on the app.

   ```ts
   // src/server.ts
   import 'dotenv/config';
   import express from 'express';
   import session from 'express-session';
   import { lumoAuthMiddleware, requireAuth } from '@lumoauth/express';

   const app = express();

   // 1. Sessions first. The PKCE verifier, the state value and the tokens are stored here.
   app.use(
     session({
       secret: process.env.SESSION_SECRET!,
       resave: false,
       saveUninitialized: false,
       cookie: {
         httpOnly: true,
         sameSite: 'lax',
         secure: process.env.NODE_ENV === 'production',
       },
     }),
   );

   // 2. LumoAuth. Adds GET /auth/login, GET /auth/callback and GET|POST /auth/logout,
   //    and sets req.user on every other request that has a signed-in session.
   app.use(
     lumoAuthMiddleware({
       baseUrl: process.env.LUMO_BASE_URL!,
       organization: process.env.LUMO_ORG_ID!,
       clientId: process.env.LUMO_CLIENT_ID!,
       // Leave the variable empty for a public PKCE client such as the Starter App.
       clientSecret: process.env.LUMO_CLIENT_SECRET || undefined,
     }),
   );

   // 3. A page that sends anonymous visitors to sign-in.
   app.get('/', (req, res) => {
     if (!req.user) return res.redirect('/auth/login');
     // Escape profile values before you put them into HTML. This page shows none.
     res.send('<h1>Signed in</h1><a href="/api/me">Profile</a> <a href="/auth/logout">Sign out</a>');
   });

   // 4. A route that needs a signed-in user. Without one it answers 401.
   app.get('/api/me', requireAuth(), (req, res) => {
     res.json(req.user);
   });

   const port = Number(process.env.PORT ?? 3000);
   app.listen(port, () => console.log(`http://localhost:${port}`));
   ```

   Run it with `npx tsx src/server.ts`.

4. Link to the routes. Send users to `/auth/login` to sign in and to `/auth/logout` to sign out. `/auth/login?return_to=/dashboard` opens that page after sign-in; only paths on the same site are accepted.

5. Protect routes with `requireAuth()`.

   ```ts
   import { requireAuth } from '@lumoauth/express';

   // Every scope must be in the scope that the token was granted. Missing: 403 insufficient_scope.
   app.get('/billing', requireAuth({ scopes: ['billing:read'] }), (req, res) => {
     res.json({ ok: true });
   });

   // Your own check. Return false to answer 403 forbidden.
   app.get(
     '/reports',
     requireAuth({ authorize: (user) => user.email_verified === true }),
     (req, res) => {
       res.json({ ok: true });
     },
   );
   ```

   `requireAuth()` checks the session only. It does not call LumoAuth. A scope that a route needs must also be requested at sign-in with the `scope` option and allowed on the OAuth application.

6. Check a permission (RBAC) with `LumoAuthBackend`, which this package re-exports. It needs an organization API key with the `authz:check` scope. Create the key in the portal under **API keys** (`/orgs/{orgId}/portal/settings/api-keys`): click **Create API key**, tick `authz:check` under **Permissions**, and copy the key once. It starts with `lmk_`. Store it as `LUMOAUTH_API_KEY` on the server only.

   ```ts
   import { LumoAuthBackend, requireAuth } from '@lumoauth/express';

   const lumo = new LumoAuthBackend({
     baseUrl: process.env.LUMO_BASE_URL!,
     orgId: process.env.LUMO_ORG_ID!,
     secretKey: process.env.LUMOAUTH_API_KEY!,
   });

   app.delete(
     '/api/documents/:id',
     requireAuth({
       authorize: async (user) => {
         try {
           return await lumo.permissions.check('document.delete', undefined, { userId: user.sub });
         } catch {
           return false; // deny when LumoAuth cannot be reached
         }
       },
     }),
     (req, res) => {
       res.json({ deleted: req.params.id });
     },
   );
   ```

   Always pass `{ userId: user.sub }`. Without it the check answers for the owner of the API key, not for the signed-in user. For roles and permission design use `lumoauth-rbac`. For relationship checks and other `LumoAuthBackend` calls read [references/permission-checks.md](references/permission-checks.md).

7. Prepare production. Use a shared session store instead of the default memory store, set `cookie.secure`, set `trust proxy` behind a proxy, register the production redirect URI, and set an absolute `postLogoutRedirect`. Read [references/production.md](references/production.md) before the app is deployed.

Security rules for this integration:

- The client secret, the API key and the session secret stay on the server. Never send them to the browser and never commit them.
- Never log `req.session`, tokens or the `Authorization` header.
- Do not write your own callback handler next to the middleware. The middleware already validates `state` and uses PKCE.

## Verify

1. Start the app and open `http://localhost:3000/`. The browser goes to `/auth/login`, then to the organization's login page on LumoAuth.
2. Sign in. The browser returns to `/auth/callback` and then to `/`, which shows "Signed in".
3. `curl -i http://localhost:3000/api/me` without a cookie answers `401` with `{"error":"unauthenticated"}`.
4. Open `/api/me` in the signed-in browser. It returns the profile with `sub`.
5. Open `/auth/logout`. After that, `/api/me` answers `401` again.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Every request answers `500` `session_middleware_missing` | `express-session` is mounted after `lumoAuthMiddleware`, or not at all | Mount `session(...)` first |
| LumoAuth shows a redirect URI error | The callback URL that the middleware built is not registered. It is `{protocol}://{Host header}{prefix}/callback` | Register that exact URL. Behind a proxy see [references/production.md](references/production.md) |
| `/auth/callback` answers `400` `invalid_state` or `No login in progress` | The session cookie did not come back, or the session was lost: memory store after a restart, several instances without a shared store, `sameSite: 'strict'`, or `secure: true` over plain HTTP | Use a shared store, `sameSite: 'lax'`, and `secure` only on HTTPS |
| `/auth/callback` answers `token_exchange_failed` (with the status that LumoAuth returned, or `502`) | LumoAuth refused the code exchange. The usual cause is a wrong or missing client secret for a confidential client | Set `LUMO_CLIENT_SECRET` to the secret of the **Web application**. Read `error_description` in the response |
| `requireAuth({ scopes })` answers `403` `insufficient_scope` | The token was not granted the scope | Add the scope to the `scope` option, allow it on the application, sign in again |
| A permission check answers for the wrong user | No subject was passed | Pass `{ userId: req.user.sub }` |
| A check with `userId` throws a `403` error | The API key lacks the `authz:check` scope | Create a key with that scope |
| After sign-out the next sign-in skips the login page | `postLogoutRedirect` is a relative path, so the LumoAuth session stays open | Use an absolute URL that is registered as a post-logout redirect URI |

## Related skills

- `lumoauth-node-backend`: bearer-token APIs and every `LumoAuthBackend` call.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`: design the permissions that the routes check.
- `lumoauth-login-methods` and `lumoauth-branding`: what the hosted login page offers and how it looks.
- `lumoauth-cli`: `lumo login`, `lumo apps` and `lumo init` in detail.

## References

- [references/options-and-routes.md](references/options-and-routes.md): every `lumoAuthMiddleware` and `requireAuth` option, what each route does, error responses, token refresh and sign-out. Read it when you change a default.
- [references/permission-checks.md](references/permission-checks.md): `LumoAuthBackend` in an Express app, relationship checks, checks with the user's own token, error handling.
- [references/production.md](references/production.md): session store, cookie settings, reverse proxies, sign-out and a deployment checklist.
- https://docs.lumoauth.dev/quickstarts/express
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/cli/init
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/user-guide/applications/api-keys
