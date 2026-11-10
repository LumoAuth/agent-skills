# Permission checks in an Express app

`requireAuth()` proves that a user is signed in. To decide what that user may do, ask LumoAuth with `LumoAuthBackend`, which `@lumoauth/express` re-exports from `@lumoauth/backend`. Read this page when a route needs a role-based, relationship-based or attribute-based decision. The `lumoauth-node-backend` skill documents every `LumoAuthBackend` option and namespace.

## Pick the credential

`secretKey` is the credential for every call. It determines who the answer is about.

| Credential | The check answers for | Works on |
|---|---|---|
| Organization API key (`lmk_...`) with the `authz:check` scope | The user that you name with `{ userId }` or `user:{id}` | Permission checks and Zanzibar checks. LumoAuth rejects API keys on the ABAC routes |
| The signed-in user's access token | That user | Permission checks, Zanzibar checks about the user, and ABAC (the token needs the `abac:read` scope) |

The API key is the usual choice in an Express app: one client for the whole process, and no token handling.

Create the key in the portal under **API keys** (`/orgs/{orgId}/portal/settings/api-keys`). Click **Create API key**, choose an expiration, tick only `authz:check` under **Permissions**, and copy the key once. Only an admin who may view authorization policies can grant `authz:check`, and the key stops working for these checks when that admin loses the permission. Store the key in `LUMOAUTH_API_KEY` on the server. Never send it to the browser.

## One client for the app

```ts
// src/lumo.ts
import { LumoAuthBackend } from '@lumoauth/express';

export const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMO_BASE_URL!,
  orgId: process.env.LUMO_ORG_ID!,
  secretKey: process.env.LUMOAUTH_API_KEY!,
});
```

The constructor throws `LumoAuthConfigError` when `baseUrl` or `secretKey` is missing, and when it runs in a browser.

## RBAC: does the user hold a permission?

```ts
import express from 'express';
import { requireAuth } from '@lumoauth/express';
import { lumo } from './lumo';

export const documents = express.Router();

documents.post('/documents/:id', requireAuth(), async (req, res, next) => {
  try {
    const mayEdit = await lumo.permissions.check('document.edit', undefined, {
      userId: req.user!.sub,
    });
    if (!mayEdit) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.json({ saved: req.params.id });
  } catch (err) {
    next(err);
  }
});
```

- The first argument is the permission slug. The second is an optional context object. The third names the subject.
- `req.user.sub` is the LumoAuth user ID. Do not pass an email address or the app's own user ID: LumoAuth answers `404` with the code `SUBJECT_NOT_FOUND`.
- `checkAny(slugs, context, subject)` is true when the user holds at least one slug. `checkAll(...)` needs every slug. `checkBulk(...)` returns `{ results: { [slug]: boolean } }`.
- `permissions.list()` and `listSlugs()` need a user access token with the `authz:read` scope. They fail with an API key.

A reusable guard:

```ts
import type { Request, Response, NextFunction } from 'express';
import { lumo } from './lumo';

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      const allowed = await lumo.permissions.check(permission, undefined, { userId: req.user.sub });
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
```

## ReBAC: does the user have a relation to an object?

```ts
import express from 'express';
import { requireAuth } from '@lumoauth/express';
import { lumo } from './lumo';

export const files = express.Router();

files.get('/files/:id', requireAuth(), async (req, res, next) => {
  try {
    const allowed = await lumo.zanzibar.check({
      object: `document:${req.params.id}`,
      relation: 'viewer',
      subject: `user:${req.user!.sub}`,
    });
    if (!allowed) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});
```

`object` and `subject` use the form `namespace:id`. A subject can also be a userset such as `team:engineering#member`. The shortcuts `isViewer`, `isEditor`, `isOwner`, `isMember` and `isAdmin` take `(object, subject)`. For the relationship model use `lumoauth-rebac`.

## Checks with the user's own token

ABAC decisions need the user's token, because LumoAuth rejects API keys on the ABAC routes. The middleware keeps the access token in the session under `__lumoAuth.tokens` and refreshes it before each request. Build a client for the request:

```ts
import type { Request } from 'express';
import { LumoAuthBackend } from '@lumoauth/express';

type LumoSession = { __lumoAuth?: { tokens?: { access_token?: string } } };

export function lumoForUser(req: Request): LumoAuthBackend | null {
  const token = (req.session as unknown as LumoSession).__lumoAuth?.tokens?.access_token;
  if (!token) return null;
  return new LumoAuthBackend({
    baseUrl: process.env.LUMO_BASE_URL!,
    orgId: process.env.LUMO_ORG_ID!,
    secretKey: token,
    cache: false, // the client is used for one request
  });
}
```

```ts
import express from 'express';
import { requireAuth } from '@lumoauth/express';
import { lumoForUser } from './lumo-for-user';

export const reports = express.Router();

reports.get('/reports/:id', requireAuth({ scopes: ['abac:read'] }), async (req, res, next) => {
  try {
    const userLumo = lumoForUser(req);
    if (!userLumo) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const allowed = await userLumo.abac.isAllowed('report', 'read', req.params.id);
    if (!allowed) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});
```

Request the scope at sign-in: `lumoAuthMiddleware({ ..., scope: 'openid profile email abac:read' })`, and allow it on the OAuth application. For attributes and policies use `lumoauth-abac`.

## The permission cache

`LumoAuthBackend` caches the result of `permissions.check()` in memory, per process: 5 minutes and 1,000 entries by default. A role change in LumoAuth can therefore take up to 5 minutes to reach a running process.

- Shorter window: `new LumoAuthBackend({ ..., cache: { ttl: 30_000 } })` (milliseconds).
- No cache: `cache: false`.
- Clear it after the app changes a user's roles: `lumo.permissions.clearCache()`.

Zanzibar and ABAC results are not cached.

## Errors

`LumoAuthBackend` throws the SDK error classes. Map them in one error handler, mounted after the routes:

```ts
import type { Request, Response, NextFunction } from 'express';
import { LumoAuthApiError, LumoAuthNetworkError } from '@lumoauth/express';

export function lumoErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof LumoAuthNetworkError) {
    res.status(503).json({ error: 'authorization_unavailable' });
    return;
  }
  if (err instanceof LumoAuthApiError) {
    // Do not forward err.body: it is LumoAuth's answer to the server credential.
    res.status(502).json({ error: 'authorization_failed' });
    return;
  }
  next(err);
}
```

| Error | Usual cause in an Express app |
|---|---|
| `LumoAuthAuthenticationError` (401) | The API key is wrong, revoked or expired. Or an API key was used on an ABAC, agent or JIT call |
| `LumoAuthPermissionDeniedError` (403) | A check named a subject and the key lacks `authz:check`. `err.requiredScopes` lists missing user scopes when LumoAuth names them |
| `LumoAuthNotFoundError` (404) | `userId` is not a user of this organization |
| `LumoAuthRateLimitError` (429) | Too many requests. `err.retryAfter` is the number of seconds to wait, when LumoAuth sent it |
| `LumoAuthNetworkError` | No response: DNS, TLS or the 30-second timeout |

When a check cannot be completed, deny the request. Never treat an error as "allowed".
