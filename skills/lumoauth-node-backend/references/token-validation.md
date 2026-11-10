# Validating bearer tokens in a Node.js API

`SKILL.md` validates the token with `lumo.auth.getUserInfo(token)`. Read this page when you need to know exactly what that check covers, when it gets slow, when the token is DPoP-bound, or when the API must also check the audience or the scopes of the token.

## What the UserInfo check covers

`getUserInfo(token)` sends the token to `{baseUrl}/orgs/{orgId}/api/v1/oauth/userinfo` as `Authorization: Bearer`.

| LumoAuth answers | Meaning |
|---|---|
| `200` with the claims | The token is an access token of this organization, it is not expired or revoked, and its user is active |
| `401` `invalid_token` | Invalid, expired, revoked, from another organization, not an access token (for example an ID token), or DPoP-bound |
| `403` `insufficient_scope` | The token lacks the `openid` scope |

The SDK turns `401` and `403` into `LumoAuthApiError` with the code `USERINFO_ERROR` and the HTTP status in `statusCode`.

What the check does **not** cover:

- **Audience.** Every valid user access token of the organization passes, whichever OAuth application it was issued to.
- **Scopes.** The UserInfo answer holds profile claims, not the scopes of the token.
- **Tokens without a user.** A client-credentials token has no `openid` scope and no user, so it does not pass.

If the API needs one of these, validate the JWT locally as well (below).

The claims in the answer depend on the scopes that the user granted: `sub` always, name claims with `profile`, `email` and `email_verified` with `email`.

## Give the check a timeout

`auth.getUserInfo()` uses the `fetch` function of the client and sets no timeout of its own. (The `timeout` option applies to the namespace calls such as `permissions.check()`.) Pass a `fetch` with a deadline:

```ts
import { LumoAuthBackend } from '@lumoauth/backend';

const fetchWithDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(5_000) });

export function lumoFor(token: string): LumoAuthBackend {
  return new LumoAuthBackend({
    baseUrl: process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev',
    orgId: process.env.LUMOAUTH_ORG_ID,
    secretKey: token,
    fetch: fetchWithDeadline,
  });
}
```

A timeout makes `getUserInfo()` reject with the error that `fetch` throws. Answer `503`, not `401`.

## Cache the result for a short time

One UserInfo request for each API request adds latency and counts against rate limits. A short cache removes most of the calls. The cost: a revoked token stays accepted until its entry expires. Keep the lifetime short, and key the cache by a hash of the token, never by the token itself.

```ts
// src/auth-cache.ts
import { createHash } from 'node:crypto';
import type { UserInfo } from '@lumoauth/backend';

const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const entries = new Map<string, { user: UserInfo; expiresAt: number }>();

function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function getCachedUser(token: string): UserInfo | undefined {
  const key = keyOf(token);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.user;
}

export function cacheUser(token: string, user: UserInfo): void {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(keyOf(token), { user, expiresAt: Date.now() + TTL_MS });
}
```

In `authenticate`, call `getCachedUser(token)` first and `cacheUser(token, user)` after a successful `getUserInfo`. Cache successes only.

## Local JWT validation: issuer, audience, scopes

LumoAuth access tokens are JWTs with the header `typ: at+jwt` unless the OAuth application is set to another token format. A JWT can be checked without a request to LumoAuth: signature against the organization's JWKS, `iss`, `aud`, `exp`. The `lumoauth-api-protection` skill owns this topic, for every language and JWT library. The short version for Node.js follows.

The JavaScript SDK has a verifier for these tokens in `@lumoauth/agent` (not in `@lumoauth/backend`):

```bash
npm install @lumoauth/agent
```

```ts
// src/verify.ts
import {
  createAccessTokenVerifier,
  accessTokenScopes,
  AccessTokenError,
  type AccessTokenClaims,
} from '@lumoauth/agent';

const baseUrl = process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev';
const orgId = process.env.LUMOAUTH_ORG_ID;
const audience = process.env.API_AUDIENCE; // see "Which audience" below
if (!orgId || !audience) throw new Error('LUMOAUTH_ORG_ID and API_AUDIENCE must be set');

const verifier = createAccessTokenVerifier({
  issuer: `${baseUrl}/orgs/${orgId}/api/v1`,
  resource: audience,
});

export interface VerifiedToken {
  claims: AccessTokenClaims;
  scopes: string[];
}

/** Throws AccessTokenError (statusCode 401, or 503 when the keys cannot be loaded). */
export async function verifyRequest(
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<VerifiedToken> {
  const claims = await verifier.verifyRequest({ method, url, headers });
  return { claims, scopes: accessTokenScopes(claims) };
}

export { AccessTokenError };
```

What `verifyRequest` checks: the token is a compact JWT with `typ` `at+jwt`; the algorithm is asymmetric (`none` and HMAC are refused); the `kid` is in the issuer's JWKS, which the verifier reads through `{issuer}/.well-known/openid-configuration` and caches; the signature; `iss` equals `issuer`; `aud` contains `resource`; `exp` and `nbf` with 60 seconds of clock skew; `sub` is present; and, for a DPoP-bound token, the `DPoP` proof of the request.

What it does not check: revocation, and whether the user is still active. A token that was revoked stays valid locally until `exp`. Combine both when you need both: verify locally first (cheap, rejects most bad tokens), then call UserInfo, or keep access tokens short-lived.

`claims.sub` is the user ID for a user token. For an agent token it is `agent_agt_...` and `claims.is_agent` is true. Decide whether the route accepts agents.

### Which issuer

The issuer is `{baseUrl}/orgs/{orgId}/api/v1`. An organization that serves sign-in on its own verified custom domain uses that bare domain as the issuer instead. Read the `issuer` field of `{baseUrl}/orgs/{orgId}/api/v1/.well-known/openid-configuration` and use that value. The comparison is exact.

### Which audience

- The frontend requested a resource at sign-in (`resource=https://api.example.com` on the authorization request): `aud` is that URI. Use it as `resource`. The URI must be allowed on the OAuth application, otherwise LumoAuth answers `invalid_target`.
- The frontend requested no resource: `aud` is the client ID of the frontend's OAuth application. Use that client ID as `resource`.

Ask the user which of the two applies. Do not guess the audience.

## DPoP-bound tokens

A token that was obtained with a DPoP proof carries `cnf.jkt` and must be presented as `Authorization: DPoP <token>` together with a `DPoP` proof header. Two consequences:

- `getUserInfo(token)` sends the token as `Bearer`, so LumoAuth answers `401` for a DPoP-bound token. Validate such tokens locally instead.
- `verifier.verifyRequest()` checks the proof when you pass the method, the full public URL and the headers of the request. Behind a proxy, build the URL that the client called, not the internal one. The default replay cache for proof IDs is in memory, per process; pass `replayCache` to `createAccessTokenVerifier` to share one between instances.

For DPoP on the client side use `lumoauth-oauth-advanced`.
