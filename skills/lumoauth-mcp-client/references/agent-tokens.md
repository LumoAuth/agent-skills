# An agent's token for one MCP server

Read this file when an AI agent with its own LumoAuth identity must call a protected MCP server: for the call in Go, PHP, C# or Java, for a server that requires DPoP, for the scope rules, or for the agent's self-check.

## What happens

1. The agent signs in to LumoAuth with its own credential. The SDKs do this with the client-credentials grant and refresh the token.
2. The agent exchanges that token for a second token (RFC 8693 token exchange). The MCP server's Resource URI goes in the `resource` parameter and becomes the `aud` of the new token.
3. The agent sends the second token to the MCP server, and only there.

The second token names exactly one MCP server. The LumoAuth API refuses it, so the agent keeps its own token for LumoAuth calls. For another MCP server, exchange again with that server's Resource URI.

Pass the **Resource URI** (an absolute `https://` URL without a fragment; `http://` only for local hosts) to the token call. An id such as `urn:mcp:finance` or the registered id `mcp_…` is refused by the SDK with a validation error before any request. The registered id (`mcp_…`) belongs to the self-check, not to the token call.

## Scopes of the token

- The SDK helpers send no `scope`. The token then gets the MCP server's scopes that the agent's capabilities cover. When the server defines scopes and none is covered, the exchange fails with `invalid_scope`.
- Capabilities match in any spelling: the capability `files.read`, `files:read` or `files.*` covers the scope `files:read`. The token carries the scope as the MCP server spells it.
- A scope that is not in the server's scope list fails with `invalid_scope`, even when a capability covers it.
- The lifetime is at most the MCP server's token lifetime.
- The list of allowed clients on the MCP server does not apply to agents. Per-tool grants determine which tools an agent may run.

To let an agent reach a server, give the agent a capability for each scope that it needs (`lumoauth-agent-identity`), for example `mcp.read`.

An agent that acts for a signed-in user uses the on-behalf-of exchange, which also takes one `resource`. That flow is in `lumoauth-agent-delegation`.

## The call in each SDK

Environment for the agent classes: `LUMOAUTH_ORG_ID`, `AGENT_CLIENT_ID`, `AGENT_CLIENT_SECRET`, and `LUMOAUTH_URL` for the EU region (`https://eu.app.lumoauth.dev`). An agent with the private key JWT identity type sets `AGENT_PRIVATE_KEY` (and `AGENT_KEY_ID`) in place of the secret in the JavaScript, Python and Go SDKs.

| SDK | Token for one MCP server | Self-check |
|---|---|---|
| JavaScript/TypeScript, `@lumoauth/agent` | `agent.mcp.getToken(resourceUri)`; `agent.mcp.getTokenDetailed(resourceUri)` | `agent.authorizeMcpTool(serverId, tool)` |
| Python, `lumoauth` | `agent.get_mcp_credential(resource_uri)`; `agent.get_mcp_token(resource_uri)` | `agent.authorize_mcp_tool(server_id, tool)` |
| Go, `lumo-auth-go` | `agent.MCPToken(ctx, resourceURI)`; `client.Mcp.Token(ctx, resourceURI, "")` | `agent.AuthorizeMcpTool(ctx, serverID, tool)` |
| PHP, `lumoauth/lumoauth` | `$agent->mcp->getToken($resourceUri)` | `$agent->agents->authorizeMcpTool(serverId: …, tool: …)` |
| C#, `LumoAuth` | `agent.McpTokenAsync(resourceUri)`; `agent.Mcp.TokenDetailedAsync(resourceUri, token)` | `agent.AuthorizeMcpToolAsync(serverId, tool)` |
| Java, `lumo-auth-java` | `agent.mcpToken(resourceUri)`; `agent.mcp().tokenDetailed(resourceUri, token)` | `agent.authorizeMcpTool(serverId, tool)` |

### TypeScript

```ts
import { LumoAgent } from '@lumoauth/agent';

const agent = new LumoAgent(); // reads the environment variables above
const detail = await agent.mcp.getTokenDetailed('https://mcp.example.com/mcp');
// detail.accessToken, detail.tokenType ('Bearer' or 'DPoP'), detail.expiresIn, detail.scope
```

A failed exchange throws `LumoAuthApiError` with the OAuth error code (`invalid_target`, `invalid_scope`, `invalid_dpop_proof`).

### Python

```python
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent()  # reads the environment variables above
credential = agent.get_mcp_credential("https://mcp.example.com/mcp")
headers = credential.headers("POST", "https://mcp.example.com/mcp")
# credential.access_token, credential.token_type, credential.expires_in, credential.scope
```

`get_mcp_credential` raises when LumoAuth refuses the exchange. `get_mcp_token` returns the token string, logs a refusal and returns `None`. On a plain `LumoAuth` client, `client.mcp.get_token(resource_uri, subject_token=None, dpop=None)` and `client.mcp.exchange(...)` do the same with the client's bearer token.

### Go

```go
// Imports: "context", "log", lumoauth "github.com/lumoauth/lumo-auth-go".
ctx := context.Background()
agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{}) // reads the environment variables above
if err != nil {
    log.Fatal(err)
}
token, err := agent.MCPToken(ctx, "https://mcp.example.com/mcp")
if err != nil {
    log.Fatal(err)
}
_ = token // send it as "Authorization: Bearer <token>" to the MCP server
```

### PHP

The PHP SDK has no agent class. Build a client that holds the agent's token:

```php
use LumoAuth\LumoAuth;

$base = new LumoAuth(orgId: 'acme-corp');
$tokens = $base->auth->clientCredentials(getenv('AGENT_CLIENT_ID'), getenv('AGENT_CLIENT_SECRET'));
$agent = new LumoAuth(orgId: 'acme-corp', tokenProvider: fn () => $tokens['access_token']);

$mcpToken = $agent->mcp->getToken('https://mcp.example.com/mcp');
```

### C#

```csharp
using LumoAuth;

using var agent = LumoAgent.FromEnvironment(); // AGENT_CLIENT_ID, AGENT_CLIENT_SECRET, LUMOAUTH_*
string mcpToken = await agent.McpTokenAsync("https://mcp.example.com/mcp");
```

### Java

```java
import io.lumoauth.LumoAgent;

LumoAgent agent = LumoAgent.fromEnvironment();
String mcpToken = agent.mcpToken("https://mcp.example.com/mcp");
```

The PHP, C# and Java helpers send no DPoP proof. They cannot get a token for an MCP server that requires DPoP.

## Send the token

Give the token to the MCP client library that the agent uses, as the `Authorization` header of every request. For a bearer token:

```http
POST /mcp HTTP/1.1
Host: mcp.example.com
Authorization: Bearer <token from the exchange>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Get a new token before `expiresIn` runs out. Do not cache a token beyond its lifetime, and do not share one token between agents.

## MCP servers that require DPoP

A server registered with **Require DPoP** accepts only tokens that are bound to a key that the caller holds. The JavaScript, Python and Go SDKs create the proofs. Agent tokens are bound only when the agent sends a proof: give the agent a signer.

TypeScript:

```ts
import { LumoAgent, DpopProofSigner, buildDpopHeaders } from '@lumoauth/agent';

const MCP_URL = 'https://mcp.example.com/mcp';
const dpop = DpopProofSigner.generate(); // one key per agent instance; ES256 by default
const agent = new LumoAgent({ dpop });

const mcp = await agent.mcp.getTokenDetailed(MCP_URL); // mcp.tokenType === 'DPoP'

// Each request needs a new proof that names the token.
const headers = await buildDpopHeaders(dpop, {
    method: 'POST',
    url: MCP_URL,
    accessToken: mcp.accessToken,
    tokenType: mcp.tokenType,
});
const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log(response.status);
```

`fetchWithDpop(fetch, url, init, dpop, { accessToken })` builds the headers and also retries once when the server answers with a `use_dpop_nonce` challenge.

Python (`pip install "lumoauth[dpop]"`):

```python
import requests
from lumoauth import LumoAuthAgent

MCP_URL = "https://mcp.example.com/mcp"
agent = LumoAuthAgent(dpop=True)  # an ephemeral key for this process
credential = agent.get_mcp_credential(MCP_URL)

response = requests.post(
    MCP_URL,
    headers={**credential.headers("POST", MCP_URL), "Accept": "application/json, text/event-stream"},
    json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    timeout=30,
)
print(response.status_code)
```

Call `credential.headers(method, url)` once for each request: a proof is valid for one request.

Go:

```go
// Imports: "bytes", "context", "log", "net/http", lumoauth "github.com/lumoauth/lumo-auth-go".
ctx := context.Background()
signer, err := lumoauth.NewDPoPSigner() // a new P-256 key, ES256 proofs
if err != nil {
    log.Fatal(err)
}
agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{DPoP: signer})
if err != nil {
    log.Fatal(err)
}
mcpToken, err := agent.MCPToken(ctx, "https://mcp.example.com/mcp")
if err != nil {
    log.Fatal(err)
}

body := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
req, _ := http.NewRequestWithContext(ctx, "POST", "https://mcp.example.com/mcp", body)
req.Header.Set("Content-Type", "application/json")
if err := signer.AuthorizeRequest(req, mcpToken); err != nil { // Authorization: DPoP <token> and the DPoP proof
    log.Fatal(err)
}
```

The private key of the signer stays in the agent's process or its secret store. A token that is bound to it is useless without the key.

## The self-check

`agents.authorizeMcpTool` asks LumoAuth whether this agent may run one tool on one registered MCP server. It is `POST {base}/orgs/{orgId}/api/v1/agents/me/mcp/authorize` with `{"server_id": "mcp_…", "tool": "…"}` and the agent's own credential.

```ts
const decision = await agent.authorizeMcpTool('mcp_0123456789abcdef01234567', 'refund');
// { allowed, agentId, resource: { type: 'mcp_tool', id: 'mcp_0123456789abcdef01234567/refund' } }
```

- Pass the registered server id, not the Resource URI. The owner of the MCP server has it (`lumo mcp servers`).
- A deny returns `allowed` false and does not raise.
- A `server_id` that is not an active registered server gives `404 unknown_server` (a not-found error in the SDKs). A caller that is not an agent gives `403 agent_required`.
- A tool name may not contain `/`, `:`, `#` or `*` and has at most 80 characters. The SDK refuses other names before any request.
- The call counts against the agent's budget and answers `429` when the budget is spent.
- Use the agent's own token for this call, never the token for the MCP server.
- The MCP server still checks the call when it arrives. An MCP server must not use this endpoint for its own check: it has a separate one (`lumoauth-mcp-server`).

## A test token without an agent process

An organization admin can mint a short-lived token for a registered agent, bound to one MCP server. The command creates a token: show it to the user first.

```bash
lumo agents token agt_0123456789abcdef --scopes mcp:read --resource https://mcp.example.com/mcp --ttl 600
```

- `--scopes` may only narrow the agent's capabilities. Without it the token gets every scope that the capabilities cover.
- `--ttl` is in seconds. The lifetime is capped at the MCP server's token lifetime.
- The route cannot bind a token to a key, so it is refused for a server that requires DPoP.
- `lumo mcp test <server-id> <agent-id> --method tools/list` mints such a token and calls the server's MCP endpoint URL in one step. Its flags are `--scope`, `--ttl` (default 300), `--method` (default `tools/list`) and `--params` (a JSON object).

Do not use an admin-minted token in production code. The agent's own credential and the exchange are the production path.
