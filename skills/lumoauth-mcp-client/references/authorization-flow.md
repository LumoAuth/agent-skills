# The MCP authorization flow from the client's side

Read this file when you write a client that signs a person in for an MCP server, or when you need the exact request and the exact error of one step. For an existing MCP client (Claude Code, the FastMCP client), `SKILL.md` step 2 is enough.

## The steps and their URLs

Example: MCP server `https://mcp.example.com/mcp`, organization `acme-corp` in the US region.

| # | Request | What the client takes from the answer |
|---|---|---|
| 1 | `POST https://mcp.example.com/mcp` without a token | `401` with `WWW-Authenticate: Bearer scope="mcp:read", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"` |
| 2 | `GET` the `resource_metadata` URL | `resource`, `authorization_servers[0]` (the issuer), `scopes_supported`, and `dpop_bound_access_tokens_required` when the server requires DPoP |
| 3 | `GET https://app.lumoauth.dev/.well-known/oauth-authorization-server/orgs/acme-corp/api/v1` | `issuer`, `authorization_endpoint`, `token_endpoint`, `code_challenge_methods_supported`, `client_id_metadata_document_supported`, `registration_endpoint` |
| 4 | Browser: `GET {authorization_endpoint}?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256&resource=https://mcp.example.com/mcp` | The user signs in and approves. The browser returns to `redirect_uri` with `code`, `state` and `iss` |
| 5 | `POST {token_endpoint}` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`, `resource` | `access_token`, `token_type`, `expires_in`, `scope`, and `refresh_token` when the client may have one |
| 6 | `POST https://mcp.example.com/mcp` with `Authorization: Bearer <access_token>` | The MCP response |

Notes for each step:

- **Step 1.** If the `401` has no `resource_metadata`, try `https://mcp.example.com/.well-known/oauth-protected-resource/mcp` (the well-known segment between the host and the path), then `https://mcp.example.com/.well-known/oauth-protected-resource`.
- **Step 2.** Refuse a document whose `resource` is not the URL that you called. `authorization_servers` holds the issuer, not the URL of a document.
- **Step 3.** The metadata location is built from the issuer: `/.well-known/oauth-authorization-server` goes between the host and the issuer's path. `{issuer}/.well-known/openid-configuration` returns the OpenID Connect form of the same data. On a verified custom domain the issuer is the bare domain, and the document is at `https://auth.example.com/.well-known/oauth-authorization-server`. Check that the document's `issuer` equals the issuer that you started from. Do not build endpoint or JWKS paths yourself.
- **Step 4.** Choose scopes in this order: the `scope` of the challenge, then `scopes_supported` of the metadata, then no `scope` parameter. Send `resource` with the exact Resource URI. `state` is a random value that the client checks on return.
- **Step 5.** A public client sends `client_id` and no secret. Repeat `resource`. An authorization code works once and expires after 5 minutes.
- **Step 6.** Send the token in the `Authorization` header of every request. Revision 2026-07-28 has no protocol sessions, so each request stands on its own.

## What LumoAuth checks

- PKCE with `S256` is required for public clients, for CIMD clients, and for any request that names an MCP server with **Require PKCE** on (the default). A request without `code_challenge` fails with `invalid_request` before the user sees a sign-in page.
- A `resource` that names a registered MCP server brings that server's settings with it: the list of allowed clients (`invalid_target`), the scope list (`invalid_scope`), the token lifetime, and the DPoP requirement (`invalid_dpop_proof`).
- A token names one MCP server. A second `resource` value fails with `invalid_target`.
- The token endpoint never adds an MCP server that the authorization request did not name. This holds for refresh tokens too.
- Consent is per MCP server. A user who approved the client for one server is asked again for another, even with the same scope names. The consent screen names the server and the host of the redirect URI.
- When a request leaves out `resource` but evidently targets a server (the client is on the server's allowed list, or it asks for one of the server's scopes), it fails with `invalid_target`, and the error description names the expected value.
- Every authorization response carries `iss`, error responses included. Compare it with the issuer to stop mix-up attacks.

## A complete client

This script runs the whole flow with Node 20 or later and no dependencies. It is TypeScript without type-only syntax, so it also runs unchanged as `mcp-client.mjs`. Register `http://127.0.0.1:8765/callback` as the redirect URI of the application (or list `http://127.0.0.1/callback` in a client metadata document).

```ts
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const MCP_URL = process.env.MCP_URL ?? 'https://mcp.example.com/mcp';
// The Client ID of a pre-registered application, or the https URL of a client metadata document.
const CLIENT_ID = process.env.MCP_CLIENT_ID ?? '';
const CALLBACK_PORT = Number(process.env.CALLBACK_PORT ?? 8765);
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

if (!CLIENT_ID) throw new Error('Set MCP_CLIENT_ID');

const b64url = (bytes) => bytes.toString('base64url');
const normalize = (uri) => {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
};
const getJson = async (url) => {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    return res.json();
};
const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const callMcp = (token) =>
    fetch(MCP_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(rpc),
    });

// 1. The challenge.
const first = await callMcp();
if (first.status !== 401) throw new Error(`Expected 401 without a token, got ${first.status}`);
const challenge = first.headers.get('www-authenticate') ?? '';
const param = (name) => new RegExp(`${name}="([^"]*)"`).exec(challenge)?.[1];
const metadataUrl = param('resource_metadata');
if (!metadataUrl) throw new Error('The 401 has no resource_metadata parameter');

// 2. Protected resource metadata.
const prm = await getJson(metadataUrl);
if (normalize(prm.resource) !== normalize(MCP_URL)) {
    throw new Error(`Metadata is for ${prm.resource}, not for ${MCP_URL}`);
}
if (prm.dpop_bound_access_tokens_required === true) {
    throw new Error('This server requires DPoP-bound tokens, which this script does not send');
}
const issuer = prm.authorization_servers[0];

// 3. Authorization server metadata, at the RFC 8414 location of the issuer.
const { origin, pathname } = new URL(issuer);
const as = await getJson(`${origin}/.well-known/oauth-authorization-server${pathname.replace(/\/$/, '')}`);
if (as.issuer !== issuer) throw new Error(`Metadata names issuer ${as.issuer}, not ${issuer}`);
if (!as.code_challenge_methods_supported?.includes('S256')) throw new Error('The server does not support PKCE S256');
if (CLIENT_ID.startsWith('https://') && as.client_id_metadata_document_supported !== true) {
    throw new Error('Client ID Metadata Documents are switched off for this organization');
}

// 4. PKCE, state and the authorization URL. `resource` pins the token to this MCP server.
const verifier = b64url(randomBytes(32));
const codeChallenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));
const scope = param('scope') ?? (prm.scopes_supported ?? []).join(' ');

const authorize = new URL(as.authorization_endpoint);
authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
    ...(scope ? { scope } : {}),
}).toString();

// 5. Receive the code on the loopback interface. Check state and iss.
const code = await new Promise((resolve, reject) => {
    const server = http
        .createServer((req, res) => {
            const u = new URL(req.url ?? '/', REDIRECT_URI);
            if (u.pathname !== '/callback') {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/plain' });
            if (u.searchParams.get('state') !== state) {
                res.end('state mismatch');
                reject(new Error('state mismatch'));
            } else if (u.searchParams.get('iss') !== issuer) {
                res.end('issuer mismatch');
                reject(new Error('issuer mismatch'));
            } else if (u.searchParams.get('error')) {
                res.end(`error: ${u.searchParams.get('error')}`);
                reject(new Error(u.searchParams.get('error_description') ?? u.searchParams.get('error')));
            } else {
                res.end('Signed in. You can close this tab.');
                resolve(u.searchParams.get('code'));
            }
            server.close();
        })
        .listen(CALLBACK_PORT, '127.0.0.1', () => {
            console.log(`Open this URL in a browser to sign in:\n\n${authorize}\n`);
        });
});

// 6. Exchange the code. A public client sends client_id and the PKCE verifier, no secret.
const tokenRes = await fetch(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: MCP_URL,
    }),
});
const tokens = await tokenRes.json();
if (!tokenRes.ok) throw new Error(`Token endpoint: ${tokens.error}: ${tokens.error_description}`);
console.log(`scope: ${tokens.scope} | expires_in: ${tokens.expires_in} | refresh_token: ${tokens.refresh_token ? 'yes' : 'no'}`);

// 7. Call the MCP server. Never print the token.
const answer = await callMcp(tokens.access_token);
console.log(answer.status, await answer.text());
process.exit(0);
```

Run it with the Client ID in the environment:

```bash
MCP_URL=https://mcp.example.com/mcp MCP_CLIENT_ID=client_0123456789abcdef0123456789abcdef node mcp-client.mjs
```

Keep tokens in memory or in the operating system's credential store. Do not write them to logs or to a file that is committed.

## Step-up: a tool needs another scope

A valid token that lacks a scope gets:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

Start a new authorization request (step 4) for the scopes that you hold plus the scopes in the challenge, with the same `resource`. The user sees a consent screen for the added scopes. Ask for a scope only when a tool needs it: start with the basic scopes from the first challenge.

## Refresh tokens

- A client gets a refresh token when its grant types include `refresh_token`. For a CIMD client that means `refresh_token` in the document's `grant_types`. The scope `offline_access` is not required and does not change this. Many MCP clients send it anyway, so a registered application must allow it or the request fails with `invalid_scope`.
- Refresh with `grant_type=refresh_token`, `refresh_token`, `client_id` and the same `resource`. The new access token names the same MCP server.
- A public client gets a new refresh token with each refresh, and the old one stops working. Store the new one. Using an old refresh token again revokes the whole sign-in.
- A refresh token cannot move to another MCP server. For a second server, run the authorization flow again with that server's `resource`.

## Servers that require DPoP

When the metadata holds `"dpop_bound_access_tokens_required": true`, plain bearer tokens are refused.

- The token request must carry a `DPoP` header with a proof JWT for the token endpoint. Without it, the answer is `invalid_dpop_proof`. The response then has `token_type: "DPoP"` and the token carries the key thumbprint in `cnf.jkt`.
- Each MCP request carries `Authorization: DPoP <access_token>` and a new proof for that request: `htm` is the method, `htu` the URL without query, and `ath` is `base64url(sha256(access_token))`.
- Use one signing algorithm from `dpop_signing_alg_values_supported`.
- In Node, `DpopProofSigner`, `buildDpopHeaders` and `fetchWithDpop` from `@lumoauth/agent` create the proofs (see `agent-tokens.md`). `lumoauth-oauth-advanced` explains DPoP in general.

## Errors from the token endpoint

| Error | Cause | Fix |
|---|---|---|
| `invalid_request`, missing `client_id` | A public client left out `client_id` | Send `client_id` on every token request |
| `invalid_grant`, invalid or expired code | The code was used before, or more than 5 minutes passed | Exchange the code at once, one time |
| `invalid_grant`, PKCE validation failed | `code_verifier` does not match the `code_challenge` | Keep the verifier from the same attempt |
| `invalid_client` | Wrong or missing client authentication; or a CIMD problem, with the reason in `error_description`; or a blocked client (`client_disabled`) | For CIMD, see `client-id-metadata-documents.md` |
| `invalid_target` | `resource` does not match a registered, active MCP server; the client is not on the server's allowed list; a second resource was sent; or the authorization request had no `resource` | Send the exact Resource URI in both requests, and only that one |
| `invalid_scope` | A scope is outside the MCP server's scope list, or the application does not allow it | Ask for scopes from the challenge; add the scope to the application |
| `invalid_dpop_proof` | The MCP server requires DPoP and the request has no valid proof | Send a proof, or ask the owner to switch **Require DPoP** off |

Errors from `/oauth/authorize` appear on a LumoAuth error page when the redirect URI or the client is not valid, and as `error` and `error_description` on the redirect otherwise. A user who chooses **Deny** returns with `access_denied`.
