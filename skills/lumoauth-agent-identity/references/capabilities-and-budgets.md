# Capabilities, the Ask API, budgets and DPoP-bound agent tokens

## How capabilities are matched

LumoAuth stores each capability in one form and matches every action against that form:

1. Lower-case the name (ASCII letters).
2. Replace `:` and `-` with `.`.
3. Collapse repeated `.` and trim `.` from both ends.

So `Users:Delete` is stored as `users.delete`, and an action spelled `users:delete`,
`Users.Delete` or `users-delete` matches it.

Wildcards: `prefix.*` covers every action under `prefix.` (`document.*` covers `document.read`,
but not `document` itself). A bare `*` covers every action. No other wildcard exists.

The SDKs apply the same rules locally:

| SDK | Local check |
|---|---|
| Python | `agent.has_capability("read:documents")`, the `@require_capability("tool:search_web")` decorator, `capability_covers(capability, action)`, `any_capability_covers(capabilities, action)`, `normalize_capability(name)` from `lumoauth` |
| Go | `agent.HasCapability(ctx, name)`, `agent.RequireCapability(ctx, name)`, `lumoauth.CapabilityCovers(capability, action)`, `lumoauth.AnyCapabilityCovers(capabilities, action)`, `lumoauth.NormalizeCapability(name)` |
| .NET | `agent.HasCapabilityAsync(name)`, `agent.RequireCapabilityAsync(name)` |
| Java | `agent.hasCapability(name)`, `agent.requireCapability(name)` |
| JS | `await agent.capabilities()` returns the stored list. Use `agent.isAllowed(action)` for the check |

A local check reads only the registered capability list. It does not apply the organization's
attribute rules, relationship rules or the token's scope. The Ask API does. Use the local check to
fail fast, and the Ask API before an action that matters.

Python decorator example:

```python
from lumoauth import LumoAuthAgent, require_capability


class ResearchAgent(LumoAuthAgent):
    @require_capability("tool:search_web")
    def search(self, query: str) -> str:
        # Raises PermissionError before this line when the capability is missing.
        return f"results for {query}"


agent = ResearchAgent()
agent.authenticate()
print(agent.search("quarterly results"))
```

## The Ask API

`POST /orgs/{orgId}/api/v1/agents/ask` with the agent's token.

Request: `{"action": "document.read", "context": {"id": "doc_99"}}`. `context` is optional.

Response:

| Field | Meaning |
|---|---|
| `allowed` | `true` when the agent may do the action |
| `reason` | A sentence that explains the answer. It can be shown to the user |
| `decided_by` | `capability` (the capability list decided), `pdp` (an attribute rule or a relationship allowed it) or `deny_override` (a deny rule overrode the capability) |
| `audit_id` | The ID of the decision. A denial is in the audit log as `agent.capability_check_denied` with this ID |
| `action`, `context` | Echo of the request |

Rules:

- When the token was requested with a narrower `scope`, the action must also be inside that scope.
- Each call counts against the agent's budget. A spent budget answers `429 budget_exceeded` (see
  "Budget policy" below).
- Allowed calls are not written to the audit log. Denials are.
- In `context`, the names `ip`, `userAgent`, `requestMethod` and `requestPath` always describe the
  request that LumoAuth received. A value that you send under one of those names is kept under
  `pep`.

Attribute rules (ABAC) and relationship rules (ReBAC) that name agents are set up with
`lumoauth-authorization`, `lumoauth-abac` and `lumoauth-rebac`. Their availability depends on the
organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Self-inspection

`GET /orgs/{orgId}/api/v1/agents/me` returns:

```json
{
  "identity": {
    "id": "agent_agt_91827364a1b2c3d4",
    "type": "agent",
    "agent_id": "agt_91827364a1b2c3d4",
    "status": "active"
  },
  "capabilities": ["document.read", "tool.search_web"],
  "scope": ["document.read"],
  "workspace": { "slug": "acme-corp", "api_base": "/orgs/acme-corp/api/v1/" }
}
```

`capabilities` is the registered list in its stored form. `scope` is the scope of the token that
was presented; it is `null` for an `agk_` key.

`GET /orgs/{orgId}/api/v1/oauth/userinfo` with the agent's token returns `sub` (`agent_` plus the
agent ID), `name`, `agent_id`, `capabilities`, `budget_policy` and `identity_type: "agent"`. An
agent token needs no `openid` scope there.

| SDK | `/agents/me` | UserInfo and budget |
|---|---|---|
| Python | `agent.get_identity()` | `agent.get_agent_info()`, `agent.get_budget_status()`, `agent.is_budget_exhausted()` |
| JS | `agent.getCurrentAgent()` | `agent.budget()` |
| Go | `agent.Identity(ctx, false)` | `agent.Info(ctx, false)`, `agent.Budget(ctx)`, `agent.CheckBudget(ctx)` |
| .NET | `agent.IdentityAsync()` | `agent.InfoAsync()`, `agent.BudgetAsync()`, `agent.CheckBudgetAsync()` |
| Java | `agent.identity()` | `agent.info()`, `agent.budget()`, `agent.checkBudget()` |
| PHP | `$lumo->agents->me()` | `$lumo->agents->info()`, `$lumo->agents->budget()` |

Python, Go, .NET and Java cache the agent info. For a live budget reading call
`agent.get_agent_info()` (Python) or pass `true` as the refresh argument (`Info(ctx, true)`,
`InfoAsync(true)`, `info(true)`) first.

## Budget policy

Set the budget in step 3 of the registration wizard, on the agent's edit page, or with
`budgetPolicy` in the Admin API (`POST` or `PATCH /orgs/{orgId}/api/v1/admin/agents[/{agentId}]`).
Show the user the request before you send it.

```json
{
  "budgetPolicy": {
    "max_api_calls_per_hour": 500,
    "max_tokens_per_day": 100000,
    "max_cost_per_month_usd": 50
  }
}
```

| Key | Limits | Usage comes from |
|---|---|---|
| `max_api_calls_per_hour`, `max_api_calls_per_day` | Calls that count | LumoAuth counts them: Ask API calls, MCP tool checks, token requests (token exchange, attestation, connection tokens and AAuth platform tokens included), just-in-time requests |
| `max_tokens_per_hour`, `max_tokens_per_day` | Model tokens | Usage reports |
| `max_cost_per_day_usd`, `hard_limit` | Cost in USD per day | Usage reports |
| `max_cost_per_month_usd` | Cost in USD per month | Usage reports |
| `max_steps`, `timeout_seconds` | Steps and seconds for one task | Not counted. LumoAuth stores them and returns them in UserInfo; the agent's own code applies them |

Rules for `budgetPolicy` in the Admin API:

- An update replaces the whole policy. Send every limit that the agent keeps. `{}` or `null`
  removes the budget.
- Each value is a number greater than zero: whole numbers for calls, tokens, steps and seconds,
  an amount in USD for cost. Leave a key out for no limit.
- An unknown key gets `400`, and the message lists the keys that exist. Do not invent keys.

A save of the agent's edit page in the portal changes only the limits whose fields were changed.
The page also shows the usage in the current hour, day and month.

When a limit is reached, every call that counts gets the same answer until that window ends:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1050

{"error": "budget_exceeded", "error_description": "Agent budget exceeded"}
```

`Retry-After` is the number of seconds until the spent window ends. It can be hours or days, so do
not sleep on it in a request path: stop the task, or wait in a scheduler. The SDKs raise their rate
limit error for this answer, with the header in its retry-after field.

Windows are UTC hours, days and months. `budget_policy` in UserInfo returns the limits that are
set, the usage (`api_calls_this_hour`, `api_calls_today`, `tokens_used_this_hour`,
`tokens_used_today`, `cost_today_usd`, `cost_this_month_usd`) and `exhausted`. Reading UserInfo
does not count as a call.

Budgets depend on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Usage reports

`POST /orgs/{orgId}/api/v1/agents/me/usage` with the agent's token and
`{"tokens": 1530, "cost_usd": 0.0042}`. Send `tokens`, `cost_usd` or both.

```json
{
  "recorded": { "tokens": 1530, "cost_usd": 0.0042 },
  "budget": { "max_tokens_per_day": 100000, "tokens_used_today": 41530, "exhausted": false }
}
```

| SDK | Call |
|---|---|
| Python | `agent.report_usage(tokens=1530, cost_usd=0.0042)` |
| JS | `agent.reportUsage({ tokens: 1530, costUsd: 0.0042 })` |
| Go | `agent.ReportUsage(ctx, 1530, 0.0042)` |
| .NET | `agent.ReportUsageAsync(1530, 0.0042)` |
| Java | `agent.reportUsage(1530, 0.0042)` |
| PHP | `$lumo->agents->reportUsage(1530, 0.0042)` |

Rules:

- `tokens` is the number of model tokens since the last report, input and output together.
- A report is not a call that counts, and it is accepted when the budget is spent.
- A token that was narrowed with `scope` cannot report (`403 insufficient_scope`). Neither can an
  admin-issued test token from the portal.
- An agent reports its own usage, so a faulty agent could leave usage out. When another component
  handles the model calls (a gateway, an orchestrator), let it report through the Admin API:
  `POST /orgs/{orgId}/api/v1/admin/agents/{agentId}/usage` with an organization API key that has
  the scope `admin:agents:write` and the same body.

## DPoP-bound agent tokens

By default an agent access token is a bearer token: whoever holds it can use it. DPoP binds the
token to a key that the agent holds, so a stolen copy fails. Send a DPoP proof with the token
request and the token comes back with `token_type: "DPoP"`. The JS, Python and Go SDKs sign the
proofs; the .NET, Java and PHP SDKs do not.

```python
# pip install "lumoauth[dpop]"
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent(dpop=True)   # generates a key for this process
agent.authenticate()
print(agent.token_type)            # "DPoP"
```

```ts
import { LumoAgent, DpopProofSigner } from '@lumoauth/agent';

const agent = new LumoAgent({ dpop: DpopProofSigner.generate() });
await agent.authenticate();
console.log(agent.tokenType);      // "DPoP"
```

In Go, pass `DPoP: signer` in `AgentConfig`, with `signer, err := lumoauth.NewDPoPSigner()`.

An admin can make the proof mandatory for one agent: **Only issue DPoP-bound tokens** on the
agent's edit page, or `dpopBoundAccessTokens: true` in the Admin API. A token request without a
proof then fails with `invalid_dpop_proof`. DPoP is the only sender constraint that LumoAuth
offers; there is no certificate-bound token. Availability of DPoP depends on the organization's
plan (see https://docs.lumoauth.dev/pricing-matrix). For the proof format see
`lumoauth-oauth-advanced`.

Docs: https://docs.lumoauth.dev/agents/registry, https://docs.lumoauth.dev/agents/ask-api
