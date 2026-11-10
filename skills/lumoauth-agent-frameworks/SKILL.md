---
name: lumoauth-agent-frameworks
description: >-
  Wires LumoAuth agent identity, authorization checks and human approval into AI agent frameworks:
  LangChain and LangGraph, CrewAI, the OpenAI Agents SDK, Agno, Google ADK (Agent Development Kit)
  and Microsoft Agent Framework (Python and .NET). Gives one shared pattern (the agent signs in as
  itself, each tool runs a preflight check with the Ask API or a capability check, a sensitive tool
  waits for human approval, calls to a protected API or MCP server carry a scoped token) and
  complete code for each framework with the lumoauth Python package (LumoAuthAgent, JITContext,
  approvals, get_mcp_token) and the LumoAuth .NET package. Use when the user asks to secure or
  guard tool calls, add authorization, human-in-the-loop approval, just-in-time permissions or
  an MCP token to a LangGraph, LangChain, CrewAI, OpenAI Agents, Agno, Google ADK or Microsoft
  Agent Framework agent, or wants a starter from create-lumo-agent.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth in agent frameworks

Give a framework agent its own LumoAuth identity and put three gates around its tools: a preflight authorization check, a human approval for sensitive actions, and scoped tokens for the APIs and MCP servers that it calls. The LumoAuth code is the same in every framework. Only the tool decorator and the run loop differ.

There are no LumoAuth adapter packages for these frameworks. The integration is plain SDK calls inside the tool functions.

## When to use

- The user has, or wants, an agent built with LangChain/LangGraph, CrewAI, the OpenAI Agents SDK, Agno, Google ADK or Microsoft Agent Framework, and wants its tool calls authenticated, authorized, approved or audited.
- The user wants a Next.js starter with sign-in and an agent approval demo: see "Starter project" at the end.

Use another skill when:

- The agent is not registered yet or needs another credential type (API key, private key JWT, workload federation): `lumoauth-agent-identity`.
- The task is only about approval mechanics, JIT permissions or agent CIBA, with no framework: `lumoauth-agent-approvals`.
- The agent acts for a signed-in user with token exchange: `lumoauth-agent-delegation`.
- The task is to protect the MCP server itself: `lumoauth-mcp-server`. For MCP client sessions and discovery: `lumoauth-mcp-client`.
- The agent signs requests with its own key (AAuth): `lumoauth-aauth`.

## The pattern

| Step | What happens | LumoAuth call (Python) |
|---|---|---|
| 1. Identity | The process signs in as the registered agent, not as a user and not with a shared service key | `LumoAuthAgent()` then `authenticate()` |
| 2. Preflight | Before a tool does anything, ask whether this agent may do this action | `agent.ask(action, context)` (server decision with policies) or `agent.has_capability(name)` (registered capabilities only) |
| 3. Approval | A sensitive tool waits for a person | `agent.approvals.require(...)` for a yes or no on the approver's phone; `JITContext` for a reviewed, short-lived token |
| 4. Call | The outgoing call carries a token for exactly that target | `agent.get_mcp_credential(url)` for an MCP server; a JIT token for a protected API |

Put the gates in code, inside the tool. Do not rely on the model's instructions to enforce them. Return a short refusal text to the model when a gate fails, so the model can tell the user.

## Before you start

Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| `LUMOAUTH_URL` | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| `LUMOAUTH_ORG_ID` | The organization slug in the portal URL, for example `acme-corp` |
| `AGENT_CLIENT_ID`, `AGENT_CLIENT_SECRET` | Shown once on the **Agent created** page after **AI Agents → Agents → Register agent** with the **Client ID and secret** identity |
| `APPROVER_EMAIL` | The user who approves sensitive actions. The user has enrolled the LumoAuth mobile app |
| Model provider key and model name | The framework's own settings, for example `OPENAI_API_KEY` and `OPENAI_MODEL` |
| MCP server URL | The server's registered Resource URI, for example `https://mcp.example.com/mcp` |

Agent settings to confirm with the user:

- The agent's capabilities cover the actions that the tools check (for example `documents.read`). A capability `tool:search_web` and `tool.search_web` are the same name.
- **May act on behalf of users** is on when the agent uses push approval.
- For reviewed JIT permissions, a user who does not own the agent holds `jit.approve` (see `lumoauth-agent-approvals`).

To register the agent from the command line, show the user the command first:

```bash
lumo agents create --name "Research Analyst" --type client_secret \
  --capabilities documents.read,payments.wire --act-on-behalf
```

The output shows the credential once. `lumoauth-agent-identity` covers the options.

## Steps

### 1. Install

```bash
pip install "lumoauth>=1.4.0"
```

Then install the framework (see the table in step 3). Set the environment:

```bash
export LUMOAUTH_URL=https://app.lumoauth.dev
export LUMOAUTH_ORG_ID=acme-corp
export AGENT_CLIENT_ID=...
export AGENT_CLIENT_SECRET=...
export APPROVER_EMAIL=...
```

The agent secret and every token stay in the server process. Never log them, never return them to the model, and never put them in a tool result.

### 2. Add the shared guard module

Create `lumo_guard.py` next to the agent code. It has no framework imports. Every reference file of this skill imports from it.

```python
"""LumoAuth gates for agent tools. Framework independent."""
import atexit
import os
from typing import Any, Dict, Optional

import requests

from lumoauth import (
    JITContext,
    LumoAuthAgent,
    LumoAuthApiError,
    LumoAuthApprovalNotDeliveredError,
    LumoAuthConfigError,
)

# 1. Identity: the process signs in as the registered agent.
agent = LumoAuthAgent()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET
if not agent.authenticate():
    raise RuntimeError("LumoAuth agent sign-in failed. Check AGENT_CLIENT_ID and AGENT_CLIENT_SECRET.")

jit = JITContext(agent)
atexit.register(jit.complete_task)  # revokes the JIT tokens of the open task


def check(action: str, **context: Any) -> Optional[str]:
    """2. Preflight with the Ask API. Returns None when allowed, else a refusal text."""
    try:
        decision = agent.ask(action, context or None)
    except LumoAuthApiError as exc:
        return f"Not allowed: {action} (check failed: HTTP {exc.status_code})"
    if decision.get("allowed") is True:
        return None
    return f"Not allowed: {action} ({decision.get('reason') or 'denied'})"


def approve(task_id: str, reason: str, impact: str = "high", **meta: Any) -> Optional[str]:
    """3. Human approval on the approver's phone. Returns None when approved, else a refusal text."""
    try:
        result = agent.approvals.require(
            task_id=task_id,
            reason=reason,
            on_behalf_of=os.environ["APPROVER_EMAIL"],
            impact=impact,
            meta=meta or None,
            timeout_s=90,
        )
    except LumoAuthApprovalNotDeliveredError as exc:
        return f"Not approved: the approver has no enrolled phone ({exc.reason})."
    except LumoAuthApiError as exc:
        return f"Not approved: the approval request failed (HTTP {exc.status_code})."
    if result.status != "approved":
        return f"Not approved: {result.status}."  # denied, expired, or pending after the timeout
    return None


def mcp_headers(server_url: str, method: str = "POST") -> Dict[str, str]:
    """4a. Headers with a token that works only at this MCP server."""
    try:
        return agent.get_mcp_credential(server_url).headers(method, server_url)
    except (LumoAuthApiError, LumoAuthConfigError) as exc:
        raise PermissionError(f"No token for {server_url}: {exc}") from exc


def call_api(method: str, url: str, justification: str, data: Optional[Dict[str, Any]] = None) -> requests.Response:
    """4b. Call an API of your organization. When it answers 403 with an
    Insufficient-Authorization-Details header, request that JIT permission and retry once."""
    if jit.task_id is None:
        jit.create_task(name="agent run")
    return jit.call_with_escalation(method, url, justification=justification, data=data)


def budget_spent() -> bool:
    return agent.is_budget_exhausted()
```

Notes on the module:

- `check` fails closed: an error from LumoAuth is a refusal.
- `agent.ask` is a server decision. It applies the agent's capabilities, the organization's authorization policies and the token's scope, writes an audit record, and counts toward the agent's budget. `agent.has_capability("documents.read")` reads the registered capabilities that the SDK cached at first use; use it for a cheap local check. Action naming and the Ask API belong to `lumoauth-agent-identity`.
- `approve` blocks while it polls, 90 seconds at most. In an `async` tool, call it with `await asyncio.to_thread(approve, ...)`.
- `call_api` sends the agent's own access token on the first attempt. Call only APIs that your organization runs. Never pass a URL that the model or a user supplied without checking its host against an allow-list.
- A JIT request for a risky operation waits for a reviewer, 5 minutes at most by default, and returns the original `403` response when nobody approves.

### 3. Wire the gates into the framework's tools

A guarded tool has the same body in every framework:

```python
from lumo_guard import approve, check


def wire_transfer(vendor: str, amount: int, invoice: str) -> str:
    """Wire money in US dollars to a vendor to pay an invoice."""
    refusal = check("payments.wire", vendor=vendor, amount=amount)
    if refusal:
        return refusal
    refusal = approve(
        f"wire-{invoice}",
        f"Wire ${amount:,} to {vendor} for invoice {invoice}",
        action="wire-transfer", vendor=vendor, amount=amount, invoice=invoice,
    )
    if refusal:
        return refusal
    return f"Wired ${amount:,} to {vendor} for invoice {invoice}"  # call the payment API here
```

Open the reference file for the framework. Each one has the install line, the tool registration and a complete runnable agent.

| Framework | Install | Tool registration | Reference |
|---|---|---|---|
| LangChain / LangGraph | `pip install langgraph langchain-openai` | `@tool` from `langchain_core.tools` | [references/langgraph.md](references/langgraph.md) |
| CrewAI | `pip install crewai crewai-tools` | `@tool` from `crewai.tools` | [references/crewai.md](references/crewai.md) |
| OpenAI Agents SDK | `pip install openai-agents` | `@function_tool` from `agents` | [references/openai-agents.md](references/openai-agents.md) |
| Agno | `pip install agno openai` | `@tool` from `agno.tools` | [references/agno.md](references/agno.md) |
| Google ADK | `pip install google-adk` | `FunctionTool(fn)` from `google.adk.tools` | [references/google-adk.md](references/google-adk.md) |
| Microsoft Agent Framework | `pip install agent-framework` (Python 3.10 or later) or the .NET packages | Annotated functions in `tools=[...]`; `AIFunctionFactory.Create(...)` in .NET | [references/microsoft-agent-framework.md](references/microsoft-agent-framework.md) |

For a TypeScript agent, the same four calls on `LumoAgent` from `@lumoauth/agent` are `agent.isAllowed(action, context)`, `agent.approvals.require({...})`, `agent.mcp.getToken(serverUrl)` and `agent.jit` (see `lumoauth-agent-approvals` for the code).

### 4. Check the budget before a run

```python
from lumo_guard import budget_spent

if budget_spent():
    raise RuntimeError("The agent's budget is spent. Do not start the run.")
```

LumoAuth counts model tokens and cost only when the agent reports them with `agent.report_usage(tokens=..., cost_usd=...)`. Budgets belong to `lumoauth-agent-identity`.

### 5. Optional: sign requests with the agent's own key (AAuth)

An agent with the AAuth identity type signs each request instead of sending only a bearer token. The tool body changes to one call; the framework code stays the same. `lumoauth-aauth` covers keys, registration and how to obtain the tokens.

```python
import os

from lumoauth import AAuthClient

aauth = AAuthClient(
    agent_identifier="https://agent.example.com",
    private_key_pem=os.environ["AGENT_PRIVATE_KEY_PEM"],  # load from a secret store
    org_id="acme-corp",
)


def fetch_report(report_id: str, access_token: str) -> str:
    """access_token is tokens["auth_token"] from aauth.request_authorization(...)."""
    response = aauth.signed_request(
        "GET",
        f"https://api.example.com/v1/reports/{report_id}",
        auth_token=access_token,
    )
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"
```

Install with `pip install "lumoauth[aauth]"`.

## Verify

1. Start the agent. A wrong secret stops the process at import of `lumo_guard` with the sign-in error.
2. Ask the agent for an action that its capabilities do not cover. The tool returns `Not allowed: ...` and the action does not run.
3. Ask for the sensitive action. The approver's phone shows the agent name, the reason and the fields that the tool passed. Deny it: the tool returns `Not approved: denied.` Approve it on a second run: the tool runs.
4. Call the MCP tool. The request carries a token whose audience is the MCP server URL.
5. In the portal, open **Audit logs** and filter by the agent. The Ask decisions, the approval and the token exchange are listed.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The gate is in the system prompt only | Instructions do not enforce anything | Put `check` and `approve` inside the tool function |
| `LumoAuthConfigError: Agent credentials required` at import | `AGENT_CLIENT_ID` or `AGENT_CLIENT_SECRET` is not set | Set the environment before the import |
| `check` always refuses with a capability reason | The agent lacks the capability, or the action name differs from the registered one | Compare the action with the agent's capabilities in the portal. Do not grant `*` |
| `Not approved: the approver has no enrolled phone` | `APPROVER_EMAIL` has no enrolled device or is not a user of the organization | Enroll the LumoAuth mobile app for that user |
| Approval request fails with HTTP 403 | **May act on behalf of users** is off, or the agent token was narrowed with scopes | Turn the setting on. Call `authenticate()` without scopes |
| The event loop stalls for up to 90 seconds | `approve` was called directly in an `async` tool | Use `asyncio.to_thread` |
| The model retries a denied action in a loop | The refusal text invites a retry | Return a final message, and tell the model in its instructions not to retry a refused action |
| `get_mcp_token` returns `None` | The exchange was refused: unknown Resource URI, or the server requires DPoP | Use the server's registered Resource URI. For DPoP install `lumoauth[dpop]`, create the agent with `LumoAuthAgent(dpop=True)` and use `get_mcp_credential(...).headers(...)` |
| The MCP server rejects the token | The token was sent to a different URL than the one it was issued for | Request one token for each MCP server |
| A JIT token is refused by LumoAuth's own API | A JIT token is for the protected API, not for agent calls | Keep using the agent's credential for LumoAuth calls |

## Starter project

`npx create-lumo-agent my-agent` scaffolds a Next.js (App Router) project with LumoAuth sign-in, an agent task route and a push approval route. It asks for the LumoAuth domain, the organization slug and an OAuth client ID. Options: `--template nextjs-agent` (the only template) and `--no-install`.

The generated server code reads an agent access token from `LUMOAUTH_AGENT_TOKEN`. A portal test token works for the permission check route, but the approval route refuses a test token (`403 test_token_not_accepted`). For the approval demo, and for anything that runs longer than one token lifetime, use `LumoAgent` from `@lumoauth/agent` in the server routes. It signs in with the agent's client ID and secret and refreshes the token. Call `agent.approvals.require({...})` in the approval route and `agent.isAllowed(action, context)` in the task route.

## Related skills

- `lumoauth-agent-identity`: register the agent, capabilities, budgets, the Ask API.
- `lumoauth-agent-approvals`: push approval, JIT permissions, reviewers and auto-approve rules in depth.
- `lumoauth-mcp-client`: MCP sessions, discovery and token exchange for one MCP server.
- `lumoauth-agent-delegation`: act for a signed-in user.
- `lumoauth-agent-governance`: suspend an agent, conditional access, tracing.

## References

- [LangChain / LangGraph](references/langgraph.md): tool-level gates and a graph with an approval node.
- [CrewAI](references/crewai.md)
- [OpenAI Agents SDK](references/openai-agents.md)
- [Agno](references/agno.md)
- [Google ADK](references/google-adk.md)
- [Microsoft Agent Framework](references/microsoft-agent-framework.md): Python and .NET.
- https://docs.lumoauth.dev/agents/registry-langchain
- https://docs.lumoauth.dev/agents/jit-langgraph
- https://docs.lumoauth.dev/agents/registry-crewai
- https://docs.lumoauth.dev/agents/registry-openai-agents
- https://docs.lumoauth.dev/agents/registry-agno
- https://docs.lumoauth.dev/agents/registry-google-adk
- https://docs.lumoauth.dev/agents/registry-msft
- https://docs.lumoauth.dev/quickstarts/create-lumo-agent
