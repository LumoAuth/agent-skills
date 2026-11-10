---
name: lumoauth-node-backend
description: >-
  Protects a Node.js API or service with the `@lumoauth/backend` server SDK
  (`LumoAuthBackend`): validates the bearer access token that a frontend or
  mobile app sends, runs RBAC permission checks, ABAC decisions and Zanzibar
  relationship checks on the server, handles the SDK error classes, reaches
  the Admin API through the generated client with `lumo.api`, and covers
  machine-to-machine credentials (organization API key, client credentials).
  Use when the user builds or secures a REST or GraphQL API, worker, cron job
  or script in Node.js or TypeScript with Express, Fastify, Hono, Koa or
  NestJS, asks to verify a LumoAuth token on the server, to check permissions
  or roles in a route handler or middleware, mentions `@lumoauth/backend`,
  `LumoAuthBackend`, `secretKey`, `assertServerOnly`, `permissions.check`,
  `zanzibar.check` or `lumo.api`. Not for server-side login routes and
  sessions in Express (use lumoauth-express) or Next.js (use lumoauth-nextjs).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Node.js backends

Use `@lumoauth/backend` in a Node.js API or service to find out who is calling and what that caller may do. The package gives one class, `LumoAuthBackend`, that holds a server-side credential and calls LumoAuth for token checks and authorization decisions.

## When to use

- An API receives `Authorization: Bearer <access token>` from a browser app, a mobile app or another service, and must validate the token.
- A route handler, resolver, worker or script must check a permission (RBAC), a policy (ABAC) or a relationship (Zanzibar).
- A service or script must call the LumoAuth Admin API from TypeScript.

Do not use this skill when:

- The Express app runs the sign-in itself and keeps a session cookie. Use `lumoauth-express`.
- The app is Next.js. Use `lumoauth-nextjs`.
- The code is an AI agent that signs in as itself. Use `lumoauth-agent-identity`.
- The API is not Node.js, or it must validate JWTs with a generic library. Use `lumoauth-api-protection`.

## Before you start

Requirement: Node.js 18 or newer. The package throws in a browser.

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in `https://app.lumoauth.dev/orgs/{orgId}/portal/`. Example: `acme-corp` |
| Organization API key (optional) | Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`) → **Create API key**. Tick only the scopes that the service needs. The key starts with `lmk_` and is shown once |

The frontend that calls the API needs its own OAuth application (a public PKCE client). That belongs to the frontend skill (`lumoauth-react`, `lumoauth-vue`, `lumoauth-angular`, `lumoauth-react-native`). The API itself needs no client ID to validate a token.

Decide which credential the server uses. `secretKey` is the credential for every call, and it determines who an answer is about.

| `secretKey` | Sent as | Answers are about | Works on |
|---|---|---|---|
| The caller's access token (one client for each request) | `Authorization: Bearer` | That user | Permission checks, Zanzibar checks, ABAC (needs the `abac:read` scope), UserInfo |
| An organization API key (`lmk_...`) | `X-API-Key` | The key's owner, or the user that you name | Permission checks and Zanzibar checks (naming a user needs the `authz:check` scope on the key) and the Admin API through `lumo.api`. LumoAuth rejects API keys on the ABAC, agent and JIT routes |

The main path below uses the caller's token. It needs no stored secret at all.

## Steps

1. Install the package.

   ```bash
   npm install @lumoauth/backend
   ```

2. Set the configuration. `LumoAuthBackend` reads nothing from the environment; the code below reads these names.

   ```bash
   LUMOAUTH_URL=https://app.lumoauth.dev
   LUMOAUTH_ORG_ID=acme-corp
   ```

3. Add one framework-neutral function that validates the bearer token. It asks the organization's UserInfo endpoint, so LumoAuth rejects a token that is expired, revoked, malformed, issued by another organization, or owned by a blocked user.

   ```ts
   // src/auth.ts
   import { LumoAuthBackend, LumoAuthApiError, type UserInfo } from '@lumoauth/backend';

   const baseUrl = process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev';
   const orgId = process.env.LUMOAUTH_ORG_ID;
   if (!orgId) throw new Error('LUMOAUTH_ORG_ID is not set');

   export interface Caller {
     /** Claims from UserInfo. `sub` is the LumoAuth user ID. */
     user: UserInfo;
     /** LumoAuth client that acts as this user. */
     lumo: LumoAuthBackend;
   }

   export class UnauthenticatedError extends Error {
     constructor(public readonly reason: 'missing_token' | 'invalid_token') {
       super(reason);
       this.name = 'UnauthenticatedError';
     }
   }

   /** Validate the value of an Authorization header. Throws UnauthenticatedError. */
   export async function authenticate(authorization: string | undefined | null): Promise<Caller> {
     const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
     if (!match) throw new UnauthenticatedError('missing_token');
     const token = match[1];

     // One client for this request. Its permission cache is not shared with other users.
     const lumo = new LumoAuthBackend({ baseUrl, orgId, secretKey: token });
     try {
       const user = await lumo.auth.getUserInfo(token);
       return { user, lumo };
     } catch (err) {
       // 401: invalid, expired or revoked. 403: the token lacks the openid scope.
       if (err instanceof LumoAuthApiError && (err.statusCode === 401 || err.statusCode === 403)) {
         throw new UnauthenticatedError('invalid_token');
       }
       throw err; // LumoAuth could not be reached, or another failure: answer 5xx, not 401
     }
   }
   ```

4. Call it from the framework. Express:

   ```ts
   // src/server.ts
   import express, { type Request, type Response, type NextFunction } from 'express';
   import { LumoAuthApiError, LumoAuthNetworkError } from '@lumoauth/backend';
   import { authenticate, UnauthenticatedError, type Caller } from './auth';

   declare module 'express-serve-static-core' {
     interface Request {
       caller?: Caller;
     }
   }

   const app = express();
   app.use(express.json());

   async function requireCaller(req: Request, res: Response, next: NextFunction): Promise<void> {
     try {
       req.caller = await authenticate(req.headers.authorization);
       next();
     } catch (err) {
       if (err instanceof UnauthenticatedError) {
         res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: err.reason });
         return;
       }
       next(err);
     }
   }

   function requirePermission(permission: string) {
     return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
       try {
         const allowed = await req.caller!.lumo.permissions.check(permission);
         if (!allowed) {
           res.status(403).json({ error: 'forbidden', permission });
           return;
         }
         next();
       } catch (err) {
         next(err);
       }
     };
   }

   app.get('/api/health', (_req, res) => {
     res.json({ status: 'ok' });
   });

   app.get('/api/profile', requireCaller, (req, res) => {
     res.json(req.caller!.user);
   });

   app.delete('/api/documents/:id', requireCaller, requirePermission('documents.delete'), (req, res) => {
     res.json({ deleted: req.params.id });
   });

   // Deny when a LumoAuth call fails. Never treat an error as "allowed".
   app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
     if (err instanceof LumoAuthNetworkError) {
       res.status(503).json({ error: 'authorization_unavailable' });
       return;
     }
     if (err instanceof LumoAuthApiError) {
       res.status(502).json({ error: 'authorization_failed' });
       return;
     }
     next(err);
   });

   app.listen(Number(process.env.PORT ?? 4000));
   ```

   For Fastify, Hono and NestJS, read [references/frameworks.md](references/frameworks.md). The `authenticate` function stays the same.

5. Add the checks that the routes need. All three run as the caller, because the client holds the caller's token.

   ```ts
   import type { Caller } from './auth';

   export async function canReadDocument(caller: Caller, documentId: string): Promise<boolean> {
     // RBAC: does the caller hold the permission?
     if (!(await caller.lumo.permissions.check('documents.read'))) return false;

     // ReBAC: is the caller a viewer of this document?
     return caller.lumo.zanzibar.check({
       object: `document:${documentId}`,
       relation: 'viewer',
       subject: `user:${caller.user.sub}`,
     });
   }

   export async function canApproveInvoice(caller: Caller, invoiceId: string): Promise<boolean> {
     // ABAC: the caller's token needs the abac:read scope.
     return caller.lumo.abac.isAllowed('invoice', 'approve', invoiceId);
   }
   ```

   Design the permissions, policies and relations with `lumoauth-rbac`, `lumoauth-abac` and `lumoauth-rebac`. This skill only shows the calls.

6. Optional: use an organization API key instead of the caller's token for the checks. One long-lived client then serves every request, and you name the user:

   ```ts
   import { LumoAuthBackend } from '@lumoauth/backend';

   export const lumo = new LumoAuthBackend({
     baseUrl: process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev',
     orgId: process.env.LUMOAUTH_ORG_ID,
     secretKey: process.env.LUMOAUTH_API_KEY!, // lmk_..., with the authz:check scope
   });

   export function mayEdit(userId: string): Promise<boolean> {
     return lumo.permissions.check('documents.edit', undefined, { userId });
   }
   ```

   `userId` is the `sub` claim of the validated token. Without the third argument the check answers for the owner of the key.

Security rules:

- An API key or client secret stays on the server. Never put one in browser or mobile code, in a `NEXT_PUBLIC_*` or `VITE_*` variable, or in a repository.
- Never log tokens or the `Authorization` header.
- Take the user ID from the validated token (`caller.user.sub`), never from the request body or a query parameter.
- UserInfo accepts every valid user access token of the organization, whichever application it was issued to. When the API must accept only tokens that were issued for it, check the audience as well: read [references/token-validation.md](references/token-validation.md).

## Verify

1. Start the API. `curl -i http://localhost:4000/api/profile` answers `401` with `{"error":"missing_token"}`.
2. `curl -i -H "Authorization: Bearer not-a-token" http://localhost:4000/api/profile` answers `401` with `{"error":"invalid_token"}`.
3. Sign in through the frontend, copy the access token from the request that the frontend sends, and call `/api/profile` with it. The answer holds `sub`.
4. Call the permission-protected route with a user who lacks the permission: `403`. Assign a role with the permission in the portal (**Access control → Roles & permissions**, then the user's **Roles** tab) and call again with a new request: `200`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuthConfigError` that mentions a browser | `LumoAuthBackend` was constructed in code that runs in a browser | Keep the import in server code. Use `@lumoauth/client` in the browser |
| Every token gets `401` | Wrong `LUMOAUTH_ORG_ID` or wrong region in `LUMOAUTH_URL`; the frontend sends the ID token; the access token lacks the `openid` scope; or the token is DPoP-bound | Compare with the frontend's configuration. Send the access token, and request `openid` at sign-in. For DPoP-bound tokens read [references/token-validation.md](references/token-validation.md) |
| `Error: Missing route parameter "orgId"` or an error that says `orgId` is required | `orgId` was not passed. UserInfo, ABAC, agents, JIT and MCP calls are organization-scoped | Pass `orgId` to the constructor |
| `401` on an ABAC call with an `lmk_` key | API keys are not accepted on the ABAC routes | Use the caller's token with the `abac:read` scope |
| `403` with `requiredScopes` on the error | The user token lacks a scope, for example `authz:read` for `permissions.list()` or `abac:read` for ABAC | Request the scope at sign-in in the frontend and allow it on the OAuth application |
| A check with `userId` throws `LumoAuthPermissionDeniedError` | The API key lacks the `authz:check` scope | Create a key with that scope |
| A check with `userId` throws `LumoAuthNotFoundError` | The ID is not a LumoAuth user ID of this organization | Pass the token's `sub`, not an email or the app's own ID |
| A role change shows up minutes later | A long-lived client caches `permissions.check()` results for 5 minutes | Pass `cache: false` or a shorter `cache: { ttl }`, or call `lumo.permissions.clearCache()` |
| `LumoAuthConfigError` that mentions `@lumoauth/api-client` | `lumo.api` was used without the generated client | Install it. See [references/admin-api-and-m2m.md](references/admin-api-and-m2m.md) |

## Related skills

- `lumoauth-api-protection`: local JWT validation (JWKS, issuer, audience), introspection, and APIs in other languages.
- `lumoauth-express`: sign-in routes and sessions in Express.
- `lumoauth-authorization`, `lumoauth-rbac`, `lumoauth-abac`, `lumoauth-rebac`: choose and design the authorization model.
- `lumoauth-admin-api`: the Admin API behind `lumo.api`.
- `lumoauth-react`, `lumoauth-vue`, `lumoauth-angular`, `lumoauth-react-native`: the frontend that obtains the token.

## References

- [references/client-reference.md](references/client-reference.md): every `LumoAuthBackend` option, namespace and method, the guard helper, the cache and the error classes. Read it before you call a method that is not shown above.
- [references/token-validation.md](references/token-validation.md): what the UserInfo check covers, caching it, timeouts, DPoP-bound tokens, and audience checks with local JWT validation.
- [references/frameworks.md](references/frameworks.md): the same `authenticate` function in Fastify, Hono and NestJS.
- [references/admin-api-and-m2m.md](references/admin-api-and-m2m.md): `lumo.api`, organization API keys, and the client-credentials grant for service-to-service calls.
- https://docs.lumoauth.dev/quickstarts/node
- https://docs.lumoauth.dev/tracks/backend
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/authorization/check
- https://docs.lumoauth.dev/user-guide/applications/api-keys
