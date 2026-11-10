---
name: lumoauth-agent-identity
description: >-
  Gives an AI agent its own LumoAuth identity. Covers registering the agent (portal, Admin API,
  `lumo agents create`), choosing its credential (client secret, API key `agk_`, private key JWT
  `private_key_jwt`, workload identity federation from GitHub Actions, Kubernetes, AWS EKS, GCP,
  Azure or SPIFFE, the attestation endpoint), getting an agent access token with the client
  credentials grant, capabilities and capability checks, budgets and usage reports, the Ask API
  preflight check ("may I do X") and agent self-inspection (`/agents/me`). Shows the SDK agent
  classes: `LumoAgent` from `@lumoauth/agent`, `LumoAuthAgent` from the Python `lumoauth` package,
  Go `Agent`, .NET `LumoAgent`, Java `LumoAgent` and the PHP `agents` namespace. Use when the user
  wants to register an AI agent, authenticate an agent as itself, replace a shared API key with an
  agent identity, set `AGENT_CLIENT_ID` / `AGENT_CLIENT_SECRET`, limit what an agent may do, or
  check a permission before a tool call.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth agent identity

Register an AI agent in a LumoAuth organization, give it a credential, get an access token for it,
and check what it may do before each tool call. The agent is a principal of its own: it has an ID
(`agt_…`), a capability list, an optional budget and a status that an admin can switch off.

## When to use

- The user wants an agent, a worker or a pipeline to authenticate as itself, not as a user and not
  with a shared key.
- The user wants to check "may this agent do X" before a tool runs (the Ask API).
- The user wants to cap an agent's calls, model tokens or cost.

Do not use this skill for:

- An agent that acts for a signed-in user: use `lumoauth-agent-delegation`.
- A human who must approve an action: use `lumoauth-agent-approvals`.
- Requests that the agent signs with its own key (AAuth): use `lumoauth-aauth`.
- LangChain, CrewAI, OpenAI Agents SDK and other framework wiring: use `lumoauth-agent-frameworks`.
- Tokens for an MCP server: use `lumoauth-mcp-client`. Protecting an MCP server: `lumoauth-mcp-server`.
- Risk, conditional access and the kill switch: use `lumoauth-agent-governance`.
- A plain service with no agent features: use `lumoauth-api-protection` (machine-to-machine).

## Before you start

Collect these values. Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL `/orgs/{orgId}/portal/...`, for example `acme-corp` |
| Agent ID (`agt_…`) | Returned when the agent is registered |
| Agent credential | Shown once at registration: a client secret or an `agk_` API key. Other types have no secret |

The SDK agent classes read these environment variables:

| Variable | Meaning | Read by |
|---|---|---|
| `LUMOAUTH_URL` | Base URL. Default `https://app.lumoauth.dev` | JS, Python, Go, .NET, Java, PHP |
| `LUMOAUTH_ORG_ID` | Organization slug | JS, Python, Go, .NET, Java, PHP |
| `AGENT_CLIENT_ID` | The agent ID (`agt_…`) | JS, Python, Go, .NET, Java |
| `AGENT_CLIENT_SECRET` | The agent's client secret | JS, Python, Go, .NET, Java |
| `AGENT_PRIVATE_KEY`, `AGENT_KEY_ID` | PEM private key and `kid` of a private key JWT agent | JS, Python, Go |

An agent credential is a secret. Keep it on the server, in a secrets manager or an environment
variable. Never put it in browser code, mobile code, a prompt, a log line or a repository.

Requirements from the package manifests: Node.js 18+ for `@lumoauth/agent`, Python 3.9+ for
`lumoauth`.

## Steps

### 1. Choose the credential type

The identity type is fixed after registration. To change it, register a new agent.

| Agent runs on | Identity type | Secret stored by the agent | Read |
|---|---|---|---|
| GitHub Actions, GitLab CI, Kubernetes, AWS EKS (IRSA), GCP, Azure, SPIFFE, another OIDC issuer | `workload` | None | [references/workload-federation.md](references/workload-federation.md), [references/attestation.md](references/attestation.md) |
| A VM, an on-premises host, AWS Lambda or EC2, where the agent can keep a private key | `private_key_jwt` | A private key that never leaves the agent | [references/private-key-jwt.md](references/private-key-jwt.md) |
| Anywhere, and every request must be signed | `aauth` | A private key | `lumoauth-aauth` |
| Anywhere, simplest setup, works with every SDK agent class | `client_secret` | A client secret | This file |
| A script that sends one static key | `api_key` | An `agk_` key | [references/api-key.md](references/api-key.md) |

Prefer `workload`, then `private_key_jwt`, then `client_secret`. Plain EC2, Lambda and ECS have no
OIDC workload token: use `private_key_jwt` there. The rest of this file uses `client_secret`.
Workload identity for some platforms depends on the organization's plan (see
https://docs.lumoauth.dev/pricing-matrix).

### 2. Register the agent

Show the user the command before you run it: it creates an agent in the organization.

With the `lumo` CLI (after `lumo login --org acme-corp`):

```bash
lumo agents create \
  --name "Research assistant" \
  --type client_secret \
  --description "Reads documents and searches the web" \
  --capabilities document.read,tool.search_web
```

`--type` defaults to `api_key`, so always pass it. The response contains `agentId` and, once,
`clientSecret`. Store the secret at once; it cannot be read again. An agent that must act for
users also needs a switch that is set in the portal (see `lumoauth-agent-delegation`).

With the Admin API (an organization API key `lmk_…` with the scope `admin:agents:write`):

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/agents" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Research assistant",
    "identityType": "client_secret",
    "description": "Reads documents and searches the web",
    "capabilities": ["document.read", "tool.search_web"]
  }'
```

The response is `{"data": {"agentId": "agt_…", "clientSecret": "…", …}}`. `identityType` is one of
`workload`, `aauth`, `private_key_jwt`, `client_secret`, `api_key`, `custom`; without it the agent
is an `api_key` agent.

In the portal: **AI Agents → Agents → Register agent** (`/orgs/{orgId}/portal/agents`). Step 1 asks
who the agent is, step 2 how it proves its identity, step 3 what it may do.

Other `lumo agents` commands: `list`, `get <agent-id>`, `update <agent-id>`, `enable`, `disable`,
`delete`, `rotate-credentials <agent-id>`, `token <agent-id>` (an admin-issued test token).

### 3. Give the agent only the capabilities that it needs

Capabilities are the agent's permission list. LumoAuth stores them in one form: lower case, with
`:` and `-` turned into `.`. `Read:Documents` is stored as `read.documents`, and both spellings
match. `document.*` covers every action under `document.`. A bare `*` covers everything; do not
use it. An admin cannot grant a capability that the admin does not hold.

### 4. Set the environment

```bash
export LUMOAUTH_URL="https://app.lumoauth.dev"
export LUMOAUTH_ORG_ID="acme-corp"
export AGENT_CLIENT_ID="agt_..."          # the agentId from step 2
export AGENT_CLIENT_SECRET="..."          # the clientSecret from step 2
```

In production, load these from the platform's secrets manager.

### 5. Authenticate and check before each action (Python)

```bash
pip install lumoauth
```

```python
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET

if not agent.authenticate():
    raise SystemExit("Agent authentication failed. Check the agent ID, the secret and the organization.")


def read_document(doc_id: str) -> dict:
    decision = agent.ask("document.read", {"id": doc_id})
    if not decision["allowed"]:
        raise PermissionError(decision["reason"])
    # The agent may read the document. Call your own API here.
    return {"id": doc_id}


identity = agent.get_identity()            # GET /agents/me
print(identity["identity"]["agent_id"], identity["capabilities"])
print(read_document("doc_99"))
```

`authenticate()` runs the client credentials grant and returns `True` or `False`. The SDK renews
the token before it expires. `ask()` returns `allowed`, `reason`, `decided_by` and `audit_id`;
`is_allowed(action, context)` returns only the boolean. `has_capability("document.read")` checks
the registered capability list locally and applies no policy; prefer `ask()` before real actions.

### 6. Authenticate and check before each action (TypeScript)

```bash
npm install @lumoauth/agent
```

```ts
import { LumoAgent } from '@lumoauth/agent';

// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
const agent = new LumoAgent();

await agent.authenticate(); // throws when the credential is refused

async function readDocument(docId: string): Promise<{ id: string }> {
  const decision = await agent.ask('document.read', { id: docId });
  if (!decision.allowed) {
    throw new Error(decision.reason ?? 'Not allowed');
  }
  // The agent may read the document. Call your own API here.
  return { id: docId };
}

const me = await agent.getCurrentAgent(); // GET /agents/me
console.log(me.identity, me.capabilities);
console.log(await readDocument('doc_99'));
```

Every method fetches and renews the token for you; `authenticate()` at startup only makes a wrong
credential fail early. `agent.isAllowed(action, context)` returns the boolean.
`agent.getAccessToken()` returns the current token for calls to your own API. `@lumoauth/agent`
uses `node:crypto`: run it on a server, never in a browser.

### 7. Report usage when the agent has a budget

A budget limits calls, model tokens and cost per UTC hour, day and month. LumoAuth counts the
calls itself (Ask API calls, token requests, MCP tool checks, just-in-time requests). It does not
see model calls, so token and cost limits count only what the agent reports.

```python
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent()
agent.authenticate()

# After each model call, report what it used.
result = agent.report_usage(tokens=1530, cost_usd=0.0042)
if result["budget"].get("exhausted"):
    raise RuntimeError("The agent's budget is spent. Stop and tell the user.")
```

```ts
import { LumoAgent } from '@lumoauth/agent';

const agent = new LumoAgent();

const { budget } = await agent.reportUsage({ tokens: 1530, costUsd: 0.0042 });
if (budget.exhausted) {
  throw new Error("The agent's budget is spent. Stop and tell the user.");
}
```

When a limit is reached, the next call that counts gets HTTP `429` until the window resets. Set
the limits in step 3 of the portal wizard or with `budgetPolicy` in the Admin API, for example
`{"budgetPolicy": {"max_api_calls_per_hour": 500, "max_tokens_per_day": 100000, "max_cost_per_month_usd": 50}}`.
Budgets depend on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).
Read [references/capabilities-and-budgets.md](references/capabilities-and-budgets.md) for every
budget key, the UserInfo fields and the report rules.

### 8. Without an SDK

The token request is the OAuth 2.0 client credentials grant. `client_id` is the agent ID.

```bash
curl -X POST "$LUMOAUTH_URL/orgs/$LUMOAUTH_ORG_ID/api/v1/oauth/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$AGENT_CLIENT_ID" \
  -d "client_secret=$AGENT_CLIENT_SECRET"
```

```bash
curl -X POST "$LUMOAUTH_URL/orgs/$LUMOAUTH_ORG_ID/api/v1/agents/ask" \
  -H "Authorization: Bearer $AGENT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "document.read", "context": {"id": "doc_99"}}'
```

An optional `scope` on the token request can only narrow the agent's capabilities. The token
expires after at most one hour. `GET …/agents/me` returns the agent, its capabilities and the
token's scope. `GET …/oauth/userinfo` returns `capabilities` and `budget_policy`.

## Verify

1. Run the script. `authenticate()` succeeds, and `/agents/me` returns the right `agent_id` and
   `"status": "active"`.
2. Ask for an action that is in the capability list: `allowed` is `true` and `decided_by` is
   `capability`.
3. Ask for an action that is not in the list: `allowed` is `false`. The denial appears in the
   portal audit log as `agent.capability_check_denied` with the same `audit_id`.
4. Check that the secret is not in the repository: search the working tree for the first
   characters of the secret and for `AGENT_CLIENT_SECRET=`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `invalid_client` (401) on the token request | Wrong secret, wrong organization slug, the agent is not `active`, or `client_id` is not the `agt_…` ID | Check the four values. Rotate the secret with `lumo agents rotate-credentials <agent-id>` if it is lost |
| The agent created by `lumo agents create` has an `apiKey`, no `clientSecret` | `--type` was left out, so the agent is an `api_key` agent | Register a new agent with `--type client_secret`. The type cannot be changed |
| `LumoAuthConfigError`: agent credentials required | `AGENT_CLIENT_ID` or `AGENT_CLIENT_SECRET` is not set in the process | Export them, or pass `client_id` / `client_secret` (Python) or `clientId` / `clientSecret` (JS) |
| "Pass clientSecret or privateKey, not both" | Both a secret and `AGENT_PRIVATE_KEY` reach the constructor | An agent uses one method. Remove one |
| `ask` says `allowed: false` for `read:documents` although the agent has it | The token was requested with a narrower `scope` | Request the token without `scope`, or include the action in it |
| HTTP `429` on `ask` or on the token request | The budget is spent, or a rate limit was hit | Read `budget_policy.exhausted` from UserInfo. Wait for the window or ask an admin to raise the limit |
| Token and cost limits never trigger | The agent does not report usage | Call `report_usage` / `reportUsage` after model calls |
| `403 insufficient_scope` on a usage report | The token was narrowed with `scope` | Report with a token that carries all of the agent's capabilities |
| The agent's old tokens stopped working | A credential was rotated, or the capabilities were reduced | Request a new token. This is the intended behaviour |

Do not log access tokens, secrets or `agk_` keys. Do not treat `ask` as a replacement for checks in
your own API: the API that receives the agent's token must still verify it (see
`lumoauth-api-protection`).

## Related skills

- `lumoauth-agent-delegation`: the agent acts for a user (token exchange, the `act` claim).
- `lumoauth-agent-approvals`: a human approves a risky action first.
- `lumoauth-aauth`: the agent signs every request with its own key.
- `lumoauth-agent-frameworks`: use the agent identity inside LangChain, CrewAI and others.
- `lumoauth-mcp-client`: get a token for one MCP server.
- `lumoauth-agent-governance`: risk, conditional access, the kill switch.
- `lumoauth-authorization`: ABAC and relationship rules that the Ask API also applies to agents.
- `lumoauth-cli`: install and sign in to the `lumo` command.

## References

- [references/private-key-jwt.md](references/private-key-jwt.md): read when the agent keeps a
  private key and must not hold a shared secret.
- [references/workload-federation.md](references/workload-federation.md): read when the agent runs
  on a platform that issues OIDC tokens and should exchange that token at the token endpoint.
- [references/attestation.md](references/attestation.md): read when the workload knows its agent ID
  and should call the attestation endpoint, for example from GitHub Actions.
- [references/api-key.md](references/api-key.md): read when the agent uses an `agk_` API key.
- [references/capabilities-and-budgets.md](references/capabilities-and-budgets.md): read for the
  capability matching rules, every budget key, usage reports and DPoP-bound agent tokens.
- [references/other-languages.md](references/other-languages.md): read for Go, .NET, Java and PHP.
- https://docs.lumoauth.dev/agents/registry
- https://docs.lumoauth.dev/agents/ask-api
- https://docs.lumoauth.dev/agents/private-key-jwt
- https://docs.lumoauth.dev/agents/workload-federation
- https://docs.lumoauth.dev/agents/attestation
- https://docs.lumoauth.dev/agents/fine-grained-authz
- https://docs.lumoauth.dev/quickstarts/ai-agent-security
