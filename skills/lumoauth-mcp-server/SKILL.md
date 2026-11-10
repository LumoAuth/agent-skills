---
name: lumoauth-mcp-server
description: >-
  Adds OAuth authorization to an MCP (Model Context Protocol) server, with LumoAuth as the
  authorization server. Covers the PyPI package `lumoauth-fastmcp` for Python FastMCP servers,
  the npm package `@lumoauth/mcp` for servers built with the official TypeScript MCP SDK, the
  `npx lumoauth secure` proxy for any other HTTP or stdio MCP server, and an implementation by
  hand. Topics are registering the MCP server and its Resource URI, protected resource metadata
  (RFC 9728), the 401 `WWW-Authenticate` challenge, access token validation (issuer, audience,
  expiry, scopes, DPoP), reading the calling user or agent inside a tool, scope checks per tool,
  and per-tool authorization with `mcp.authorizeTool` and the `mcp:authorize` scope. Use when the
  user wants to secure or protect an MCP server, add sign-in, OAuth or access control to it,
  restrict MCP tools per user or agent, or test it with `lumo mcp test` and `lumo mcp check-tool`.
  Not for the client side of the flow, which is `lumoauth-mcp-client`.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# Add LumoAuth authorization to an MCP server

Make LumoAuth the authorization server of an MCP server. LumoAuth signs users in, shows consent and issues access tokens whose audience is the server's Resource URI. The MCP server stays a resource server: it publishes protected resource metadata, answers `401` with a challenge that points to that document, and verifies each token before it runs a tool. LumoAuth follows the MCP Authorization specification, revision 2026-07-28.

## When to use

- The user has an MCP server (Python FastMCP, the official TypeScript MCP SDK, or anything else) and wants only signed-in users or registered agents to call it.
- The user wants different tools for different callers: by scope, by person or agent, or by a policy that is stored in LumoAuth.
- The user wants to test the setup from the terminal or with a real MCP client.

Do not use this skill for:

- Code that calls a protected MCP server (an agent, an app, an MCP client). Use `lumoauth-mcp-client`.
- Registering an agent and its credentials. Use `lumoauth-agent-identity`.
- An ordinary REST API. Use `lumoauth-api-protection`.

## Before you start

Collect these values. Ask the user for each value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Organization slug | `acme-corp` | The part after `/orgs/` in the portal URL |
| Region base URL | `https://app.lumoauth.dev` (US), `https://eu.app.lumoauth.dev` (EU) | The host of the portal URL |
| Resource URI | `https://mcp.example.com/mcp` | The exact public URL that MCP clients connect to. You choose it in step 2 |
| Server id | `mcp_0123456789abcdef01234567` | Shown on the server's page after step 2, or `lumo mcp servers` |
| Scopes | `mcp:read`, `mcp:write` | You choose them in step 2 |

Rules that hold on every path:

- A stdio MCP server has no OAuth step. Authorization applies to HTTP transports. To protect a stdio server, serve it over HTTP with `npx lumoauth secure --stdio` (step 3C).
- The MCP server never sends the token that it received to another service, and that includes LumoAuth. The MCP specification forbids this "token passthrough".
- Secrets (`LUMOAUTH_MCP_CLIENT_SECRET`) come from environment variables. Never log an access token.

## Steps

### 1. Choose the path

| The server is | Use | Step |
|---|---|---|
| Python, built with FastMCP 4 | `lumoauth-fastmcp` (PyPI) | 3A |
| TypeScript or JavaScript, built with `@modelcontextprotocol/sdk` (v1) or `@modelcontextprotocol/server` (v2) | `@lumoauth/mcp` (npm) | 3B |
| Any other server over HTTP or stdio, or code that must not change | `npx lumoauth secure` (npm package `lumoauth`) | 3C |
| Any other server, with the checks in its own code | By hand | Read [references/manual-implementation.md](references/manual-implementation.md) |

### 2. Register the MCP server in the organization

Registration creates the record that binds tokens to this server. In the portal, open `{base}/orgs/acme-corp/portal/mcp-servers` (**AI Agents → MCP servers**) and click **Register MCP server**. The wizard has three steps.

1. **Describe the server.** Set **Server name** and **Resource URI**. The Resource URI must be `https://`. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. It cannot be changed after registration, so register one server for local development (`http://localhost:8000/mcp`) and another for production. With `npx lumoauth secure`, the Resource URI is the address of the proxy, not of the upstream server.
2. **Who may connect and how.** Keep **OAuth 2.1 protected** and the **Streamable HTTP** transport. Under **Scopes**, click **Use defaults**: this sets `mcp:read` and `mcp:write`, with `mcp:read` as the basic scope that the `401` challenge names. Decide on **Require DPoP sender-constrained tokens**: the portal switches it on for new servers, and a client that sends no DPoP proof cannot connect while it is on. The package READMEs state that Claude Code and the FastMCP client send no proofs, and the documentation states the same for ChatGPT connectors. Agents built on the LumoAuth JavaScript, Python and Go SDKs can send proofs.
3. **Review & connect.** Click **Register MCP server**, then copy the **Server id** (`mcp_…`) from the server's page.

If step 2 of the wizard does not take a change during registration, finish the registration, open the server's page, click **Edit** and make the change there. The package READMEs use this order.

To create the server from the terminal instead, show the user this command and wait for approval before you run it. It needs the `lumo` CLI with an identity that has the `agents.create` permission (an API key needs the scope `admin:agents:write`):

```bash
lumo api POST /mcp/servers --data '{
  "name": "Invoices",
  "resource_uri": "https://mcp.example.com/mcp",
  "endpoint_url": "https://mcp.example.com/mcp",
  "scopes_supported": ["mcp:read", "mcp:write"],
  "basic_scopes": ["mcp:read"],
  "require_dpop": false
}'
```

The response carries `data.server_id`. Read [references/registration.md](references/registration.md) for every setting, the rules for scope names and the differences between portal and API defaults.

### 3A. Python FastMCP: `lumoauth-fastmcp`

Version 1.3.1 needs Python 3.10 or later. It installs `fastmcp>=4.1,<5` and `lumoauth[verify]>=1.4.0`.

```bash
pip install lumoauth-fastmcp
```

```python
from fastmcp import FastMCP
from lumoauth_fastmcp import LumoAuthProvider, current_caller

mcp = FastMCP("Invoices", auth=LumoAuthProvider())


@mcp.tool
def whoami() -> str:
    """Show who is calling."""
    caller = current_caller()
    return caller.sub if caller else "no OAuth on this transport"


if __name__ == "__main__":
    mcp.run(transport="http", port=8000)
```

```bash
export LUMOAUTH_ORG_ID=acme-corp
export LUMOAUTH_MCP_SERVER_ID=mcp_0123456789abcdef01234567
# EU region only:
# export LUMOAUTH_URL=https://eu.app.lumoauth.dev
python server.py
```

`LumoAuthProvider()` reads the registration once at start-up: the Resource URI, the basic scopes and the **Require DPoP** switch. Restart the server after a change to the registration. Read [references/fastmcp.md](references/fastmcp.md) for every argument, the DPoP replay store for several workers, step-up approval (`require_jit`) and the Token Vault helper.

### 3B. TypeScript: `@lumoauth/mcp`

Version 1.3.1 needs Node 20 or later. It installs `@lumoauth/agent` and `@lumoauth/shared` (`^1.2.0`). The MCP SDK is not a dependency of the package: install it yourself.

```bash
npm install @lumoauth/mcp @modelcontextprotocol/sdk express
```

```ts
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getCaller, lumoAuth } from '@lumoauth/mcp';

const auth = lumoAuth(); // reads LUMOAUTH_ORG_ID and LUMOAUTH_MCP_SERVER_ID
await auth.ready(); // reads the registration now and fails on a wrong server id

function buildServer(): McpServer {
    const server = new McpServer({ name: 'invoices', version: '1.0.0' });
    server.registerTool('whoami', { description: 'Show who is calling' }, async (extra) => ({
        content: [{ type: 'text', text: getCaller(extra)!.sub }],
    }));
    return server;
}

const app = express();
app.use(express.json());
app.use(auth.router()); // serves the discovery documents
app.post('/mcp', auth.protect(), async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
        transport.close();
        server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});
app.listen(3000);
```

Set `LUMOAUTH_ORG_ID` and `LUMOAUTH_MCP_SERVER_ID` as in 3A (and `LUMOAUTH_URL` for the EU region). Register `http://localhost:3000/mcp` as the Resource URI for this example. Read [references/typescript.md](references/typescript.md) for SDK v2 with a `fetch` handler, every option and the caller fields.

### 3C. Any server: `npx lumoauth secure`

The npm package `lumoauth` (version 1.3.1, Node 20 or later) runs a proxy that does the same checks in front of a server. The server's code does not change.

```bash
export LUMOAUTH_ORG_ID=acme-corp
export LUMOAUTH_MCP_SERVER_ID=mcp_0123456789abcdef01234567

# An HTTP MCP server that already runs on port 8000
npx lumoauth secure --upstream http://127.0.0.1:8000/mcp

# A stdio MCP server, served over HTTP behind LumoAuth
npx lumoauth secure --stdio -- node server.js
```

The proxy listens on `0.0.0.0:8080` (`--port`, `--host` or `PORT`). It verifies the token, removes it, and sends the verified identity upstream in `X-LumoAuth-Subject`, `X-LumoAuth-Subject-Type`, `X-LumoAuth-Agent-Id`, `X-LumoAuth-Actor`, `X-LumoAuth-Client-Id` and `X-LumoAuth-Scopes`. Keep the upstream on `127.0.0.1`, so that callers reach it only through the proxy. Read [references/typescript.md](references/typescript.md) for all flags and the Envoy `ext-authz` mode.

### 4. Read the caller inside a tool

The caller is a person, an AI agent, or an agent that acts for a person.

| | FastMCP: `current_caller()` | TypeScript: `getCaller(extra)` (v1) or `getCaller(ctx)` (v2) |
|---|---|---|
| Subject (user id, or `agent_agt_…` for an agent) | `caller.sub` | `caller.sub` |
| Is an agent, and its `agt_…` id | `caller.is_agent`, `caller.agent_id` | `caller.isAgent`, `caller.agentId` |
| An agent acts for the user `sub` | `caller.is_delegated`, `caller.actor` | `caller.isDelegated`, `caller.actor` |
| Granted scopes, agent capabilities | `caller.scopes`, `caller.capabilities` | `caller.scopes`, `caller.capabilities` |

Both functions return nothing (`None`, `undefined`) for a request without OAuth, such as stdio. Use `sub` as the owner of stored data. Never take the caller's identity from a tool argument.

### 5. Restrict tools by scope or caller kind

```python
from fastmcp.server.middleware import AuthMiddleware
from lumoauth_fastmcp import LumoAuthProvider, require_agent, require_scopes, require_user

mcp = FastMCP(
    "Invoices",
    auth=LumoAuthProvider(),
    middleware=[AuthMiddleware(auth=require_scopes("mcp:read"))],  # 403 insufficient_scope step-up
)

@mcp.tool(auth=require_scopes("invoices:refund"))  # hidden from callers without the scope
def refund(invoice_id: str) -> str: ...

@mcp.tool(auth=require_user())  # people only; require_user(allow_delegation=True) admits an agent that acts for a person
def change_bank_details(iban: str) -> str: ...

@mcp.tool(auth=require_agent("billing.reminders"))  # agents with this capability
def send_reminder(invoice_id: str) -> str: ...
```

```ts
// Inside buildServer() from step 3B, before `return server`. Add: import { z } from 'zod';
auth.secureTools(server, { scopes: { refund: ['invoices:refund'] } }); // guards every tool, filters tools/list
server.registerTool(
    'change_bank_details',
    { inputSchema: { iban: z.string() } },
    auth.guard('change_bank_details', changeBankDetails, { users: true }), // people only
);
```

Add each new scope in two places: the MCP server's **Scopes**, and the **Scopes** of every application that may ask for it. Scopes compare exactly, with one exception: a granted scope that ends in `:*` covers the scopes under that prefix. Prefer narrow scopes.

### 6. Ask LumoAuth about each tool (optional)

A valid token proves that the caller may reach the server. For a decision per tool and per caller, the server asks LumoAuth with **its own** client-credentials token (scope `mcp:authorize`) and names the caller that it already verified.

1. Create a **Machine to machine** application for the MCP server and allow the scope `mcp:authorize` on it.
2. Edit the MCP server and select that application under **Per-tool authorization**.
3. Set `LUMOAUTH_MCP_CLIENT_ID` and `LUMOAUTH_MCP_CLIENT_SECRET` on the server, then restart it.
4. Switch the policy on: FastMCP `FastMCP("Invoices", auth=auth, middleware=[auth.tool_policy()])` with `auth = LumoAuthProvider()`; `@lumoauth/mcp` `auth.secureTools(server)` (the policy is on when both variables are set); the proxy switches it on when both variables are set.
5. Grant access. **Every tool is denied until a grant exists**, so an empty list of tools is the expected first result.

Read [references/per-tool-authorization.md](references/per-tool-authorization.md) for the grants, the SDK call `mcp.authorizeTool` in each language and the raw HTTP request.

## Verify

1. Call the server without a token. It must answer `401` with a challenge that names the metadata document:

   ```console
   $ curl -i -X POST http://localhost:8000/mcp
   HTTP/1.1 401 Unauthorized
   www-authenticate: Bearer scope="mcp:read", resource_metadata="http://localhost:8000/.well-known/oauth-protected-resource/mcp"
   ```

2. Fetch the URL in `resource_metadata`. `resource` must equal the Resource URI and `authorization_servers` must hold `https://app.lumoauth.dev/orgs/acme-corp/api/v1`.
3. Print what LumoAuth holds for the server: `lumo mcp discovery mcp_0123456789abcdef01234567`, or `npx lumoauth check` (registration, discovery document, challenge, and what the authorization server advertises).
4. Send a real token. `lumo mcp test mcp_0123456789abcdef01234567 agt_0123456789abcdef --method tools/list` mints a short-lived token for a registered agent and calls the server's **MCP endpoint URL**. It creates a token, so show the command first. It cannot test a server that requires DPoP.
5. Connect a real MCP client, for example Claude Code. `lumoauth-mcp-client` has the steps.
6. With the per-tool policy on: `lumo mcp check-tool mcp_0123456789abcdef01234567 refund --subject agent:agt_0123456789abcdef --client-id "$LUMOAUTH_MCP_CLIENT_ID"` with the secret in `LUMO_MCP_CLIENT_SECRET`. Exit status 0 means allowed, 1 means denied.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuth has no active MCP server` at start-up | Wrong server id or organization slug, or the wrong region | Copy both from the portal. Set `LUMOAUTH_URL` for the EU region |
| `MCP server … is registered as Public` at start-up | Authorization mode is **Public**, or the transport is stdio | Choose **OAuth 2.1 protected** and **Streamable HTTP** |
| The client reports `Protected resource … does not match expected …` | The client connects to a URL that differs from the Resource URI. `localhost` and `127.0.0.1` count as different | Connect to the Resource URI exactly |
| `invalid_dpop_proof` or `DPoP proof required` | **Require DPoP** is on and the client sends no proof | Switch it off for that server, then restart the MCP server |
| Every token is rejected for its audience | The client asked for a token without `resource`, or for another server | The client must send `resource=<Resource URI>`. Verify against the registered Resource URI |
| `curl` gets `404` in the TypeScript example | The route accepts only `POST` | `curl -i -X POST` |
| `400 Parse error` with SDK v2 and `toNodeHandler` | The route is behind `express.json()` | Pass the parsed body: `(req, res) => mcp(req, res, req.body)` |
| The list of tools is empty | The per-tool policy is on and no grant exists | Add grants ([references/per-tool-authorization.md](references/per-tool-authorization.md)) |
| The per-tool check answers `401` | The server sent the caller's token | Send the server's own `mcp:authorize` token |
| A change to the registration has no effect | The packages read the registration once | Restart the server or the proxy |
| A suspended agent still gets in | Local verification does not see a revocation before `exp` | Keep the token lifetime short, or introspect before an action that matters |

## Related skills

- `lumoauth-mcp-client`: connect an MCP client or an agent to the protected server.
- `lumoauth-agent-identity`: register the agents that call the server.
- `lumoauth-agent-approvals`: human approval (JIT permissions) for sensitive tools.
- `lumoauth-rebac`: the relationship grants behind the per-tool policy.
- `lumoauth-oauth-advanced`: DPoP and resource indicators in depth.
- `lumoauth-cli`: install and sign in to the `lumo` CLI.

## References

- [references/registration.md](references/registration.md): every registration setting, Resource URI and scope rules, Admin API and CLI.
- [references/fastmcp.md](references/fastmcp.md): `lumoauth-fastmcp` in full.
- [references/typescript.md](references/typescript.md): `@lumoauth/mcp` and the `lumoauth` proxy in full.
- [references/manual-implementation.md](references/manual-implementation.md): metadata, challenge and token validation by hand, with the SDK verifiers.
- [references/per-tool-authorization.md](references/per-tool-authorization.md): grants, `mcp.authorizeTool` per language, `lumo mcp check-tool`.
- https://docs.lumoauth.dev/mcp/
- https://docs.lumoauth.dev/mcp/registration
- https://docs.lumoauth.dev/mcp/server-implementation
- https://docs.lumoauth.dev/mcp/resource-metadata
- https://docs.lumoauth.dev/mcp/authorization-flow
