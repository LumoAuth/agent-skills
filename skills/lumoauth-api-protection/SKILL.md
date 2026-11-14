---
name: lumoauth-api-protection
description: >-
  Protects an API, resource server or microservice with LumoAuth access tokens in any language,
  without a LumoAuth SDK. Covers offline JWT validation with standard libraries (jose for Node.js,
  PyJWT, golang-jwt, ASP.NET Core JwtBearer, Spring Security resource server): JWKS URL, issuer,
  audience, expiry, the at+jwt token type and the scope claim; when to use token introspection
  instead; machine-to-machine access with the OAuth client credentials grant; organization API keys
  (lmk_) versus OAuth tokens; correct 401 and 403 responses with WWW-Authenticate; and scope and
  audience design. Use when the user asks to secure or protect an API with LumoAuth, validate or
  verify a Bearer token or JWT, check scopes, fix an invalid audience or issuer error, call one
  service from another with client_credentials, or choose between an API key and an access token.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# Protect an API with LumoAuth access tokens

With this skill you can make an API accept only valid LumoAuth access tokens: verify the JWT
offline against the organization's public keys, check issuer, audience, expiry, token type and
scope, answer with correct `401` and `403` responses, and issue tokens to other services with the
client credentials grant. Everything uses standard JWT and OAuth libraries.

## When to use

- An API, backend service, worker or gateway must authenticate callers that send
  `Authorization: Bearer <access token>`.
- A service must call another service without a user (machine to machine).
- The user asks which credential fits: an access token, an organization API key, or introspection.

Do not use it when a LumoAuth SDK covers the framework. The SDK skill is the shorter path:
`lumoauth-node-backend`, `lumoauth-express`, `lumoauth-fastapi`, `lumoauth-python`, `lumoauth-go`,
`lumoauth-aspnetcore`, `lumoauth-spring-boot`, `lumoauth-laravel`, `lumoauth-symfony`,
`lumoauth-php`.

- To sign users in and obtain tokens, use `lumoauth-oauth-oidc` or a framework skill.
- For role, attribute or relationship checks after the token is valid, use
  `lumoauth-authorization`.
- For MCP servers use `lumoauth-mcp-server`. For DPoP-bound tokens, PAR and FAPI 2.0 use
  `lumoauth-oauth-advanced`.

## Before you start

Ask the user for a value that you cannot find. Never guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` (EU: `https://eu.app.lumoauth.dev/...`) | `{base}/orgs/{orgId}/api/v1`, or the bare custom domain. Confirm with `{issuer}/.well-known/openid-configuration` |
| JWKS URL | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/jwks.json` | `jwks_uri` in the discovery document |
| API identifier (audience) | `https://api.example.com` | You choose it: an absolute `https` URI that names this API. It does not have to resolve |
| Scopes of the API | `read:reports`, `write:reports` | You design them (step 1) |
| Client ID and secret of a calling service | machine-to-machine only | Portal: **Applications → New application → Machine to machine** |

The API itself needs no secret to validate JWTs. It needs only the issuer, the JWKS URL and its
own identifier.

## Steps

### 1. Define the API identifier and the scopes

1. Choose the API identifier, for example `https://api.example.com`.
2. On every application that calls the API, add the identifier under **Applications → your app →
   Configuration → Resource indicators** and save. An empty list allows any resource.
3. Create the API's scopes and allow them on the calling applications
   (**Configuration → Allowed scopes**). Scope names are created with the Admin API:

   ```bash
   curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/scopes \
     -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name": "read:reports", "description": "Read reports"}'
   ```

   Show this command to the user before you run it. It needs an organization API key with the
   `admin:permissions:write` scope.
4. Callers request a token for this API with the `resource` parameter:
   `resource=https://api.example.com`. LumoAuth then sets the token's `aud` claim to that value.

Without `resource`, `aud` is the client ID of the calling application. An API that must accept
such tokens checks `aud` against a list of known client IDs instead. Prefer `resource`.

### 2. Validate the access token

A LumoAuth JWT access token has the JOSE header `typ: at+jwt`, an asymmetric `alg` (the
algorithm of the organization's signing key: `RS*`, `ES*` or `PS*`) and a `kid` that names a key
in the JWKS. Check all of the following on every request:

| Check | Rule |
|---|---|
| Signature | Key from the JWKS with the token's `kid`. Asymmetric algorithms only; never `none` or `HS*` |
| `typ` header | `at+jwt`. This refuses ID tokens and logout tokens, which the same key signs |
| `iss` | Equals the discovery `issuer` exactly |
| `aud` | Contains the API identifier (`aud` is a string, or an array for several resources) |
| `exp` | In the future. Allow at most a small clock difference |
| `scope` | A space-separated string. It must contain the scope that the route needs |
| `cnf.jkt` | If present, the token is DPoP-bound. Refuse it as a plain Bearer token unless the API verifies DPoP proofs (`lumoauth-oauth-advanced`) |

Node.js with `jose` (`npm install jose`):

```ts
// lumoauth-token.ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const AUDIENCE = process.env.API_AUDIENCE!; // https://api.example.com
const ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"];

// The key set is cached and fetched again when a token carries an unknown kid.
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: "invalid_token" | "insufficient_scope" | null,
    message: string,
    public readonly requiredScope?: string,
  ) {
    super(message);
  }

  /** Value for the WWW-Authenticate response header. */
  get challenge(): string {
    if (this.code === null) return 'Bearer realm="api"';
    const scope = this.requiredScope ? `, scope="${this.requiredScope}"` : "";
    return `Bearer realm="api", error="${this.code}", error_description="${this.message}"${scope}`;
  }
}

export async function verifyAccessToken(
  authorization: string | undefined,
  requiredScope?: string,
): Promise<JWTPayload> {
  if (!authorization) throw new AuthError(401, null, "Missing access token");
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(authorization);
  if (!match) throw new AuthError(401, "invalid_token", "Malformed Authorization header");

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(match[1], jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
      typ: "at+jwt",
      algorithms: ALGORITHMS,
      requiredClaims: ["exp", "iat", "sub", "jti"],
      clockTolerance: 30,
    }));
  } catch {
    throw new AuthError(401, "invalid_token", "The access token is invalid or expired");
  }

  if (payload.cnf !== undefined) {
    throw new AuthError(401, "invalid_token", "DPoP-bound tokens are not accepted as Bearer tokens");
  }

  if (requiredScope) {
    const granted = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!granted.includes(requiredScope)) {
      throw new AuthError(403, "insufficient_scope", "The access token lacks a required scope", requiredScope);
    }
  }
  return payload;
}
```

Use it in any HTTP framework:

```ts
// server.ts
import { createServer } from "node:http";
import { AuthError, verifyAccessToken } from "./lumoauth-token.js";

createServer(async (req, res) => {
  try {
    const claims = await verifyAccessToken(req.headers.authorization, "read:reports");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subject: claims.sub, client: claims.client_id }));
  } catch (err) {
    if (err instanceof AuthError) {
      res.writeHead(err.status, { "WWW-Authenticate": err.challenge, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.code ?? "unauthorized" }));
      return;
    }
    res.writeHead(500).end();
  }
}).listen(8080);
```

On a custom domain, read `jwks_uri` from the discovery document instead of building it from the
issuer. Read `references/jwt-validation-examples.md` for the same checks in Python (PyJWT), Go
(golang-jwt), C# (ASP.NET Core JwtBearer) and Java (Spring Security).

### 3. Authorize the request

- Map each route to one scope and check it after the token is valid (the example does both).
- `sub` identifies the caller: the user's ID for user tokens, `client_<client_id>` for tokens from
  the client credentials grant, `agent_<agent_id>` for AI agents. `client_id` names the
  application that obtained the token.
- Do not grant access because a claim such as `email` or `roles` is present. `roles` is in a
  token only when the application enables **User roles** in its JWT claims. For permission checks
  that are always current, call the authorization API (`lumoauth-authorization`, `lumoauth-rbac`).

Read `references/access-token-claims.md` for every claim by token kind (user, machine, agent,
delegated).

### 4. Answer with the right status

| Situation | Status | `WWW-Authenticate` |
|---|---|---|
| No token | `401` | `Bearer realm="api"` |
| Token malformed, expired, wrong signature, issuer, audience or type | `401` | `Bearer realm="api", error="invalid_token", error_description="..."` |
| Token valid, scope missing | `403` | `Bearer realm="api", error="insufficient_scope", scope="read:reports"` |
| Token valid, the user may not act on this object | `403` | None needed |

Do not say in the response which check failed in more detail than this. Never log the token.
Read `references/responses-and-scope-design.md` for step-up responses, scope naming and audience
design.

### 5. Machine to machine: the client credentials grant

1. Create the calling service's application: **Applications → New application → Machine to
   machine**. Copy the client ID and the secret (shown once). Set its **Allowed scopes** and
   **Resource indicators** as in step 1.
2. The service requests a token:

   ```bash
   curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
     -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
     -d "grant_type=client_credentials" \
     -d "scope=read:reports" \
     -d "resource=https://api.example.com"
   ```

   ```json
   {
     "access_token": "eyJ...",
     "token_type": "Bearer",
     "expires_in": 3600,
     "scope": "read:reports"
   }
   ```

3. The service caches the token until shortly before `expires_in` runs out, then requests a new
   one. There is no refresh token for this grant.
4. The API validates the token as in step 2. Its `sub` is `client_<client_id>` and it carries
   `gty: "client_credentials"`.

The client secret stays on the server. Never ship it in a browser, mobile or desktop app. Read
`references/machine-to-machine.md` for a caching client in TypeScript, the error codes and the
comparison with organization API keys.

### 6. Decide whether you need introspection

Offline validation cannot see that a token was revoked. A token keeps passing until `exp` after
the user signed out everywhere, was blocked, or the application was disabled.

| Need | Use |
|---|---|
| High throughput, short-lived tokens | Offline JWT validation (steps 2 to 4) |
| The application issues opaque access tokens | Introspection (required) |
| A sensitive operation must respect revocation at once | Offline validation first, then introspection for that operation |

LumoAuth answers `active: true` only to the application that the token was issued to, or to a
client whose ID is in the token's `aud`. Read `references/introspection.md` before you add it.

## Verify

1. Get a token with the request in step 5 and call the API: `200`.
2. Call without a token: `401` and `WWW-Authenticate: Bearer realm="api"`.
3. Change one character of the token's signature: `401` with `error="invalid_token"`.
4. Request a token without the scope that the route needs: `403` with
   `error="insufficient_scope"`.
5. Request a token without `resource`, or for another resource: the API answers `401`, because
   `aud` does not match.
6. Send an ID token in place of the access token: `401`, because `typ` is not `at+jwt`.

Decode the token payload locally to inspect `iss`, `aud` and `scope` when a check fails. Do not
paste real tokens into web tools.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Every token fails with an issuer error | The API expects `https://app.lumoauth.dev` or omits `/api/v1` | Use the discovery `issuer`: `{base}/orgs/{orgId}/api/v1` or the bare custom domain |
| Audience error although the token is fresh | The caller did not send `resource`, so `aud` is the client ID | Send `resource=<API identifier>` in the token request (and in the authorization request for user tokens) |
| `invalid_target` when the caller requests the token | The API identifier is not in the application's **Resource indicators** | Add it, or leave the list empty |
| `invalid_scope` when the caller requests the token | The scope is not in the application's **Allowed scopes** | Allow it on the application |
| `unauthorized_client` on `client_credentials` | The application is public or lacks the grant type | Use a confidential application with the `client_credentials` grant |
| The library rejects the token type | The library accepts only `typ: JWT` by default | Configure the accepted type `at+jwt` (see the Java example in the references) |
| Signature errors after a key rotation | The JWKS is cached without refresh | Fetch the JWKS again when a `kid` is unknown |
| Tokens with `ES256` or `PS256` fail | The verifier allows only `RS256` | Allow the algorithm of the organization's signing key |
| The API accepts ID tokens | No `typ` check | Require `typ: at+jwt` |
| `email` or `roles` missing from the token | Claims follow the granted scopes; `roles` is opt-in per application | Request the scope, enable **User roles**, or use the authorization API |
| A revoked user still gets `200` | Offline validation cannot see revocation | Shorten the access token lifetime or introspect sensitive calls |
| The API is called with `lmk_...` as a Bearer token | Organization API keys are credentials for LumoAuth's own APIs | Callers of your API use OAuth access tokens |

## Related skills

- `lumoauth-oauth-oidc`: how applications sign users in and obtain the tokens that this API checks.
- `lumoauth-oauth-advanced`: resource indicators in detail, DPoP verification at a resource
  server, introspection and revocation parameters.
- `lumoauth-authorization`, `lumoauth-rbac`, `lumoauth-abac`, `lumoauth-rebac`: decisions beyond
  scopes.
- `lumoauth-admin-api`: organization API keys and the Admin API.
- `lumoauth-agent-identity` and `lumoauth-agent-delegation`: tokens of AI agents and delegated
  (`act`) tokens.
- `lumoauth-mcp-server`: the same protection for MCP servers.

## References

- [JWT validation examples](references/jwt-validation-examples.md): Python, Go, C#, Java.
- [Access token claims](references/access-token-claims.md): header and claims by token kind.
- [Machine to machine](references/machine-to-machine.md): client credentials, token caching, API
  keys versus tokens.
- [Introspection](references/introspection.md): request, response, who may introspect, caching.
- [Responses and scope design](references/responses-and-scope-design.md): `401`/`403` details,
  step-up, scope and audience design.
- https://docs.lumoauth.dev/tracks/backend
- https://docs.lumoauth.dev/oauth/token-management
- https://docs.lumoauth.dev/oauth/introspect
- https://docs.lumoauth.dev/oauth/resource-indicators
- https://docs.lumoauth.dev/user-guide/security/credential-model
