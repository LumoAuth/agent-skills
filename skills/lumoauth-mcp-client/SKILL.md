---
name: lumoauth-mcp-client
description: >-
  Calls an MCP (Model Context Protocol) server that LumoAuth protects, from an MCP client, an
  app or an AI agent. Covers the authorization flow from the client's side (401 challenge,
  protected resource metadata, authorization code with PKCE and the `resource` parameter, a
  token bound to one MCP server), Client ID Metadata Documents (CIMD), pre-registered
  applications and dynamic client registration, connecting Claude Code and the FastMCP client,
  an agent's token for one MCP server by token exchange (`mcp.getToken`, `get_mcp_token`,
  `MCPToken`) with the LumoAuth SDKs, DPoP-bound tokens, and the agent self-check
  `agents.authorizeMcpTool`. Use when the user wants to connect to, sign in to or call a
  LumoAuth-secured MCP server, host a client metadata document, or fix errors such as
  `invalid_target`, a wrong audience, a missing `resource`, an invalid redirect URI or a
  blocked client. Not for protecting the MCP server itself, which is `lumoauth-mcp-server`.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# Call a LumoAuth-protected MCP server

Get an access token that one MCP server accepts, and send it with every request. LumoAuth is the authorization server. A token for an MCP server names exactly that server in its `aud` claim: it works there and nowhere else, and the LumoAuth API refuses it. LumoAuth follows the MCP Authorization specification, revision 2026-07-28.

## When to use

- Connect an existing MCP client (Claude Code, the FastMCP client, another MCP host) to a server that answers `401` with a `WWW-Authenticate` challenge.
- Write a client that runs the flow itself: discovery, authorization code with PKCE, the `resource` parameter.
- Publish a Client ID Metadata Document (CIMD) so that the client needs no registration.
- Give an AI agent that has its own LumoAuth identity a token for one MCP server.
- Find out why a token request or an MCP call is refused.

Do not use this skill for:

- Adding authorization to the MCP server. Use `lumoauth-mcp-server`.
- Registering the agent or choosing its credential. Use `lumoauth-agent-identity`.
- An agent that acts for a signed-in user (delegation). Use `lumoauth-agent-delegation`.
- A general OAuth or OIDC sign-in that involves no MCP server. Use `lumoauth-oauth-oidc`.

## Before you start

Decide who the caller is. The path depends on it.

| The caller | How it gets a token | Step |
|---|---|---|
| A person who uses an MCP client or an app | Authorization code with PKCE and `resource`, in the browser | 1 to 3 |
| An AI agent with its own LumoAuth identity | Token exchange for one MCP server (`mcp.getToken`) | 4 |
| A quick test from the terminal | A short-lived token that an admin mints for an agent | Verify |

Collect these values. Ask the user for each value that you cannot find. Do not guess one.

| Value | Example | Where it comes from |
|---|---|---|
| MCP server URL | `https://mcp.example.com/mcp` | The server's owner. It must equal the server's registered Resource URI exactly |
| Organization issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` | `authorization_servers` in the server's metadata document. EU region: `https://eu.app.lumoauth.dev/…` |
| Client identity | `https://client.example.com/oauth/metadata.json`, or `client_0123…` | Step 1 |
| Redirect URI | `http://localhost:8765/callback` | The client. It must be registered exactly (step 1) |
| Scopes | `mcp:read` | The `scope` in the `401` challenge, then `scopes_supported` in the metadata |
| Agent credentials (agents only) | `AGENT_CLIENT_ID`, `AGENT_CLIENT_SECRET` | `lumoauth-agent-identity` |

Rules that hold on every path:

- Send the token only to the MCP server that it was issued for, in the `Authorization` header of every request. Never put a token in a URL, and never log one.
- One token per MCP server. A request that names two MCP servers fails with `invalid_target`.
- Public clients (desktop, CLI, browser, mobile) hold no secret. They use PKCE with `S256`.

## Steps

### 1. Choose how the client identifies itself

LumoAuth accepts three methods. Try them in this order.

| Method | Use it when | What to do |
|---|---|---|
| Client ID Metadata Document (CIMD) | You publish the client and can host a JSON file at a public `https://` URL. On by default in every organization | The URL of the file is the `client_id`. No registration call. Read [references/client-id-metadata-documents.md](references/client-id-metadata-documents.md) |
| Pre-registered application | The MCP client lets you type a client ID, or the organization restricts the server to chosen clients | An admin creates an application and gives you its Client ID (below) |
| Dynamic client registration | The client can only register itself. Deprecated in MCP 2026-07-28 and off by default in LumoAuth | Read [references/client-registration.md](references/client-registration.md) |

To pre-register a client, an organization admin does this in the portal. It creates an application, so show the user the plan first.

1. Open **Applications**, click **New application** and choose **Single-page or mobile app**.
2. Set **Application name** and the **Redirect URI** that the client uses, for example `http://localhost:8765/callback`.
3. Click **Create application** and copy the **Client ID**.
4. On the **Configuration** tab, set **Scopes** to every scope that the client sends, for example `openid profile email offline_access mcp:read`. Many MCP clients add `offline_access` on their own. Click **Save configuration**.

### 2. Connect an existing MCP client

Claude Code, with a pre-registered application and a fixed callback port:

```bash
claude mcp add --transport http \
  --client-id client_0123456789abcdef0123456789abcdef \
  --callback-port 8765 \
  invoices https://mcp.example.com/mcp

claude mcp login invoices
claude mcp list
```

The browser opens on the LumoAuth sign-in page. After sign-in and consent, `claude mcp list` shows the server as connected.

The FastMCP client (Python), with the same application:

```python
import asyncio

from fastmcp import Client
from fastmcp.client.auth import OAuth

auth = OAuth(client_id="client_0123456789abcdef0123456789abcdef", callback_port=8765)


async def main() -> None:
    async with Client("https://mcp.example.com/mcp", auth=auth) as client:
        result = await client.call_tool("whoami")  # use the name of a tool on this server
        print(result.data)


asyncio.run(main())
```

Other MCP clients connect the same way when they let you set a client ID and a callback port. For Claude, ChatGPT and a generic `mcp.json` client, the organization's admin can copy ready-made snippets from the server's page in the portal (**AI Agents → MCP servers → the server → Discovery and client setup**).

Two settings of the MCP server determine whether a client can connect:

- A server registered with **Require DPoP** accepts only clients that send DPoP proofs. The package READMEs state that Claude Code and the FastMCP client send none, and the documentation states the same for ChatGPT connectors. Ask the server's owner to switch the requirement off for such clients.
- A server with **Allowed clients** set accepts only the listed applications. Any other client gets `invalid_target`.

### 3. Run the flow in your own client

The client does these steps. [references/authorization-flow.md](references/authorization-flow.md) has each request, a complete script and the error table.

1. Call the MCP server without a token. Read `resource_metadata` and `scope` from the `WWW-Authenticate` header of the `401`.
2. Fetch the metadata document. Check that `resource` equals the URL that you called. Take the issuer from `authorization_servers`.
3. Fetch the authorization server metadata from the issuer and check that its `issuer` field equals that value.
4. Send the user to `authorization_endpoint` with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256` and `resource=<MCP server URL>`.
5. On the callback, check `state` and that `iss` equals the issuer. Exchange the code at `token_endpoint` with `code_verifier`, `client_id`, `redirect_uri` and the same `resource`.
6. Send `Authorization: Bearer <access_token>` with every MCP request.
7. On `403` with `error="insufficient_scope"`, authorize again with the scopes that the challenge names added to the ones that you hold.

### 4. An agent gets a token for one MCP server

An agent that is registered in LumoAuth exchanges its own token for one that names the MCP server (RFC 8693 token exchange with the `resource` parameter). The SDKs do this in one call. Pass the server's Resource URI.

When the MCP server defines scopes, the agent needs a capability that covers at least one of them, for example the capability `mcp.read` for the scope `mcp:read`. The token then carries the server's scopes that the agent's capabilities cover. When none is covered, the exchange fails with `invalid_scope`.

TypeScript (`npm install @lumoauth/agent`, version 1.4.0, Node 18 or later):

```ts
import { LumoAgent } from '@lumoauth/agent';

const MCP_URL = 'https://mcp.example.com/mcp';

// Reads LUMOAUTH_ORG_ID, AGENT_CLIENT_ID and AGENT_CLIENT_SECRET (and LUMOAUTH_URL for the EU region).
const agent = new LumoAgent();
const token = await agent.mcp.getToken(MCP_URL);

const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log(response.status, await response.text());
```

Python (`pip install lumoauth`, version 1.4.0, Python 3.9 or later):

```python
import requests
from lumoauth import LumoAuthAgent

MCP_URL = "https://mcp.example.com/mcp"

# Reads LUMOAUTH_ORG_ID, AGENT_CLIENT_ID and AGENT_CLIENT_SECRET (and LUMOAUTH_URL for the EU region).
agent = LumoAuthAgent()
credential = agent.get_mcp_credential(MCP_URL)  # raises when LumoAuth refuses the exchange

response = requests.post(
    MCP_URL,
    headers={**credential.headers("POST", MCP_URL), "Accept": "application/json, text/event-stream"},
    json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    timeout=30,
)
print(response.status_code, response.text)
```

`agent.get_mcp_token(MCP_URL)` returns only the token string, and `None` when the exchange fails. In real code, give the token to the MCP client library that the agent already uses, as its `Authorization` header. Read [references/agent-tokens.md](references/agent-tokens.md) for Go, PHP, C# and Java, for DPoP-bound tokens, and for the rules on scopes.

The agent's secret stays on the server that runs the agent. Never put `AGENT_CLIENT_SECRET` in browser or mobile code.

### 5. Let the agent check a tool before it calls (optional)

When the MCP server uses LumoAuth's per-tool policy, the agent can ask in advance whether it may run a tool. The call uses the agent's own credential and the registered server id (`mcp_…`), not the Resource URI.

```ts
const decision = await agent.authorizeMcpTool('mcp_0123456789abcdef01234567', 'refund');
if (!decision.allowed) {
    // Do not call the tool. Choose another tool or ask a person.
}
```

```python
decision = agent.authorize_mcp_tool("mcp_0123456789abcdef01234567", "refund")
if not decision.allowed:
    ...  # do not call the tool
```

A deny returns `allowed` false and does not raise. An id that is not an active registered server raises a not-found error (`404 unknown_server`). The call counts against the agent's budget. The MCP server still makes its own check: this call only saves a refused request.

## Verify

1. Fetch the server's metadata and confirm the Resource URI and the issuer:

   ```bash
   curl -i -X POST https://mcp.example.com/mcp          # 401 with resource_metadata="…"
   curl https://mcp.example.com/.well-known/oauth-protected-resource/mcp   # the URL from resource_metadata
   ```

2. Decode the access token's payload locally (do not paste it into a website). `aud` must be the MCP server URL, `iss` the organization issuer, and `scope` must hold what the tool needs.
3. Call `tools/list` with the token. A `200` proves the whole chain.
4. For a test without a browser, an admin can mint a short-lived token for a registered agent. The command creates a token, so show it first. It is refused for a server that requires DPoP:

   ```bash
   lumo agents token agt_0123456789abcdef --scopes mcp:read --resource https://mcp.example.com/mcp --ttl 600
   ```

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The MCP server answers `401` and names an audience mismatch | The token was requested without `resource`, or for another URL | Send `resource=<Resource URI>` on the authorization request and on the token request |
| `invalid_target` at the token endpoint | The `resource` is not a registered, active MCP server; or the client is not on the server's **Allowed clients** list; or the authorization request carried no `resource` | Use the exact Resource URI in both requests; ask the admin to add the client |
| The client reports `Protected resource … does not match expected …` | The client connects to a URL that differs from the Resource URI. `localhost` and `127.0.0.1` count as different | Connect to the Resource URI exactly |
| `Invalid Redirect URL` on a LumoAuth page | The redirect URI is not registered for the application. A changing port is accepted only on `127.0.0.1` and `[::1]`, not on `localhost` | Register the exact URI and give the client a fixed callback port |
| `invalid_scope … not allowed for this client` | The application does not allow a scope that the client sends, often `offline_access` | Add the scope to the application's **Scopes** |
| `invalid_scope` naming the MCP server | The scope is not in the server's scope list | Ask only for scopes from the challenge or the metadata |
| `Dynamic client registration is not enabled` | The client tried to register itself | Give the client a client ID (step 1), or publish a metadata document |
| `invalid_dpop_proof` or `DPoP proof required` | The server requires DPoP and the client sent no proof | Use a client that sends proofs, or ask the owner to switch **Require DPoP** off |
| `Client metadata document rejected` or `invalid_client` with a reason | The CIMD file breaks a rule | Look up the reason in [references/client-id-metadata-documents.md](references/client-id-metadata-documents.md) |
| **Application blocked**, or `invalid_client` with `client_disabled` | An admin blocked this client in the organization | Ask the admin to unblock it. Users must then sign in again |
| The LumoAuth API refuses the MCP token | A token for an MCP server works only at that server | Use the agent's or user's own token for LumoAuth calls |

[references/troubleshooting.md](references/troubleshooting.md) has more cases, with the place to look for each.

## Related skills

- `lumoauth-mcp-server`: protect the MCP server and register its Resource URI and scopes.
- `lumoauth-agent-identity`: register an agent and choose its credential.
- `lumoauth-agent-delegation`: an agent that acts for a signed-in user.
- `lumoauth-agent-approvals`: human approval when a tool asks for a just-in-time permission.
- `lumoauth-oauth-oidc`: the authorization code flow, refresh tokens and dynamic client registration in general.
- `lumoauth-oauth-advanced`: DPoP and resource indicators in depth.

## References

- [references/authorization-flow.md](references/authorization-flow.md): every request of the flow, a complete client script, step-up, refresh, errors.
- [references/client-id-metadata-documents.md](references/client-id-metadata-documents.md): hosting a metadata document, required fields, what is refused, the check tool.
- [references/client-registration.md](references/client-registration.md): pre-registered applications, redirect URI rules, dynamic client registration.
- [references/agent-tokens.md](references/agent-tokens.md): token exchange and the self-check in every SDK, DPoP, test tokens.
- [references/troubleshooting.md](references/troubleshooting.md): symptoms, causes and fixes.
- https://docs.lumoauth.dev/mcp/authorization-flow
- https://docs.lumoauth.dev/mcp/client-id-metadata-documents
- https://docs.lumoauth.dev/mcp/cimd-sample
- https://docs.lumoauth.dev/mcp/resource-metadata
- https://docs.lumoauth.dev/oauth/resource-indicators
- https://docs.lumoauth.dev/quickstarts/ai-agent-mcp-5min
