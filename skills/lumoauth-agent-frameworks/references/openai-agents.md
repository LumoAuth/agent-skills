# OpenAI Agents SDK

Open this file when the agent uses the OpenAI Agents SDK (`openai-agents`, imported as `agents`). It needs `lumo_guard.py` from `SKILL.md`.

```bash
pip install "lumoauth>=1.4.0" openai-agents
```

Environment, in addition to the LumoAuth variables: `OPENAI_API_KEY`.

## Complete agent

The run loop is asynchronous. The LumoAuth calls block, so the tools are `async` and run each gate in a worker thread.

```python
import asyncio

import requests
from agents import Agent, Runner, function_tool

from lumo_guard import approve, budget_spent, call_api, check, jit, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


@function_tool
async def fetch_document(document_id: str) -> str:
    """Fetch a document from the protected API."""
    refusal = await asyncio.to_thread(check, "documents.read", id=document_id)
    if refusal:
        return refusal
    response = await asyncio.to_thread(
        call_api,
        "GET",
        f"https://api.example.com/v1/documents/{document_id}",
        f"Read document {document_id} for the user's request",
    )
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"


def _mcp_metric(metric: str) -> str:
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


@function_tool
async def query_financial_mcp(metric: str) -> str:
    """Query the financial metrics MCP server for one metric."""
    refusal = await asyncio.to_thread(check, "mcp.financial", metric=metric)
    if refusal:
        return refusal
    return await asyncio.to_thread(_mcp_metric, metric)


@function_tool
async def wire_transfer(vendor: str, amount: int, invoice: str) -> str:
    """Wire money in US dollars to a vendor to pay an invoice. Needs human approval."""
    refusal = await asyncio.to_thread(check, "payments.wire", vendor=vendor, amount=amount)
    if refusal:
        return refusal
    refusal = await asyncio.to_thread(
        approve,
        f"wire-{invoice}",
        f"Wire ${amount:,} to {vendor} for invoice {invoice}",
        "high",
        action="wire-transfer", vendor=vendor, amount=amount, invoice=invoice,
    )
    if refusal:
        return refusal
    return f"Wired ${amount:,} to {vendor} for invoice {invoice}"  # call the payment API here


finance_agent = Agent(
    name="Finance Assistant",
    instructions=(
        "You read documents, look up metrics and pay invoices with the tools. "
        "If a tool says that an action is not allowed or not approved, do not retry. Tell the user why."
    ),
    tools=[fetch_document, query_financial_mcp, wire_transfer],
)


async def main() -> None:
    if budget_spent():
        raise RuntimeError("The agent's budget is spent.")
    try:
        result = await Runner.run(
            finance_agent,
            "Fetch document doc_9982, then pay Bluepeak Supplies invoice INV-7741 for $4,500.",
        )
        print(result.final_output)
    finally:
        jit.complete_task()  # revokes the JIT tokens of this run


if __name__ == "__main__":
    asyncio.run(main())
```

## Notes for the OpenAI Agents SDK

- `@function_tool` accepts plain and `async` functions. The LumoAuth documentation shows plain functions; they work for gates that answer at once. Use `async` with `asyncio.to_thread` when a gate can wait for a person, so the event loop stays free.
- The docstring is the tool description that the model reads. State in it that the tool needs approval; the model can then tell the user to expect a prompt.
- Traces and logs can include tool inputs and outputs. Tools in this file never return a token.
- When the project uses an MCP client library instead of the single request shown here, pass it the headers from `mcp_headers(MCP_URL)`. `lumoauth-mcp-client` covers the session and token details.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The run stalls while a prompt is open | A blocking gate ran on the event loop | Wrap the call in `asyncio.to_thread` |
| The model calls `wire_transfer` again after a denial | The instructions invite retries | Tell the model not to retry a refused action |
| `Not allowed: payments.wire` for every call | The agent has no capability that covers `payments.wire` | Add the capability to the agent in the portal, or check the action name |
