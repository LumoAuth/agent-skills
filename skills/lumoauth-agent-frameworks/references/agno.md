# Agno

Open this file when the agent is built with Agno. It needs `lumo_guard.py` from `SKILL.md`.

```bash
pip install "lumoauth>=1.4.0" agno openai
```

Environment, in addition to the LumoAuth variables: `OPENAI_API_KEY` and `OPENAI_MODEL` (ask the user which model to use).

## Complete agent

```python
import os

import requests
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool

from lumo_guard import approve, budget_spent, call_api, check, jit, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


@tool
def fetch_document(document_id: str) -> str:
    """Fetch a sensitive document from the protected API."""
    refusal = check("documents.read", id=document_id)
    if refusal:
        return refusal
    response = call_api(
        "GET",
        f"https://api.example.com/v1/documents/{document_id}",
        justification=f"Read document {document_id} for the user's request",
    )
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"


@tool
def query_financial_mcp(metric: str) -> str:
    """Query the financial metrics MCP server for one metric."""
    refusal = check("mcp.financial", metric=metric)
    if refusal:
        return refusal
    try:
        headers = mcp_headers(MCP_URL)
    except PermissionError as exc:
        return f"Error: {exc}"
    response = requests.post(
        MCP_URL,
        headers={**headers, "Content-Type": "application/json"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_metric", "arguments": {"metric": metric}},
        },
        timeout=30,
    )
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"


@tool
def delete_customer_record(customer_id: str) -> str:
    """Delete a customer record. Needs human approval."""
    refusal = check("customers.delete", id=customer_id)
    if refusal:
        return refusal
    refusal = approve(
        f"delete-customer-{customer_id}",
        f"Delete customer record {customer_id}",
        impact="critical",
        action="delete-customer", customer_id=customer_id,
    )
    if refusal:
        return refusal
    response = call_api(
        "DELETE",
        f"https://api.example.com/v1/customers/{customer_id}",
        justification=f"Delete customer {customer_id} after approval",
    )
    return "Deleted." if response.status_code in (200, 204) else f"Error: HTTP {response.status_code}"


if budget_spent():
    raise RuntimeError("The agent's budget is spent.")

agno_agent = Agent(
    name="Protected Data Analyst",
    model=OpenAIChat(id=os.environ["OPENAI_MODEL"]),
    tools=[fetch_document, query_financial_mcp, delete_customer_record],
    instructions=[
        "You are a senior analyst with access to protected APIs.",
        "If a tool says that an action is not allowed or not approved, do not retry. Tell the user why.",
    ],
    markdown=True,
)

try:
    agno_agent.print_response(
        "Fetch document doc_9982 and query the financial MCP for EBITDA, "
        "then give a combined summary."
    )
finally:
    jit.complete_task()  # revokes the JIT tokens of this run
```

## Notes for Agno

- The tool's docstring is the description that the model reads. Say there that the tool needs approval.
- `delete_customer_record` uses two human steps on purpose: the phone approval names the action for one person, and the API can still demand a JIT permission that the organization's reviewers decide. Use one of them when one is enough. `lumoauth-agent-approvals` explains the difference.
- Keep the LumoAuth identity outside the Agno `Agent`. The Agno agent is the reasoning loop; `lumo_guard.agent` is the identity that LumoAuth authenticates, audits and can suspend.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Approval fails with `Not approved: the approval request failed (HTTP 403)` | **May act on behalf of users** is off for the agent | Turn it on in the portal |
| `Error: HTTP 403` after an approval on the phone | The API also requires a JIT permission and no reviewer approved it in time | Check **AI Agents → Approvals**, or give the agent the capability |
| JIT tokens stay valid after the run | `jit.complete_task()` was not reached | Keep it in `finally` |
