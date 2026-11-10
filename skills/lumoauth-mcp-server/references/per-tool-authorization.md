# Per-tool authorization with LumoAuth

Read this file when the MCP server must ask LumoAuth whether one caller may run one tool: to set it up, to grant access, to call `mcp.authorizeTool` from an SDK, or to find out why a tool is denied.

## How it works

A valid token proves that the caller may reach the MCP server. The per-tool check is a second question: may this user or agent run this tool?

1. The MCP server verifies the caller's token and reads `sub` from it.
2. The MCP server gets **its own** access token: the client-credentials grant of its own OAuth client, with the scope `mcp:authorize` and without a `resource` parameter. It caches that token until it expires.
3. The MCP server calls `POST {base}/orgs/{orgId}/api/v1/mcp/servers/{serverId}/tools/authorize` with its own token and names the caller and the tool.
4. LumoAuth answers `200` with `allowed: true`, or `403` with `allowed: false`.

Never send the caller's token to this endpoint. The MCP specification forbids token passthrough, and LumoAuth refuses such a token anyway: its audience is the MCP server, not LumoAuth. The client secret of the server's own client stays on the server.

`lumoauth-fastmcp` (`auth.tool_policy()`), `@lumoauth/mcp` (`auth.secureTools(server)`, `auth.guard(...)`) and `npx lumoauth secure` do steps 2 to 4 when `LUMOAUTH_MCP_CLIENT_ID` and `LUMOAUTH_MCP_CLIENT_SECRET` are set. They cache each decision for 30 seconds and refuse the tool when LumoAuth cannot be reached.

## Set up once

Each step changes the organization. Show the user what you are about to do.

1. **Create the server's own application.** In the portal open **Applications**, click **New application** and choose **Machine to machine**. Copy the **Client ID** and the **Client secret**. The secret is shown only once.
2. **Allow the scope.** On the application's **Configuration** tab, set **Scopes** to `mcp:authorize`. The form also asks for a redirect URI, which this application does not use: enter any `https://` URL. Click **Save configuration**.
3. **Connect it to the MCP server.** Edit the MCP server. In the step **Who may connect and how**, select the application under **Per-tool authorization**. In the Admin API this is the field `tool_authorizer_client_ids`.
4. **Give the server its credentials** in the environment, then restart it:

   ```bash
   export LUMOAUTH_MCP_CLIENT_ID=...       # the Client ID from step 1
   export LUMOAUTH_MCP_CLIENT_SECRET=...   # the Client secret from step 1
   ```

## Grant access

**Every tool is denied until a grant exists.** A grant is a relationship with the relation `invoke`. In the portal open **Relationships**. Under **Namespaces**, create the namespace that you need with the relation `invoke`. Under **Tuples**, add one relationship for each grant:

| To grant | Object namespace | Object ID | Relation | Subject |
|---|---|---|---|---|
| Every tool on the server | `mcp_server` | `mcp_0123456789abcdef01234567` | `invoke` | `user` and the user's id, or `agent` and the agent's id |
| One tool | `mcp_tool` | `mcp_0123456789abcdef01234567/refund` | `invoke` | `user` and the user's id, or `agent` and the agent's id |

- The object ID uses the registered server id, not the Resource URI.
- A tool name may not contain `/`, `:`, `#` or `*`. The SDKs accept at most 80 characters, and the server id and the tool name together must fit 99 characters.
- Availability of relationship grants depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix). Without the feature, every tool is denied.
- `lumoauth-rebac` covers namespaces and tuples through the API and the SDKs.

## The HTTP calls

```bash
# 1. The server's own token. No `resource` parameter.
SERVER_TOKEN=$(curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -d grant_type=client_credentials \
  -d client_id="$LUMOAUTH_MCP_CLIENT_ID" \
  -d client_secret="$LUMOAUTH_MCP_CLIENT_SECRET" \
  -d scope=mcp:authorize | jq -r .access_token)

# 2. The question. The subject is the `sub` of the caller's verified token.
curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/mcp/servers/mcp_0123456789abcdef01234567/tools/authorize \
  -H "Authorization: Bearer $SERVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "subject": { "type": "agent", "id": "agent_agt_0123456789abcdef" }, "tool": "refund" }'
```

```json
{
  "allowed": true,
  "subject": { "type": "agent", "id": "agt_0123456789abcdef" },
  "resource": { "type": "mcp_tool", "id": "mcp_0123456789abcdef01234567/refund" }
}
```

- `subject.type` is `user` or `agent`. For a user, `subject.id` is the user id from `sub`. For an agent, send `sub` as it is (`agent_agt_…`) or the bare agent id (`agt_…`).
- An optional `traceparent` request header links the decision to the caller's trace in the audit log.

| Status | Meaning |
|---|---|
| `200`, `allowed: true` | Run the tool |
| `403`, `allowed: false` | A decision: refuse the tool. An unknown subject also gets this answer |
| `400 invalid_request` | `subject` or `tool` is missing or malformed |
| `401 invalid_token` | The token is not a client-credentials token of this organization, or it is bound to another resource. This is the answer to a forwarded caller token |
| `403 insufficient_scope` | The token lacks `mcp:authorize` |
| `403 forbidden` | The client is not listed under **Per-tool authorization** for this server |
| `404 not_found` | The organization or the MCP server does not exist, or the server is not active |
| `429 too_many_requests` | Rate limited; `Retry-After` says when to try again. Cache decisions for a short time |

Treat every answer other than `200` with `allowed: true` as a refusal. Every decision is recorded as the audit event `mcp.tool.authorization`.

## SDK calls

In every SDK the per-tool check takes the registered server id (`mcp_…`), never the Resource URI. A deny returns a result with `allowed` false and does not raise. Real errors (missing scope, unknown server, rate limit) raise the SDK's usual error classes. The SDK client must hold the server's own token.

### TypeScript (`@lumoauth/agent`)

```ts
import { LumoAgent, type McpSubject } from '@lumoauth/agent';

// The MCP server's own client. Reads LUMOAUTH_ORG_ID (and LUMOAUTH_URL) from the environment.
const authorizer = new LumoAgent({
    clientId: process.env.LUMOAUTH_MCP_CLIENT_ID,
    clientSecret: process.env.LUMOAUTH_MCP_CLIENT_SECRET,
    scopes: ['mcp:authorize'],
});

// `sub` is the subject of the caller's verified MCP token.
export async function mayRun(sub: string, tool: string): Promise<boolean> {
    const subject: McpSubject = sub.startsWith('agent_') ? { type: 'agent', id: sub } : { type: 'user', id: sub };
    const decision = await authorizer.mcp.authorizeTool({
        serverId: 'mcp_0123456789abcdef01234567',
        subject,
        tool,
    });
    return decision.allowed;
}
```

`LumoAgent` runs the client-credentials grant and refreshes the token. `authorizeTool` also accepts `traceparent` and `signal`.

### Python (`lumoauth`)

```python
import os
import threading
import time

from lumoauth import LumoAuth

ORG_ID = "acme-corp"
SERVER_ID = "mcp_0123456789abcdef01234567"


class ServerToken:
    """The MCP server's own client-credentials token, cached until shortly before it expires."""

    def __init__(self) -> None:
        self._client = LumoAuth(org_id=ORG_ID)
        self._lock = threading.Lock()
        self._token = ""
        self._expires_at = 0.0

    def __call__(self) -> str:
        with self._lock:
            if self._token and time.monotonic() < self._expires_at:
                return self._token
            response = self._client.auth.client_credentials(
                os.environ["LUMOAUTH_MCP_CLIENT_ID"],
                os.environ["LUMOAUTH_MCP_CLIENT_SECRET"],
                scopes=["mcp:authorize"],
            )
            self._token = response["access_token"]
            self._expires_at = time.monotonic() + max(0, int(response.get("expires_in", 300)) - 60)
            return self._token


lumo = LumoAuth(org_id=ORG_ID, token_provider=ServerToken())


def may_run(sub: str, is_agent: bool, tool: str) -> bool:
    """`sub` and `is_agent` come from the caller's verified MCP token."""
    decision = lumo.mcp.authorize_tool(SERVER_ID, "agent" if is_agent else "user", sub, tool)
    return decision.allowed
```

`authorize_tool(server_id, subject_type, subject_id, tool, *, traceparent=None)` returns `McpToolDecision` (`allowed`, `subject_type`, `subject_id`, `resource_type`, `resource_id`). In a FastMCP server, use `auth.tool_policy()` instead of this code.

### Go (`github.com/lumoauth/lumo-auth-go`)

```go
// Imports: "errors", "log", "os", lumoauth "github.com/lumoauth/lumo-auth-go".
// Once at start-up:
mcpAuth, err := lumoauth.NewAgent(lumoauth.AgentConfig{
    OrgID:        "acme-corp",
    ClientID:     os.Getenv("LUMOAUTH_MCP_CLIENT_ID"),
    ClientSecret: os.Getenv("LUMOAUTH_MCP_CLIENT_SECRET"),
    Scopes:       []string{"mcp:authorize"},
})
if err != nil {
    log.Fatal(err)
}

// claims holds the caller's verified MCP token.
subjectType := "user"
if claims.IsAgent {
    subjectType = "agent"
}
decision, err := mcpAuth.Mcp.AuthorizeTool(ctx, lumoauth.McpToolAuthorizeParams{
    ServerID:    "mcp_0123456789abcdef01234567",
    SubjectType: subjectType,
    SubjectID:   claims.Subject,
    Tool:        "refund",
})
if err != nil {
    return err
}
if !decision.Allowed {
    return errors.New("tool not allowed")
}
```

### PHP (`lumoauth/lumoauth`)

```php
use LumoAuth\LumoAuth;

$base = new LumoAuth(orgId: 'acme-corp');
$own = $base->auth->clientCredentials(getenv('LUMOAUTH_MCP_CLIENT_ID'), getenv('LUMOAUTH_MCP_CLIENT_SECRET'), ['mcp:authorize']);
$lumo = new LumoAuth(orgId: 'acme-corp', tokenProvider: fn () => $own['access_token']);

// $claims holds the caller's verified MCP token.
$isAgent = str_starts_with($claims['sub'], 'agent_');
$decision = $lumo->mcp->authorizeTool(
    serverId: 'mcp_0123456789abcdef01234567',
    subjectType: $isAgent ? 'agent' : 'user',
    subjectId: $claims['sub'],
    tool: 'refund',
);
if (!$decision->allowed) {
    // Refuse the tool call.
}
```

Get a new token before `$own` expires (`$own['expires_in']` seconds).

### C# (`LumoAuth`)

```csharp
using LumoAuth;
using LumoAuth.Models;

using var mcpServer = new LumoAgent(new LumoAgentOptions
{
    OrgId = "acme-corp",
    ClientId = Environment.GetEnvironmentVariable("LUMOAUTH_MCP_CLIENT_ID"),
    ClientSecret = Environment.GetEnvironmentVariable("LUMOAUTH_MCP_CLIENT_SECRET"),
    Scopes = ["mcp:authorize"],
});

// "sub" is the subject of the caller's verified MCP token.
string subjectType = sub.StartsWith("agent_", StringComparison.Ordinal) ? McpSubjectType.Agent : McpSubjectType.User;
McpToolDecision decision = await mcpServer.Mcp.AuthorizeToolAsync(
    "mcp_0123456789abcdef01234567", subjectType, sub, "refund");
if (!decision.Allowed)
{
    // Refuse the tool call.
}
```

### Java (`lumo-auth-java`)

```java
import io.lumoauth.LumoAuth;
import io.lumoauth.model.McpToolDecision;
import io.lumoauth.model.TokenResponse;

// Once at start-up: the MCP server's own token.
LumoAuth tokens = LumoAuth.builder().orgId("acme-corp").withoutCredential().build();
TokenResponse own = tokens.auth().clientCredentials(
    System.getenv("LUMOAUTH_MCP_CLIENT_ID"), System.getenv("LUMOAUTH_MCP_CLIENT_SECRET"), "mcp:authorize");
LumoAuth lumo = LumoAuth.builder().orgId("acme-corp").accessToken(own.accessToken()).build();

// For each tool call: `sub` is the subject of the caller's verified MCP token.
String subjectType = sub.startsWith("agent_") ? "agent" : "user";
McpToolDecision decision = lumo.mcp().authorizeTool("mcp_0123456789abcdef01234567", subjectType, sub, "refund");
if (!decision.allowed()) {
    // Refuse the tool call.
}
```

Get a new token before it expires, or build the client with `tokenProvider(...)`.

## Test a grant from the terminal

`lumo mcp check-tool` makes the same two calls as the MCP server. It needs no admin credential, only the server's own client.

```bash
export LUMO_MCP_CLIENT_SECRET="$LUMOAUTH_MCP_CLIENT_SECRET"
lumo mcp check-tool mcp_0123456789abcdef01234567 refund \
  --subject agent:agt_0123456789abcdef \
  --client-id "$LUMOAUTH_MCP_CLIENT_ID"
```

- `--subject` is `agent:<agent id>` or `user:<user id>`. Required.
- `--client-id` is the server's own client. Required.
- `--client-secret` passes the secret on the command line; prefer the `LUMO_MCP_CLIENT_SECRET` variable.
- The command exits with status 0 when the call is allowed and 1 when it is denied. `-o json` prints the decision.
- The organization comes from `--org`, `LUMO_ORG` or the active profile, and the host from `--base-url` or `LUMO_BASE_URL`.

## The agent's own check is a different call

An agent can ask about itself before it calls a tool, with its own credential: `agents.authorizeMcpTool(serverId, tool)` (`POST /orgs/{orgId}/api/v1/agents/me/mcp/authorize`). That call is for the agent. An MCP server must not use it, because it would have to forward the agent's token. `lumoauth-mcp-client` covers it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The list of tools is empty, every call is refused | No grant exists, or the plan does not include relationship grants | Add an `invoke` relationship; check the plan |
| `401` from the authorize endpoint | The caller's token was sent, or the server's token was requested with `resource` | Send the server's own client-credentials token, requested without `resource` |
| `403 insufficient_scope` | The application does not allow `mcp:authorize` | Add the scope on the application's **Configuration** tab |
| `403 forbidden` | The application is not selected under **Per-tool authorization** | Edit the MCP server and select it |
| `LumoAuth refused the MCP server's client credentials` at run time | Wrong client id or secret | Copy them again; rotate the secret if it is lost |
| A new grant has no effect for half a minute | The decision cache (30 seconds by default) | Wait, or lower `cache_ttl` / `toolDecisionTtl` |
| The SDK raises a validation error before any request | The Resource URI was passed as the server id, or the tool name contains `/`, `:`, `#` or `*` | Pass the `mcp_…` id; rename the tool |
