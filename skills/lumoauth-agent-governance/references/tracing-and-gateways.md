# Trace correlation and AI gateways

Open this file to join agent framework traces with LumoAuth audit records, or to give each agent its own key at an LLM gateway.

Both features are configured on one portal page: **Settings → Integrations → Agent ecosystem**, `/orgs/{orgId}/portal/integrations/agent-ecosystem`.

## Trace correlation

Agent frameworks record traces of runs, tool calls and model calls. LumoAuth records audit events. A shared trace id joins the two.

LumoAuth reads the W3C Trace Context header `traceparent` on agent-facing API calls, stores the trace id on every audit record that is written during that request, and can turn it into an **Open trace** link to your tracing backend.

LumoAuth does not emit spans and does not run OpenTelemetry instrumentation. This is correlation only: the trace lives in your backend, and the audit record points at it.

### The header

```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
             version  trace id (32 hex, kept)      parent span id   flags
```

Only the trace id is kept. It must be 32 lower-case hex characters and not all zeroes. A malformed header is ignored; the request itself is not affected.

The header is read on these paths:

| Path prefix | Calls |
|---|---|
| `/orgs/{orgId}/api/v1/agents/...` | Ask API, agent self-inspection, attestation, push approval |
| `/orgs/{orgId}/api/v1/jit/...` | JIT tasks, requests and decisions |
| `/orgs/{orgId}/api/v1/mcp/...` | MCP authorization |
| `/orgs/{orgId}/api/v1/aauth/...` | AAuth agent authentication and token exchange |
| `/api/v1/authz/...` | Authorization checks |

### Sending it

When the agent process already uses OpenTelemetry, instrument its HTTP client. The instrumentation adds `traceparent` to every outgoing call that happens inside an active span.

Python, for the `lumoauth` package (it uses `requests`):

```bash
pip install opentelemetry-instrumentation-requests
```

```python
from opentelemetry.instrumentation.requests import RequestsInstrumentor

RequestsInstrumentor().instrument()
```

Python, by hand for a raw HTTP call:

```python
import os

import requests
from opentelemetry import trace

BASE = os.environ["LUMOAUTH_URL"]
ORG = os.environ["LUMOAUTH_ORG_ID"]


def ask(agent_token: str, action: str) -> dict:
    span = trace.get_current_span().get_span_context()
    response = requests.post(
        f"{BASE}/orgs/{ORG}/api/v1/agents/ask",
        json={"action": action},
        headers={
            "traceparent": f"00-{span.trace_id:032x}-{span.span_id:016x}-01",
            "Authorization": f"Bearer {agent_token}",
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()
```

TypeScript, for `LumoAgent` from `@lumoauth/agent` (it accepts a custom `fetch`):

```ts
import { trace } from '@opentelemetry/api';
import { LumoAgent } from '@lumoauth/agent';

const tracedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  const span = trace.getActiveSpan()?.spanContext();
  if (span) {
    headers.set('traceparent', `00-${span.traceId}-${span.spanId}-01`);
  }
  return fetch(input, { ...init, headers });
};

export const agent = new LumoAgent({ fetch: tracedFetch });
```

Create one span for each agent run or tool call, so the audit records of one run share one trace id.

### Where the trace id appears

| Surface | What is shown |
|---|---|
| **Security → Audit logs** | A trace column. **Open trace** when a backend is connected, otherwise the first characters of the id |
| Audit log detail and export | The field `trace_id` |
| **AI Agents → Agents →** the agent **→ Activity** | **Open trace** next to each event that has one |
| SIEM and log export | `trace_id` is part of the exported record (see `lumoauth-audit-compliance`) |

An audit record of a request without `traceparent` has no trace id.

### Connect a tracing backend

On the Agent ecosystem page, under **Trace correlation**, pick a backend, fill in the form and click **Add connection**. Then press **Test connection** to see a sample link built from the configuration.

| Backend | You enter |
|---|---|
| Langfuse | Project id, base URL |
| LangSmith | Organization id, project id, base URL |
| Arize | Organization, space or project, base URL |
| OpenTelemetry (OTLP) | Collector URL. For information only: a collector has no page to link to |

The first enabled backend is used for links, so connect the one that the team opens. The links need no credentials. A base URL that is not `https://` falls back to the vendor's cloud URL.

Choose OpenTelemetry (OTLP) when the team runs its own collector. Trace ids are still stored on audit records, which is what a join in your own tooling needs.

Audit events for the configuration: `agent_ecosystem.trace.created`, `.updated`, `.deleted`, `.enabled`, `.disabled` and `.tested`.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No trace id on audit records | The call ran outside a span, or the header was malformed | Start a span around the run; check the header format |
| A trace id is shown but no **Open trace** link | No tracing backend is connected or enabled | Add a connection |
| The link opens the wrong project | The project or organization id in the connection is wrong | Edit the connection and press **Test connection** |
| Token requests have no trace id | The header is read on the agent, JIT, MCP, AAuth and authz paths only | Correlate token requests by time and agent id |

## AI gateways

Teams route model calls through an AI gateway (an LLM proxy) to manage spend, model access and prompt logging in one place. A shared gateway key in many agent deployments cannot be attributed to one agent and cannot be revoked for one agent.

LumoAuth connects to the gateway and gives every agent its own key there. The key is created when the agent is registered and revoked when the agent's kill switch runs (suspend, deactivate, revoke or delete).

| Gateway | What LumoAuth creates for an agent |
|---|---|
| LiteLLM | A virtual key with the agent id in its metadata, an optional team and a budget |
| Portkey | A workspace service API key, with optional usage limits and a default config |
| Kong AI Gateway (Konnect) | A consumer whose `custom_id` is the agent id, with a key credential |
| Cloudflare AI Gateway | An account API token that is limited to running the AI gateway |

### Connect a gateway

Show the user what you are about to configure; the form stores an admin credential of their gateway.

1. On the Agent ecosystem page, open the **AI gateways** section.
2. Pick the gateway under **Connect a provider** and fill in its fields.
3. Leave **Enable this connection** on and click **Add connection**.
4. Press **Test connection** on the saved connection. An error from the gateway is shown as returned and stored as the connection's last error.

| Gateway | Configuration | Secret |
|---|---|---|
| LiteLLM | Proxy base URL, team id, default maximum budget (USD), budget duration | Master key |
| Portkey | Workspace id, default config id, API base URL, default monthly budget | Admin API key |
| Kong | Konnect control plane id, Konnect API base | Konnect access token |
| Cloudflare | Account id, gateway id, permission group id for running the AI gateway | An API token that can create tokens |

Secrets are stored encrypted and never shown again. Leave a secret field blank when you edit a connection to keep the stored value. The gateway must be reachable at a public HTTPS address.

Several gateways can be connected, also two of the same kind. Every enabled gateway gets a key for every new agent.

### Budgets

The agent's cost limit is copied to its key when the key is created, so the gateway stops model calls when the limit is spent. A monthly cost limit of the agent takes precedence. Without a limit on the agent, the default budget of the gateway connection applies. Without either, the key has no limit: set a default budget on the connection unless the user wants unlimited keys.

The gateway's spend does not reach LumoAuth by itself. To count it against the agent's budget in LumoAuth, report usage (see budgets in `lumoauth-agent-identity`).

### Lifecycle

- Keys are created in the background after the agent is created. An agent that already has an active key at a gateway is skipped, so a retry creates no duplicate.
- The kill switch revokes the key at the gateway in the background. Deleting an agent revokes its keys before the delete returns.
- A gateway outage never blocks agent creation or the kill switch. A failure is recorded on the key and as the connection's last error, and audited as `ai_gateway.key_provision_failed` or `ai_gateway.key_revoke_failed`.
- When the gateway could not be reached at revoke time, the key keeps a visible error state and the revocation is retried. Check the key list after an incident and confirm at the gateway that the key is gone.
- The keys of one agent are listed in the **AI gateway keys** section of the agent's page: gateway, key handle, status, and the times of creation and revocation. Secrets are never displayed.

Audit events: `ai_gateway.key_provisioned`, `ai_gateway.key_revoked`, `ai_gateway.key_provision_failed`, `ai_gateway.key_revoke_failed`, and `agent_ecosystem.gateway.created`, `.updated`, `.deleted`, `.enabled`, `.disabled`, `.tested` for the connection.

### Verifying the agent's LumoAuth token at the gateway

The gateway key answers "which agent is this?" for the gateway's own accounting. A gateway can also verify the agent's LumoAuth access token against the organization's JWKS:

```
https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/jwks.json
```

Each gateway's page in the portal shows a configuration snippet for this:

| Gateway | Approach |
|---|---|
| LiteLLM | JWT authentication of the proxy, with the public key URL set to the JWKS |
| Kong | The OpenID Connect plugin with consumers matched by `custom_id`, which is the consumer that LumoAuth created; or the JWT plugin with the organization's key |
| Cloudflare | A Worker in front of the gateway that verifies the token against the JWKS before it adds the gateway's authorization header |
| Portkey | Verify at your edge before Portkey; Portkey itself authenticates with the provisioned key |

Copy the snippet from the portal page instead of writing gateway configuration from memory. A gateway that verifies tokens offline accepts a token until it expires, also after the agent was suspended; the revoked gateway key is what stops the agent's model calls at once.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A new agent has no key at the gateway | Creation runs in the background, or it failed | Look for `ai_gateway.key_provision_failed` and the connection's last error |
| **Test connection** fails | Wrong base URL or admin credential, or the gateway is not reachable from the internet over HTTPS | Correct the fields; the error text is the gateway's own |
| A suspended agent can still call models | The gateway could not be reached when the key was revoked, or the agent uses another key | Check the key's status on the agent page, revoke it at the gateway, and remove shared keys from the deployment |
| The gateway does not enforce the agent's budget | The agent had no cost limit when the key was created and the connection has no default | Set a default budget on the connection |
