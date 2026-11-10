# The `authenticate` function in Fastify, Hono and NestJS

`SKILL.md` defines `authenticate(authorization)` in `src/auth.ts` and shows the Express adapter. Read this page when the server uses another framework. Each adapter does the same three things: pass the `Authorization` header to `authenticate`, answer `401` on `UnauthenticatedError`, and make the `Caller` available to the handler.

`@lumoauth/backend` needs Node.js 18 or newer. It imports `node:module`, so run these frameworks on Node.js.

## Fastify

```ts
// src/server.ts
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { authenticate, UnauthenticatedError, type Caller } from './auth';

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

const app = Fastify();
app.decorateRequest('caller', null);

async function requireCaller(request: FastifyRequest, reply: FastifyReply) {
  try {
    request.caller = await authenticate(request.headers.authorization);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: err.reason });
    }
    throw err;
  }
}

function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const allowed = await request.caller!.lumo.permissions.check(permission);
    if (!allowed) {
      return reply.code(403).send({ error: 'forbidden', permission });
    }
  };
}

app.get('/api/profile', { preHandler: requireCaller }, async (request) => {
  return request.caller!.user;
});

app.delete<{ Params: { id: string } }>(
  '/api/documents/:id',
  { preHandler: [requireCaller, requirePermission('documents.delete')] },
  async (request) => {
    return { deleted: request.params.id };
  },
);

app.listen({ port: Number(process.env.PORT ?? 4000) });
```

An error that is thrown from a hook reaches Fastify's error handler and becomes a `500`. Add `app.setErrorHandler` to map `LumoAuthNetworkError` to `503`.

## Hono (on Node.js)

```ts
// src/server.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { authenticate, UnauthenticatedError, type Caller } from './auth';

type Env = { Variables: { caller: Caller } };

const requireCaller = createMiddleware<Env>(async (c, next) => {
  try {
    c.set('caller', await authenticate(c.req.header('Authorization')));
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return c.json({ error: err.reason }, 401, { 'WWW-Authenticate': 'Bearer' });
    }
    throw err;
  }
  await next();
});

const requirePermission = (permission: string) =>
  createMiddleware<Env>(async (c, next) => {
    const allowed = await c.get('caller').lumo.permissions.check(permission);
    if (!allowed) {
      return c.json({ error: 'forbidden', permission }, 403);
    }
    await next();
  });

const app = new Hono<Env>();

app.get('/api/profile', requireCaller, (c) => c.json(c.get('caller').user));

app.delete('/api/documents/:id', requireCaller, requirePermission('documents.delete'), (c) =>
  c.json({ deleted: c.req.param('id') }),
);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) });
```

## NestJS

```ts
// src/lumo-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authenticate, UnauthenticatedError, type Caller } from './auth';

export const PERMISSION_KEY = 'lumoauth:permission';
/** Route decorator: the caller must hold this permission. */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class LumoAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      caller?: Caller;
    }>();

    let caller: Caller;
    try {
      caller = await authenticate(request.headers.authorization);
    } catch (err) {
      if (err instanceof UnauthenticatedError) throw new UnauthorizedException(err.reason);
      throw err;
    }
    request.caller = caller;

    const permission = this.reflector.get<string | undefined>(PERMISSION_KEY, context.getHandler());
    if (permission && !(await caller.lumo.permissions.check(permission))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
```

```ts
// src/documents.controller.ts
import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Caller } from './auth';
import { LumoAuthGuard, RequirePermission } from './lumo-auth.guard';

@Controller('api')
@UseGuards(LumoAuthGuard)
export class DocumentsController {
  @Get('profile')
  profile(@Req() request: { caller: Caller }) {
    return request.caller.user;
  }

  @Delete('documents/:id')
  @RequirePermission('documents.delete')
  remove(@Param('id') id: string) {
    return { deleted: id };
  }
}
```

## Rules for every adapter

- Run `authenticate` before any handler code that reads user data.
- Take the user ID from `caller.user.sub`.
- `401` means "no valid token". `403` means "valid token, not allowed". Use `503` when LumoAuth cannot be reached. Never let a failed check pass as allowed.
- Do not log the `Authorization` header.
