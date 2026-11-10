# `@lumoauth/mcp` and the `lumoauth` proxy: reference

Read this file when a TypeScript MCP server needs more than the quick start in `SKILL.md` (SDK v2, a `fetch` handler, guard options, DPoP with several replicas), or when you run `npx lumoauth secure`, `npx lumoauth check` or `npx lumoauth ext-authz` and need a flag.

## Packages

| | `@lumoauth/mcp` | `lumoauth` |
|---|---|---|
| What it is | Library for servers built with the official TypeScript MCP SDK | Command line proxy (`npx lumoauth …`) for any MCP server |
| Version described here | 1.3.1 | 1.3.1 |
| Node | 20 or later | 20 or later |
| Dependencies | `@lumoauth/agent` `^1.2.0`, `@lumoauth/shared` `^1.2.0` | `@lumoauth/mcp` `^1.3.1`, `@modelcontextprotocol/sdk` `^1.32.2` |
| MCP SDK | Not a dependency: install `@modelcontextprotocol/sdk` (v1) or `@modelcontextprotocol/server` (v2) yourself. The package is tested with `@modelcontextprotocol/sdk` 1.32 and `@modelcontextprotocol/server` 2.4 | Included |

The token check uses `node:crypto`. The package README states that it runs on Node 20+, Bun and Deno.

## `lumoAuth(options)`

`lumoAuth(options?)` returns a `LumoMcpAuth`. Every option is optional.

| Option | Environment variable | Default and meaning |
|---|---|---|
| `orgId` | `LUMOAUTH_ORG_ID` | The organization slug. Required unless `issuer` is set |
| `serverId` | `LUMOAUTH_MCP_SERVER_ID` | The registered server id (`mcp_…`). Without it pass `resource` |
| `resource` | `LUMOAUTH_MCP_RESOURCE` | The Resource URI. Default: from the registration |
| `lumoauthUrl` | `LUMOAUTH_URL` | `https://app.lumoauth.dev`. Set `https://eu.app.lumoauth.dev` for the EU region |
| `issuer` | `LUMOAUTH_ISSUER` | `{lumoauthUrl}/orgs/{orgId}/api/v1`. Set it for a custom domain |
| `clientId`, `clientSecret` | `LUMOAUTH_MCP_CLIENT_ID`, `LUMOAUTH_MCP_CLIENT_SECRET` | The MCP server's own OAuth client, for the per-tool policy |
| `agentToken` | `LUMOAUTH_AGENT_TOKEN` | An agent credential for `vaultToken()` |
| `requiredScopes` | none | Scopes that every request must carry |
| `scopesSupported` | none | Scopes to advertise. Default: the registration's basic scopes |
| `requireDpop` | none | Default: the registration's **Require DPoP** switch |
| `publicUrl` | none | Public origin of this server for the DPoP `htu` check. Default: the origin of the Resource URI |
| `requestUrl` | none | `(request) => string`: builds the public URL of a request when a proxy rewrites paths |
| `replayCache` | none | Store for DPoP proof ids. Default: in memory. Share one between replicas |
| `clockSkew` | none | Leeway in seconds for `exp` and `nbf`. Default 60 |
| `authorizationServerMetadata` | none | Default `true`: also serve LumoAuth's metadata at `/.well-known/oauth-authorization-server` |
| `toolDecisionTtl` | none | Seconds to cache a per-tool decision. Default 30; `0` disables |
| `vaultTokenTtl` | none | Seconds to cache a Token Vault token. Default 60; `0` disables |
| `registration`, `fetch`, `env` | none | A registration to use in place of the fetch, a custom `fetch`, and the environment to read (default `process.env`), for tests |

`lumoAuth()` throws `LumoAuthConfigError` at once when neither the organization nor an issuer is set, or when there is no server id and no Resource URI. The registration itself is read on the first request. Call `await auth.ready()` at start-up to read it sooner and to fail on a wrong server id.

## Methods of `LumoMcpAuth`

| Method | Use |
|---|---|
| `auth.router()` | Express or `node:http` middleware that serves the discovery documents. Mount it at the root: `app.use(auth.router())` |
| `auth.protect({ requiredScopes? })` | Middleware that requires a valid token and sets `req.auth`, which the SDK transport passes to tool handlers |
| `auth.discovery(request)` | For `fetch` handlers: the discovery `Response` for this request, or `undefined` |
| `auth.gate(request, { requiredScopes? })` | For `fetch` handlers: the verified auth info, or the `Response` to return |
| `auth.authenticate(request, { requiredScopes? })` | The same check for your own adapter; throws `LumoAuthChallenge` (`status`, `wwwAuthenticate`, `body`) |
| `auth.ready()` | Resolves the configuration and fetches the registration once |
| `auth.guard(tool, handler, options)` | Wraps one tool handler with access checks |
| `auth.secureTools(server, options)` | Guards every tool on an `McpServer` and filters `tools/list` |
| `auth.scopeChallenge(...scopes)` | An SDK v2 `scopeChallenge` that follows LumoAuth's wildcard rule |
| `auth.toolPolicy()` | The `ToolPolicy` object: `await auth.toolPolicy().isAllowed(caller, tool)` |
| `auth.hasToolPolicy` | `true` when the server id, the organization and both client credentials are set |
| `auth.protectedResourceMetadata()` | The metadata document that the server publishes |
| `auth.vaultToken(connectionId, extra)` | A short-lived outbound token from the Token Vault |

`protect()` and `gate()` verify the signature against the organization's keys, issuer, audience (in LumoAuth's normal form), expiry and the `at+jwt` type, and they reject portal test tokens. A DPoP-bound token must come with the `DPoP` scheme and a valid proof. An opaque token is rejected: set the client application to JWT access tokens. When the organization's keys cannot be fetched, the answer is `503`.

## SDK v2 with a `fetch` handler

```ts
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { getCaller, lumoAuth } from '@lumoauth/mcp';

const auth = lumoAuth();

function buildServer(): McpServer {
    const server = new McpServer({ name: 'invoices', version: '1.0.0' });
    server.registerTool('whoami', { description: 'Show who is calling' }, async (ctx) => ({
        content: [{ type: 'text', text: getCaller(ctx)?.sub ?? 'unknown' }],
    }));
    return server;
}

const handler = createMcpHandler(() => buildServer());

export async function fetchHandler(request: Request): Promise<Response> {
    const discovery = await auth.discovery(request);
    if (discovery) return discovery;
    const authInfo = await auth.gate(request);
    if (authInfo instanceof Response) return authInfo;
    return handler.fetch(request, { authInfo });
}
```

## SDK v2 with Express

`toNodeHandler` from `@modelcontextprotocol/node` forwards `req.auth` to the handler:

```ts
app.use(auth.router());
app.post('/mcp', auth.protect(), toNodeHandler(handler));
```

`toNodeHandler` reads the request body itself, so a route behind `express.json()` answers `400 Parse error`. If the app needs that parser, pass the parsed body on:

```ts
const mcp = toNodeHandler(handler);
app.post('/mcp', auth.protect(), (req, res) => mcp(req, res, req.body));
```

## The caller

`getCaller(extra)` (SDK v1) or `getCaller(ctx)` (SDK v2) returns a `LumoCaller`, or `undefined` for a request without auth info, as on stdio.

| Field | Meaning |
|---|---|
| `sub` | The user id, or `agent_agt_…` for an agent |
| `isAgent`, `agentId` | An AI agent and its `agt_…` id |
| `isDelegated`, `actor`, `actChain` | An agent acts for the user `sub`; `actor` is the `sub` of the immediate actor |
| `scopes`, `capabilities` | Granted scopes; the agent's capabilities |
| `clientId` | The OAuth client (the agent id for an agent token) |
| `issuer` | The token's issuer |
| `dpopJkt` | The key thumbprint of a DPoP-bound token |
| `isJit`, `authorizationDetails` | A just-in-time approval and its granted details |
| `traceparent`, `traceId` | The validated W3C `traceparent` header and its trace id |
| `claims` | Every verified claim |

## Guard options

`auth.guard(name, handler, options)` takes `GuardOptions`. `auth.secureTools(server, options)` takes the same options, except that `scopes` and `jit` are maps from tool name to requirement.

| Option | Meaning |
|---|---|
| `scopes` | Scopes that the tool needs. A granted `prefix:*` scope covers the scopes under it; every other scope compares exactly |
| `agents` | `true`: AI agents only. `['billing.reminders']`: agents with these capabilities |
| `users` | `true`: people only. `'delegated'`: also an agent that acts for a person |
| `jit` | Require a just-in-time approval: a type string, or `{ type, actions?, locations?, identifier? }`, or a list of them |
| `policy` | Ask LumoAuth's per-tool policy. Default: on when `auth.hasToolPolicy` is `true` |
| `allowUnauthenticated` | `true`: run the tool on a request without auth info (stdio). Default: reject |
| `filterList` (`secureTools` only) | Hide tools that the caller may not run from `tools/list`. Default `true` |
| `hideJitUntilGranted` (`secureTools` only) | Also hide tools whose `jit` requirement is not met. Default `false` |

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lumoAuth } from '@lumoauth/mcp';
import { z } from 'zod';

const auth = lumoAuth();

function buildServer(): McpServer {
    const server = new McpServer({ name: 'invoices', version: '1.0.0' });
    auth.secureTools(server, {
        scopes: { refund: ['invoices:refund'] },
        jit: { wire_transfer: { type: 'payment_initiation', actions: ['wire'] } },
    });
    server.registerTool('refund', { inputSchema: { invoiceId: z.string() } }, async ({ invoiceId }) => ({
        content: [{ type: 'text', text: `Refunded ${invoiceId}` }],
    }));
    return server;
}
```

- `secureTools` guards tools that were registered before the call and tools that are registered after it.
- A rejected call becomes an error result that the model can read (`ToolAccessDeniedError`, or `InsufficientAuthorizationDetailsError` for a missing approval).
- With SDK v2, `scopeChallenge: auth.scopeChallenge('invoices:refund')` on `registerTool` turns a missing scope into `403 insufficient_scope`, so the client can ask the user for the scope.
- A client presents a just-in-time approval inside its MCP token or in the `X-LumoAuth-Jit-Token` header. The package accepts that token only when its `sub` equals the caller's `sub` or actor. `lumoauth-agent-approvals` covers the agent's side.
- Decisions of the per-tool policy are cached for 30 seconds (`toolDecisionTtl`). When LumoAuth cannot be reached, the tool is rejected.

## DPoP with several replicas

Proof ids are kept in memory to stop replays. With several replicas, pass a shared `replayCache`. Its one method is `add(key, ttlSeconds)`, which returns `false` for a key that it already holds (a replay).

## The `lumoauth` command

```text
npx lumoauth secure --upstream <url> [options] [-- <command that starts it>]
npx lumoauth secure --stdio [options] -- <stdio server command>
npx lumoauth ext-authz [options]
npx lumoauth check [options]
```

| Flag | Environment variable | Meaning |
|---|---|---|
| `--org <slug>` | `LUMOAUTH_ORG_ID` | Organization |
| `--server <id>` | `LUMOAUTH_MCP_SERVER_ID` | Registered MCP server id |
| `--resource <uri>` | `LUMOAUTH_MCP_RESOURCE` | Resource URI, when there is no server id |
| `--lumoauth-url <url>` | `LUMOAUTH_URL` | Default `https://app.lumoauth.dev` |
| `--issuer <url>` | `LUMOAUTH_ISSUER` | Organization issuer, for a custom domain |
| `--upstream <url>` | | The MCP endpoint to protect, for example `http://127.0.0.1:8000/mcp` |
| `--stdio` | | The command after `--` is a stdio MCP server |
| `--port <n>`, `--host <address>` | `PORT` | Where to listen. Default `0.0.0.0:8080` |
| `--path <path>` | | Public path of the MCP endpoint. Default: the path of the Resource URI, or `/mcp` |
| `--scope <scope>` | | A scope that every request needs. Repeatable |
| `--public <path>` | | A path that is forwarded without a token, for health checks. Repeatable |
| `--jit <tool=type[:a,b]>` | | Require a just-in-time approval for a tool, for example `refund=payment_initiation:refund`. Repeatable |
| `--vault <slug=connection>` | `LUMOAUTH_AGENT_TOKEN` | Send a Token Vault token upstream as `X-LumoAuth-Vault-<Slug>-Token`. Repeatable |
| `--tool-policy` | `LUMOAUTH_MCP_CLIENT_ID`, `LUMOAUTH_MCP_CLIENT_SECRET` | Require the per-tool policy; fails at start-up without the credentials |
| `--no-tool-policy` | | Do not ask LumoAuth about tools |
| `--no-identity-headers` | | Do not send `X-LumoAuth-*` identity headers upstream |
| `-h`, `--help`; `-v`, `--version` | | Help; version |

Behaviour of `secure`:

- With `--upstream` and a command after `--`, the proxy starts the command and waits until the upstream listens.
- It serves the protected resource metadata, answers `401` with the challenge, and verifies each token (Bearer or DPoP) before anything reaches the upstream. It never passes the token on.
- It removes every `X-LumoAuth-*` header that the client sent, then adds the verified identity.
- It binds each `Mcp-Session-Id` to the caller that opened it.
- With the per-tool policy on (both client credential variables set, unless `--no-tool-policy`), it removes from `tools/list` the tools that the caller may not run, and it refuses those calls before they reach the upstream.
- HTTP mode streams everything except the JSON-RPC that it must read for the policy, so it works with any MCP revision. Stdio mode gives every MCP session its own server process; its HTTP side is the MCP SDK's Streamable HTTP transport, which serves protocol revisions up to 2025-11-25.

Identity headers that the upstream receives:

| Header | Value |
|---|---|
| `X-LumoAuth-Subject` | The user id, or `agent_agt_…` for an agent |
| `X-LumoAuth-Subject-Type` | `user` or `agent` |
| `X-LumoAuth-Agent-Id` | The agent's `agt_…` id |
| `X-LumoAuth-Actor` | The agent that acts for the user |
| `X-LumoAuth-Client-Id` | The OAuth client |
| `X-LumoAuth-Scopes` | The granted scopes, separated by spaces |
| `X-LumoAuth-Trace-Id` | The W3C trace id, when the request carried `traceparent` |
| `X-LumoAuth-Is-Jit` | `true` when the request carries a verified just-in-time approval |

The upstream must trust these headers only when the proxy is the only way to reach it. Bind the upstream to `127.0.0.1`.

`npx lumoauth check` prints the issuer, the server id, the Resource URI, the advertised scopes, whether DPoP is required, the discovery document, the `401` challenge, and what the authorization server advertises (PKCE S256, client metadata documents, dynamic registration). It changes nothing.

`npx lumoauth ext-authz --port 9001` (or `secure --ext-authz`) runs an Envoy HTTP `ext_authz` check server for Kubernetes and service meshes. It answers `200` with the `X-LumoAuth-*` headers for Envoy to add, or `401`/`403` with the challenge. Without `--public`, the paths `/healthz` and `/readyz` need no token. Configure Envoy with `with_request_body` so that the per-tool policy and `--jit` can read `tools/call` requests.

## Production notes for the proxy

- Register the server with the public `https://` address of the proxy, and put the proxy behind the TLS terminator or tunnel at that address.
- Keep the upstream on `127.0.0.1`.
- Restart the proxy after a change to the registration.
