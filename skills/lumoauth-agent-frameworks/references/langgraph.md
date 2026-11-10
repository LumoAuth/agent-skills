# LangChain and LangGraph

Open this file when the agent uses LangChain tools with a LangGraph agent or graph. It needs `lumo_guard.py` from `SKILL.md`.

```bash
pip install "lumoauth>=1.4.0" "langgraph>=1.0" "langchain-openai>=1.0"
```

Environment, in addition to the LumoAuth variables: `OPENAI_API_KEY` and `OPENAI_MODEL` (ask the user which model to use).

Two layouts follow. Use the first for a tool-calling agent where each tool guards itself. Use the second when the approval must be a visible step of the graph.

## Layout 1: guarded tools in a ReAct agent

```python
import os

import requests
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from lumo_guard import approve, budget_spent, call_api, check, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


@tool
def search_company_documents(query: str) -> str:
    """Search internal company documents."""
    refusal = check("documents.read", query=query)
    if refusal:
        return refusal
    response = call_api(
        "GET",
        "https://api.example.com/v1/documents/search",
        justification=f"Search documents for: {query}",
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


llm = ChatOpenAI(model=os.environ["OPENAI_MODEL"], temperature=0)
agent_executor = create_react_agent(llm, [search_company_documents, query_financial_mcp, wire_transfer])


def run(user_query: str) -> None:
    if budget_spent():
        print("The agent's budget is spent.")
        return
    events = agent_executor.stream({"messages": [("user", user_query)]}, stream_mode="values")
    for event in events:
        event["messages"][-1].pretty_print()


if __name__ == "__main__":
    run("Search documents for Q3 performance, then query the financial MCP for EBITDA.")
```

The MCP call above is one JSON-RPC request. A real MCP client library keeps a session; pass the same headers to it. `lumoauth-mcp-client` covers that.

## Layout 2: approval as a node of the graph

The model proposes the tool call. The graph routes it to an `ask_human` node. The tool node runs only after an approval, with the same arguments that the approver saw.

```
START → plan ─tool call─→ ask_human ─approved──→ send_wire ─→ plan → END
          │                         └─otherwise─→ cancel ────→ plan → END
          └─no tool call─→ END
```

```python
import os
import time

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from lumo_guard import approve, check


@tool
def wire_transfer(vendor: str, amount: int, invoice: str) -> str:
    """Wire money in US dollars to a vendor to pay an invoice."""
    return f"Wired ${amount:,} to {vendor} for invoice {invoice}"  # call the payment API here


SYSTEM = "You pay invoices with wire_transfer. If a wire is not sent, don't retry. Say why."
llm = ChatOpenAI(model=os.environ["OPENAI_MODEL"])
llm = llm.bind_tools([wire_transfer], parallel_tool_calls=False)


class State(MessagesState):
    decision: str  # "approved" or a refusal text


def plan(state: State):
    return {"messages": [llm.invoke([("system", SYSTEM), *state["messages"]])]}


def needs_approval(state: State) -> str:
    return "ask_human" if state["messages"][-1].tool_calls else END


def ask_human(state: State):
    args = state["messages"][-1].tool_calls[0]["args"]
    refusal = check("payments.wire", vendor=args["vendor"], amount=args["amount"])
    if refusal is None:
        refusal = approve(
            f"wire-{args['invoice']}-{time.strftime('%H%M%S')}",
            f"Wire ${args['amount']:,} to {args['vendor']} for invoice {args['invoice']}",
            action="wire-transfer", **args,
        )
    return {"decision": refusal or "approved"}


def route(state: State) -> str:
    return "send_wire" if state["decision"] == "approved" else "cancel"


def cancel(state: State):
    call_id = state["messages"][-1].tool_calls[0]["id"]
    return {"messages": [ToolMessage(f"Not sent. {state['decision']}", tool_call_id=call_id)]}


builder = StateGraph(State)
builder.add_node(plan)
builder.add_node(ask_human)
builder.add_node("send_wire", ToolNode([wire_transfer]))  # runs only after an approval
builder.add_node(cancel)
builder.add_edge(START, "plan")
builder.add_conditional_edges("plan", needs_approval, ["ask_human", END])
builder.add_conditional_edges("ask_human", route, ["send_wire", "cancel"])
builder.add_edge("send_wire", "plan")
builder.add_edge("cancel", "plan")
graph = builder.compile()


if __name__ == "__main__":
    request = "Pay Bluepeak Supplies invoice INV-7741 for $4,500."
    for step in graph.stream({"messages": [("user", request)]}, stream_mode="updates"):
        for node, update in step.items():
            print(f"\n[{node}]")
            for message in update.get("messages", []):
                message.pretty_print()
            if "decision" in update:
                print(f"decision: {update['decision']}")
```

Points that matter in this layout:

- `parallel_tool_calls=False` keeps one tool call per turn, so one approval covers one action.
- The reason and the `meta` fields come from the tool call's own arguments. `send_wire` runs that same tool call, so the approver sees what will run.
- `cancel` answers the tool call with a `ToolMessage`. Without it the model's tool call has no result and the next model call fails.
- The task id includes a time, so a second attempt for the same invoice is a new approval request.

## Letting the model request a JIT permission

`call_api` in `lumo_guard.py` escalates inside the tool, which is the shortest form. When the model should see the permission request as its own step, give it two tools: one that reports the missing permission, and one that requests it.

```python
import base64
import json

import requests
from langchain_core.tools import tool

from lumo_guard import agent, jit

jit_tokens = {}  # document id -> JIT token; kept in the process, never returned to the model


@tool
def fetch_protected_document(document_id: str) -> str:
    """Fetch a sensitive document. On a permission error the result names the
    authorization details to request with request_jit_access."""
    url = f"https://api.example.com/v1/documents/{document_id}"
    token = jit_tokens.get(document_id) or agent.access_token
    response = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if response.status_code == 403:
        header = response.headers.get("Insufficient-Authorization-Details")
        if header:
            required = json.loads(base64.b64decode(header))
            return json.dumps({"error": "permission required", "document_id": document_id,
                               "required_authorization_details": required})
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"


@tool
def request_jit_access(document_id: str, required_authorization_details_json: str, justification: str) -> str:
    """Request just-in-time access. Pass the exact required_authorization_details
    JSON from the failing tool, then call that tool again."""
    if jit.task_id is None:
        jit.create_task(name="LangGraph document analysis")
    details = json.loads(required_authorization_details_json)
    result = jit.request_permission(details, justification=justification)
    if result.get("status") != "approved":
        return f"Access not granted: {result.get('status')}"
    jit_tokens[document_id] = jit.get_token(result["request_id"])
    return "Access granted. Call fetch_protected_document again."
```

The JIT token stays in `jit_tokens`. The model receives only "Access granted". `jit.complete_task()` (registered with `atexit` in `lumo_guard.py`) revokes the tokens.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The graph runs the tool before the approval | The tool node is reachable from `plan` directly | Route every tool call through `ask_human` |
| The model call after a refusal fails because a tool call has no result | The cancel path returned no `ToolMessage` | Answer the tool call in `cancel` |
| Two approvals for one user request | Parallel tool calls | Bind tools with `parallel_tool_calls=False` |
| The token appears in the model's context | The tool returned the JIT token | Keep tokens in process state |
