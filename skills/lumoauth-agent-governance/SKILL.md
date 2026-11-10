---
name: lumoauth-agent-governance
description: >-
  Operates LumoAuth AI agents safely after they are registered. Covers the agent inventory with
  risk level and security posture, conditional access rules for agents (recent attestation,
  maximum risk, allowed IP ranges, dormancy), the kill switch (suspend, deactivate, revoke or
  delete an agent and what that revokes) in the portal, the Admin API and the lumo agents
  commands, dormant agent deactivation, token and API key lifetimes, shared signals (OpenID SSF,
  CAEP and RISC streams and receivers, the CAEP dashboard), trace correlation with the W3C
  traceparent header (Langfuse, LangSmith, Arize, OTLP) and per-agent keys at AI gateways
  (LiteLLM, Portkey, Kong, Cloudflare). Use when the user asks to disable, suspend, stop or kill
  an agent, revoke agent tokens, review risky or unused agents, restrict where agents sign in
  from, send session-revoked events to other systems, receive signals from Okta or Entra, link
  agent traces to audit logs, or control agent spend at an LLM gateway.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth agent governance

Keep a fleet of AI agents under control: see which agents exist and which need attention, restrict when an agent's identity is accepted, stop an agent at once, pass that decision to other systems, and connect agent traces and model spend to the agent's identity.

## When to use

- "Which agents do we have, and which are risky or unused?"
- "Disable this agent now and revoke its tokens."
- "Agents may sign in only from our network, and only when they attested recently."
- "Tell our API or gateway when an agent is revoked." / "Suspend the agent when Okta or Entra says the owner's session is revoked."
- "Link the LangSmith or Langfuse trace to the LumoAuth audit log."
- "Give each agent its own key at LiteLLM, Portkey, Kong or Cloudflare AI Gateway."

Use another skill when:

- The agent must be registered, or its credential, capabilities or budget changed: `lumoauth-agent-identity`.
- A person must approve an agent's action: `lumoauth-agent-approvals`.
- You query or export audit logs or connect a SIEM: `lumoauth-audit-compliance`. For webhook endpoints: `lumoauth-webhooks`.
- You manage other resources with the CLI: `lumoauth-cli`. For Admin API authentication and pagination: `lumoauth-admin-api`.

## Before you start

| Need | Where it comes from |
|---|---|
| Base URL and organization slug | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev`; the slug in the portal URL, for example `acme-corp` |
| Portal permissions | `agents.view` to see agents and rules; `agents.edit` to change agents and access rules; `agents.delete` to delete; `settings.manage` for security signals and organization settings |
| Admin API credential | An organization API key (`lmk_...`) with the scopes `admin:agents:read` and `admin:agents:write`, or an admin access token. Keep it in an environment variable |
| CLI | `lumo login`, or `LUMO_API_KEY`, `LUMO_ORG` and `LUMO_BASE_URL` in the environment |
| Agent ID | The public id `agt_...` from the agent list |

Ask the user for a value that you cannot find. Every command in this skill that changes or deletes something must be shown to the user before it runs. Suspending the wrong agent stops a production workload; revoking is permanent.

Availability of the risk level, conditional access, shared signals, the Agent activity dashboard, trace integrations and AI gateways depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Steps

### 1. Take inventory

Portal: **AI Agents → Agents** (`/orgs/{orgId}/portal/agents`). Each row shows the identity type, capabilities, budget, status, security posture and risk level. The **Needs attention** filter lists agents with an open posture finding. Click a name for the agent page with its posture checklist, credentials, access, AI gateway keys and activity.

CLI (read-only):

```bash
lumo agents list --output json
lumo agents list --search billing
lumo agents get agt_3f9a51c07be24d18 --output json
```

Admin API, with filters:

```bash
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/agents?status=active&sortBy=lastUsedAt&sortDir=ASC" \
  -H "X-API-Key: $LUMOAUTH_API_KEY"
```

`status` is `active`, `inactive`, `suspended` or `revoked`. `identityType` filters by credential type. `sortBy` accepts `name`, `createdAt`, `status` and `lastUsedAt`. Each agent carries `agentId`, `status`, `identityType`, `lastUsedAt` and `riskLevel` (`low`, `medium` or `high`).

What to look for, and where to fix it: read `references/conditional-access-and-risk.md`.

### 2. Stop an agent (kill switch)

Moving an agent out of `active` is the kill switch. In the same step LumoAuth revokes what the agent holds: its AAuth tokens, pending and approved JIT requests, issued JIT tokens and tasks, its OAuth access and refresh tokens, its live agent access tokens (by token id), its token vault grants, and its keys at connected AI gateways. It also sends a CAEP `session-revoked` event on every configured stream.

Choose the action with the user:

| Goal | Status after | Reversible | Portal | CLI or Admin API |
|---|---|---|---|---|
| Pause while you investigate | `suspended` | yes | no portal action | `lumo api POST /agents/{agentId}/disable` |
| Take out of service | `inactive` | yes | no portal action (the dormancy job also sets it) | `lumo agents disable {agentId}` |
| Retire for good | `revoked` | **no** | row menu **⋯ → Revoke** | `lumo api PATCH /agents/{agentId} --data '{"status":"revoked"}'` |
| Remove the record | deleted | no | row menu **⋯ → Delete** | `lumo agents delete {agentId}` |
| Bring back | `active` | | row menu **⋯ → Reactivate** | `lumo agents enable {agentId}` |

Example, shown to the user before it runs:

```bash
# Suspend now. Tokens, JIT approvals and gateway keys of the agent are revoked.
lumo api POST /agents/agt_3f9a51c07be24d18/disable

# Confirm
lumo agents get agt_3f9a51c07be24d18 --output json
```

The same call with curl:

```bash
curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/agents/agt_3f9a51c07be24d18/disable \
  -H "X-API-Key: $LUMOAUTH_API_KEY"
```

Facts that change what you tell the user:

- Reactivation restores nothing. Tokens, grants and approvals that the suspension revoked stay revoked; the agent must obtain new ones.
- `revoked` is final. A revoked agent cannot be reactivated; register a new one.
- From the moment of the status change, LumoAuth's own API refuses the agent's keys and tokens, and token introspection answers `active: false`.
- An API that verifies agent JWTs offline with the JWKS keeps accepting a token until its `exp`. For such APIs: keep token lifetimes short, introspect tokens for work that matters, or subscribe to the CAEP event (step 5).
- When only a credential leaked and the agent itself is fine, rotate the credential instead: `lumo agents rotate-credentials {agentId}`. The old credential stops working at once and the new one is printed once.
- Removing a capability from an agent also revokes its live tokens. Adding a capability revokes nothing.

Statuses, the full list of what is revoked, deletion, dormancy and the audit events: read `references/kill-switch-and-lifecycle.md`.

### 3. Restrict when an agent's identity is accepted

Access rules (conditional access for agents) are created in the portal: **AI Agents → Agent rules → Access rules** (`/orgs/{orgId}/portal/agents/policies`).

1. Click **Create rule**. Enter a **Rule name**.
2. Under **Applies to**, choose *All agents* or *Selected agents only*.
3. Fill in at least one condition: *Must have attested within (hours)*, *Must have been used in the last (days)*, *Risk level must be at most*, *Must connect from these IP ranges* (one CIDR or IP on each line).
4. Read **Preview impact**. It names the active agents that the rule would deny today, and why.
5. Click **Create rule**. The rule applies to the next agent authentication.

With no rule, nothing changes. With rules, the first failing condition of any enabled rule that applies denies the agent with `403` and a `reason`. Start with *Selected agents only* and one test agent, read the preview, then widen the scope. Conditions, deny reasons and recovery: `references/conditional-access-and-risk.md`.

### 4. Keep agent tokens and keys short-lived

- Agent access tokens from the token endpoint last about one hour; tokens from workload attestation are shorter. JIT tokens last 60 to 900 seconds.
- A token that an admin mints for an agent takes a lifetime and can be narrowed:

  ```bash
  lumo agents token agt_3f9a51c07be24d18 --ttl 600 --scopes invoices.read
  lumo agents token agt_3f9a51c07be24d18 --ttl 7200 --resource https://mcp.example.com/mcp
  ```

  `--ttl` is in seconds: default 3600, minimum 60, 86400 at most. A lifetime above 3600 is accepted only together with `--resource`, which binds the token to one registered MCP server; LumoAuth's own API then refuses that token. The response includes the token's `jti`, which is written to the audit log.
- Give API keys an expiry. On `lumo agents create`, `update` and `rotate-credentials`: `--key-expires-in-days <1-3650>`, `--key-expires-at <date>` or `--key-never-expires`. A new API key agent without a choice gets an expiry by default. Do not use `--key-never-expires` unless the user asks for it.
- Bind tokens to a key with DPoP where the API supports it (see `lumoauth-oauth-advanced`). Without a DPoP proof an agent token is a bearer token.

Show the user a `token`, `rotate-credentials` or `update` command before running it. Treat the printed token or key as a secret: do not paste it into chat logs, tickets or code.

### 5. Pass security decisions to and from other systems

LumoAuth sends signed security event tokens (OpenID Shared Signals Framework, CAEP events) to receivers that you configure, and it can act on events from other transmitters such as Okta, Microsoft Entra and Google.

- Outbound: **AI Agents → Agent activity → Security signals → Streams (outbound) → Create stream**. Enter the receiver's public HTTPS endpoint, an audience and a bearer token, tick the events, then click **Send verification**.
- Inbound: the **Receivers (inbound)** tab → **Add receiver**, pick the transmitter preset, and copy the push URL and the bearer (shown once) into the other system.

Stream API, event catalog, a receiver that verifies events, inbound actions and the Agent activity dashboard: read `references/shared-signals.md`.

### 6. Correlate agent traces with audit logs

Send the W3C `traceparent` header on the agent's calls to LumoAuth. LumoAuth stores the trace id on every audit record of that request. It does not emit spans; this is correlation only.

Python (the `lumoauth` package uses `requests`, so instrumenting `requests` adds the header to every SDK call inside an active span):

```python
from opentelemetry.instrumentation.requests import RequestsInstrumentor

RequestsInstrumentor().instrument()  # pip install opentelemetry-instrumentation-requests
```

TypeScript (`LumoAgent` accepts a custom `fetch`):

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

const agent = new LumoAgent({ fetch: tracedFetch });
```

Then connect the tracing backend so the audit log shows an **Open trace** link. Backends, link setup and AI gateways: read `references/tracing-and-gateways.md`.

## Verify

1. After a suspension, the agent's next token request fails, and a call to LumoAuth with a token that was issued before fails too. `lumo agents get {agentId} --output json` shows the new status.
2. The audit log has `agent.credentials_revoked` with counts for each category of revoked credential. A change through the Admin API or the CLI also writes `agent.updated` with the old and new status:

   ```bash
   lumo logs list --action agent.credentials_revoked --limit 5 --output json
   ```

3. After creating an access rule, an agent that breaks it gets `403` with `"error": "access_policy_denied"` and a `reason`, and the audit log has `agent.access_policy_denied`.
4. After creating a stream, **Send verification** delivers a verification event to the receiver, and the audit log has `ssf.set_delivered`.
5. After sending `traceparent`, the audit record of that call carries `trace_id`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| A suspended agent's token still works at one API | That API verifies JWTs offline and does not check with LumoAuth | Shorten token lifetimes, introspect, or act on the CAEP `session-revoked` event |
| "is revoked and cannot be reactivated" | `revoked` is final | Register a new agent. Use `suspended` or `inactive` for a pause |
| The agent works again but its integrations fail after **Reactivate** | Reactivation does not restore tokens, vault grants, approvals or gateway keys | Let the agent obtain new tokens; reconnect vault connections |
| All agents fail with `access_policy_denied` after a new rule | The rule applies to all agents and one condition fails for them | Read `reason`; **Disable** the rule from its actions menu; narrow it |
| `policy_evaluation_error` | A rule exists but could not be evaluated. Evaluation fails closed | Fix or disable the rule |
| `lumo agents disable` was expected to suspend | `disable` sets `inactive`; the suspend action is `POST /agents/{agentId}/disable` on the Admin API | Both stop the agent and revoke its tokens. Use the API call when the status must read `suspended` |
| `lumo agents token --ttl 86400` is refused with 400 | Above 3600 seconds needs `--resource` | Bind the token to an MCP server or shorten it |
| An agent was deactivated without anyone acting | The dormancy job moved an unused agent to `inactive` | **Reactivate** it if it is still needed, or revoke it |
| No **Create stream** button | The user holds `agents.view` but not `settings.manage` | Grant the permission through a role |
| No trace id on audit records | The header was not sent, was malformed, or the call went to a path that does not read it | Send a valid `traceparent` on agent, JIT, MCP, AAuth or authz calls |

## Related skills

- `lumoauth-agent-identity`: registration, credentials, capabilities, budgets.
- `lumoauth-agent-approvals`: reviewers, auto-approve rules and the approvals inbox.
- `lumoauth-audit-compliance`: audit log queries, SIEM and log export of agent events.
- `lumoauth-webhooks`: `agent.created`, `agent.updated`, `agent.revoked` and JIT events as webhooks.
- `lumoauth-api-protection`: token validation and introspection at your API.
- `lumoauth-cli` and `lumoauth-admin-api`: the tools used in this skill.

## References

- [Kill switch and lifecycle](references/kill-switch-and-lifecycle.md): open it before stopping, deleting or reactivating an agent, and for dormancy.
- [Conditional access and risk](references/conditional-access-and-risk.md): open it to read the risk level and posture checklist or to write and debug access rules.
- [Shared signals](references/shared-signals.md): open it to send CAEP events to a receiver, to receive events from another identity system, or to read the Agent activity dashboard.
- [Tracing and AI gateways](references/tracing-and-gateways.md): open it to connect Langfuse, LangSmith, Arize or OTLP, or to give agents their own keys at an LLM gateway.
- https://docs.lumoauth.dev/agents/governance
- https://docs.lumoauth.dev/agents/shared-signals
- https://docs.lumoauth.dev/agents/tracing
- https://docs.lumoauth.dev/agents/ai-gateways
- https://docs.lumoauth.dev/user-guide/ai-agents/overview
- https://docs.lumoauth.dev/user-guide/ai-agents/caep
