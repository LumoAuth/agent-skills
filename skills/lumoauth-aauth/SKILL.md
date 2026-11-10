---
name: lumoauth-aauth
description: >-
  Implements the AAuth (Agent Auth) protocol with LumoAuth: an agent proves its identity with its
  own Ed25519 key, signs every HTTP request (RFC 9421 HTTP message signatures, `Signature`,
  `Signature-Input`, `Content-Digest`, `Agent-Auth` headers) and receives proof-of-possession
  tokens. Covers agent keys and JWKS, the three token types (agent token `agent+jwt`, resource
  token `resource+jwt`, auth token `auth+jwt`), the agent token endpoint, user consent, signed
  calls to a resource, and verifying AAuth requests at a resource server. Shows `AAuthClient`,
  `generateKeypair`, `signRequest` and `verifyAuthToken` from `@lumoauth/agent`, `AAuthClient` from
  the Python package `lumoauth[aauth]`, and the Go, PHP, .NET and Java clients and verifiers. Use
  when the user asks for AAuth, signed agent requests, HTTP message signatures, an agent without a
  shared secret whose tokens are bound to its key, or an API that must verify that a request comes
  from the agent that the token was issued to.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth AAuth

Give an agent a key pair, let it get key-bound tokens from a LumoAuth organization, sign every
request with that key, and verify those requests in the API that the agent calls.

## When to use

Use AAuth when at least one of these is true:

- A stolen token must be useless: every request has to prove that the sender holds the agent's key.
- The agent must not hold a shared secret.
- The API (the resource) wants its own say: it issues a resource token that names the agent and
  the scopes before LumoAuth issues an access token.
- Agents hand work to other agents and each hop must be recorded in the token.

Use plain OAuth client credentials instead (`lumoauth-agent-identity`) when the agent only calls
LumoAuth's own API (Ask API, just-in-time permissions) or APIs that accept a bearer token. That
path needs far less setup. A `private_key_jwt` agent in that skill also has no shared secret, but
only its token request is signed, not every request.

Do not use this skill for DPoP on ordinary OAuth tokens (`lumoauth-oauth-advanced`), for MCP
servers (`lumoauth-mcp-server`, `lumoauth-mcp-client`) or for human approval of an action
(`lumoauth-agent-approvals`).

## How AAuth works

Three parties: the **agent** (identified by an HTTPS URL), the **resource** (the API, identified
by a URI) and the **authorization server** (the LumoAuth organization, issuer
`https://app.lumoauth.dev/orgs/{orgId}/api/v1`).

| Token | `typ` | Who gets it, and from where | Default lifetime | Bound to |
|---|---|---|---|---|
| Agent token | `agent+jwt` | The agent, from `POST {issuer}/aauth/agent/issue` (or signed by the agent itself) | 1 hour | The agent's key (`cnf`) |
| Resource token | `resource+jwt` | The resource, from `POST {issuer}/aauth/resource/token`. The resource hands it to the agent | 5 minutes | One agent and its key (`agent`, `agent_jkt`) |
| Auth token | `auth+jwt` | The agent, from `POST {issuer}/aauth/agent/token` | 1 hour | The agent's key (`cnf.jwk`), one resource (`aud`) |

Flow:

1. The agent gets an agent token for its key.
2. The agent asks the resource for access. The resource gets a resource token from LumoAuth and
   returns it.
3. The agent sends the agent token (header `Agent-Auth`) and the resource token (body) to the agent
   token endpoint in a signed request.
4. LumoAuth returns an auth token, or a consent URL when a user must approve first.
5. The agent calls the resource with `Authorization: Bearer <auth token>` and a signature made
   with the same key.
6. The resource verifies the token and the signature.

## Before you start

Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). SDKs read `LUMOAUTH_URL` |
| Organization slug | The `{orgId}` in the portal URL. SDKs read `LUMOAUTH_ORG_ID` |
| Agent identifier | A URL that you choose, for example `https://my-agent.example.com`. It must be exactly the value registered in the portal |
| Agent private key | You generate it (step 1). Pass it to the SDK from your own variable, such as `AGENT_PRIVATE_KEY` |
| Key ID (`kid`) | `key-1` unless you choose another. It must match the registered JWKS entry |
| Resource identifier | The URL of the API, for example `https://api.example.com`. Registered in the portal |
| Redirect URI | Only for user consent, for example `https://my-agent.example.com/oauth/callback` |

The private key is a secret. Keep it in a secrets manager and on the server. Never put it in a
browser, a mobile app, a prompt or a repository. The AAuth clients run on a server only
(`@lumoauth/agent` uses `node:crypto`, Node.js 18+; Python 3.9+).

## Steps

### 1. Generate the agent's key pair

```bash
npm install @lumoauth/agent
```

```ts
import { generateKeypair } from '@lumoauth/agent';

const { privateKeyPem, jwks } = generateKeypair(); // Ed25519, kid "key-1"
console.log(JSON.stringify(jwks, null, 2));        // public keys: register these
// Store privateKeyPem in a secrets manager. Do not print or commit it.
```

Python: `pip install 'lumoauth[aauth]'`, then
`private_pem, jwks = AAuthClient.generate_keypair()` (from `lumoauth`).

Publish the JWKS in one of two ways: paste it into the agent's registration (inline), or serve it
from the agent's own domain, for example `https://my-agent.example.com/.well-known/jwks.json`, and
register that URL.

### 2. Register the agent and the resource in the portal

Tell the user to do this; it needs an organization admin.

1. **AI Agents → Agents → Register agent** (`/orgs/{orgId}/portal/agents`). On step 2 choose
   **AAuth**. Enter the **Agent identifier** and the **JWKS (inline)** or a **JWKS URL**.
2. On step 3, under **Acting for people**, set **Pre-authorized scopes** (one per line) for access
   without a user. Switch on **Delegation to sub-agents**: step 3 below needs it. Switch on
   **User-in-the-loop authorization** when users must consent.
3. For consent, edit the AAuth registration afterwards and add the **Redirect URIs**.
4. On the **AAuth resources** tab, click **Register resource**: **Resource name**, **Resource
   identifier** (`https://api.example.com`), the resource's **JWKS URI**, its **Scopes** and the
   **Default auth level**. Registering a resource needs the `settings.manage` permission.

### 3. Get an agent token

The agent signs a request to `/aauth/agent/issue` with its registered key. The `Signature-Key`
header names the agent and the key.

```ts
// aauth-agent.ts
import { AAuthClient, signRequest } from '@lumoauth/agent';

const agentIdentifier = 'https://my-agent.example.com';
const privateKeyPem = process.env.AGENT_PRIVATE_KEY!;
const kid = 'key-1';

export const aauth = new AAuthClient({ agentIdentifier, privateKeyPem, kid }); // reads LUMOAUTH_URL, LUMOAUTH_ORG_ID

export async function issueAgentToken(): Promise<string> {
  const url = `${aauth.issuer}/aauth/agent/issue`;
  const body = JSON.stringify({
    delegate_sub: `${agentIdentifier}/session/main`,
    delegate_public_key: aauth.publicJwk,
    audience: aauth.issuer,
  });
  const headers = signRequest(privateKeyPem, 'POST', url, {
    body,
    signatureKey: `sig1=jwks_uri;id="${agentIdentifier}";kid="${kid}"`,
  });
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`agent token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { agent_token: string; expires_in: number };
  return data.agent_token; // cache it until shortly before expires_in
}
```

Here the agent token is bound to the agent's own key. An agent server that runs one session per
user can instead generate a key per session and send that public key as `delegate_public_key`; the
session then signs with its own key. Read
[references/token-flows.md](references/token-flows.md) for that, and for an agent that signs its
own agent tokens.

### 4. Get a resource token from the resource

The resource issues it. The agent sends the resource its identifier and the thumbprint of its key
(`aauth.publicJwkThumbprint`); how it asks is part of the resource's own API. If you also build
the resource, read [references/resource-server.md](references/resource-server.md).

### 5. Request an auth token

```ts
import { aauth, issueAgentToken } from './aauth-agent';

export async function getAuthToken(resourceToken: string): Promise<string> {
  const agentToken = await issueAgentToken();
  const result = await aauth.requestAuthToken({
    resourceToken,
    agentToken,
    redirectUri: 'https://my-agent.example.com/oauth/callback', // used only when consent is needed
  });

  if ('authorizationRequired' in result) {
    // A user must approve. Send the user's browser to result.authorizationUri.
    // Then call aauth.exchangeCode({ code, redirectUri, agentToken }) with the code from the callback.
    throw new Error(`User consent needed: ${result.authorizationUri}`);
  }
  return result.authToken;
}
```

The granted scope comes from the resource token. A `scope` in this request is ignored. Without a
user, every scope must be one of the agent's pre-authorized scopes, or the request fails with
`invalid_scope`.

### 6. Call the resource

```ts
import { aauth } from './aauth-agent';

export async function readData(authToken: string): Promise<unknown> {
  const res = await aauth.signedRequest('GET', 'https://api.example.com/v1/data', { authToken });
  if (!res.ok) throw new Error(`resource answered HTTP ${res.status}`);
  return res.json();
}
```

`signedRequest` sends the bearer token and signs the method, host, path, query, body digest and
the `Authorization` header. For a JSON body pass `data`.

### The same in Python

`pip install 'lumoauth[aauth]'`, then `AAuthClient` from `lumoauth` with `sign_request`,
`request_authorization`, `exchange_code`, `refresh` and `signed_request`. The Python client signs
with Ed25519 keys only, does not sign a query string and reports consent differently from the JS
client. Read [references/python.md](references/python.md) for the complete agent.

### 7. Verify AAuth requests in the resource

A resource must check two things on every request: the auth token, and that the request was
signed with the key in the token's `cnf.jwk`. A token without that second check is a bearer token.

```ts
import { verifyAuthToken } from '@lumoauth/agent';

const claims = await verifyAuthToken(bearerToken, {
  issuer: 'https://app.lumoauth.dev/orgs/acme-corp/api/v1',
  resource: 'https://api.example.com', // must equal the token's aud
});
// Next: verify the request signature against claims.cnf.jwk.
```

`verifyAuthToken` checks `typ`, the issuer, the JWS signature against `{issuer}/aauth/jwks.json`,
`exp`, `aud` and the presence of `cnf.jwk`. It does not check the request signature. Read
[references/resource-server.md](references/resource-server.md) for the complete Node.js verifier,
the Go, Java and .NET verifiers (which include the signature check), the checks that you must add
yourself, and how the resource issues resource tokens.

## Verify

1. `await aauth.discoverIssuer()` returns `aauth_version: "1.0"` and `agent_signing_algs_supported`
   with `ed25519`: the base URL and the organization are right.
2. `issueAgentToken()` returns a JWT whose header `typ` is `agent+jwt`.
3. `getAuthToken()` returns a JWT whose header `typ` is `auth+jwt`, whose `aud` is the resource
   identifier and whose `cnf.jwk.x` equals the `x` of the agent's public key.
4. The resource accepts the signed request, and rejects the same token sent without signature
   headers. Test this second case: it proves that proof of possession is enforced.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `401 authentication_required` from the token endpoint | Missing `Agent-Auth`, a bad signature, or the signing key is not the key in the agent token's `cnf` | Sign with the key that the agent token is bound to. The response is generic on purpose; an admin finds the reason in the audit log under `aauth.signature_verification_failed` |
| `401` from `/aauth/agent/issue` | The identifier or `kid` in `Signature-Key` does not match the registration, the key is not in the registered JWKS, or **Delegation to sub-agents** is off | Compare the three values with the portal. The identifier must match character for character, including `https://` and any trailing slash |
| Signature fails only sometimes | The clock is more than 60 seconds off, or a request was sent twice with the same headers | Sync the clock. Sign every request anew: `created` and `nonce` are single-use |
| Signature fails after you changed the body | The body was serialized twice | Send exactly the bytes that you signed. `Content-Digest` covers them |
| Python or PHP: `authorization_required` is `True` but `auth_url` is empty, or consent is never reported | The server answers consent with `200`, `request_token` and `authorization_uri`. Those two clients report a `401` (a refused signature or agent token) as `authorization_required` | Test for `auth_token` first, then for `authorization_uri`, as in `references/python.md`. Treat anything else as a refused request |
| `invalid_scope` | A scope in the resource token is not pre-authorized for the agent, and no user is in the loop | Add it to **Pre-authorized scopes**, or enable user authorization and pass `redirectUri` |
| `invalid_redirect_uri` | The redirect URI is not registered on the AAuth registration | Add it under **Redirect URIs** |
| `invalid_resource_token` | The resource token expired (5 minutes), names another agent or key, or has another audience | Get a new resource token for this agent and this key |
| `unauthorized_agent` | The agent is not registered or not active in this organization, or the feature (refresh, exchange) is off for it | Check the registration and the organization slug |
| The resource accepts a token without a signature | Only the JWT is verified | Add the request signature check. It is mandatory |

Never log tokens, the private key or the `Signature` header value together with the request.

## Related skills

- `lumoauth-agent-identity`: register agents, client credentials, private key JWT, the Ask API.
- `lumoauth-agent-delegation`: token exchange at the OAuth token endpoint and the `act` claim.
- `lumoauth-agent-approvals`: a human approves an action. AAuth user consents appear in the same
  approvals inbox.
- `lumoauth-agent-governance`: revoke an agent's AAuth credentials, conditional access.
- `lumoauth-api-protection`: verify ordinary OAuth access tokens in an API.

## References

- [references/resource-server.md](references/resource-server.md): read when you build the API that
  agents call: issue resource tokens, verify auth tokens and request signatures in Node.js, Go,
  Java and .NET.
- [references/token-flows.md](references/token-flows.md): read for consent, refresh, exchange
  between agents, revocation, per-session keys, self-signed agent tokens and the bridge to
  LumoAuth's own API.
- [references/signature-profile.md](references/signature-profile.md): read when you sign or verify
  without an SDK, or debug a rejected signature: covered components, parameters, algorithms,
  header formats, error codes.
- [references/python.md](references/python.md): read for the complete Python agent and the
  limits of the Python client.
- [references/other-languages.md](references/other-languages.md): read for the Go, PHP, .NET and
  Java clients.
- https://docs.lumoauth.dev/agents/aauth
- https://docs.lumoauth.dev/agents/aauth-quickstart
- https://docs.lumoauth.dev/agents/aauth-qs-nodejs
- https://docs.lumoauth.dev/agents/aauth-qs-python
- https://docs.lumoauth.dev/agents/aauth-spec
