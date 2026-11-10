# Google ADK

Open this file when the agent is built with the Google Agent Development Kit (`google-adk`). It needs `lumo_guard.py` from `SKILL.md`.

```bash
pip install "lumoauth>=1.4.0" google-adk
```

Environment, in addition to the LumoAuth variables: the model credentials that the user's ADK project already uses. Ask the user when they are not set.

## Complete agent

ADK tools are plain functions that return a `dict`. Return `{"error": ...}` for a refusal and `{"result": ...}` for a success.

```python
import asyncio

import requests
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types

from lumo_guard import approve, budget_spent, call_api, check, jit, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


def fetch_document(document_id: str) -> dict:
    """Fetch a sensitive document from the protected API."""
    refusal = check("documents.read", id=document_id)
    if refusal:
        return {"error": refusal}
    response = call_api(
        "GET",
        f"https://api.example.com/v1/documents/{document_id}",
        justification=f"Read document {document_id} for the user's request",
    )
    if response.status_code == 200:
        return {"result": response.text}
    return {"error": f"HTTP {response.status_code}"}


def query_financial_mcp(metric: str) -> dict:
    """Query the financial metrics MCP server for one metric."""
    refusal = check("mcp.financial", metric=metric)
    if refusal:
        return {"error": refusal}
    try:
        headers = mcp_headers(MCP_URL)
    except PermissionError as exc:
        return {"error": str(exc)}
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
    if response.status_code == 200:
        return {"result": response.text}
    return {"error": f"HTTP {response.status_code}"}


def create_report(title: str, content: str) -> dict:
    """Create a report and send it to the board list. Needs human approval."""
    refusal = check("reports.send", title=title)
    if refusal:
        return {"error": refusal}
    refusal = approve(
        f"report-{title[:60]}",
        f"Send the report '{title}' to the board list",
        impact="high",
        action="send-report", title=title, length=len(content),
    )
    if refusal:
        return {"error": refusal}
    response = call_api(
        "POST",
        "https://api.example.com/v1/reports",
        justification=f"Create the approved report '{title}'",
        data={"title": title, "content": content},
    )
    if response.status_code in (200, 201):
        return {"result": "Report created."}
    return {"error": f"HTTP {response.status_code}"}


analyst_agent = Agent(
    name="protected_data_analyst",
    model="gemini-2.0-flash",
    description="Fetches protected documents and metrics and creates reports.",
    instruction=(
        "You are a senior analyst. Use the tools to fetch documents and metrics and to create reports. "
        "If a tool returns an error that says not allowed or not approved, do not retry. Tell the user why."
    ),
    tools=[
        FunctionTool(fetch_document),
        FunctionTool(query_financial_mcp),
        FunctionTool(create_report),
    ],
)


async def main() -> None:
    if budget_spent():
        raise RuntimeError("The agent's budget is spent.")

    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name="protected_data_analyst", user_id="analyst_user"
    )
    runner = Runner(
        agent=analyst_agent,
        app_name="protected_data_analyst",
        session_service=session_service,
    )
    content = types.Content(
        role="user",
        parts=[types.Part.from_text(
            text="Fetch document doc_9982, summarize it, and create a report titled 'Q4 Analysis'."
        )],
    )

    try:
        async for event in runner.run_async(
            user_id="analyst_user",
            session_id=session.id,
            new_message=content,
        ):
            if event.is_final_response():
                for part in event.content.parts:
                    print(part.text)
    finally:
        jit.complete_task()  # revokes the JIT tokens of this run


if __name__ == "__main__":
    asyncio.run(main())
```

## Notes for Google ADK

- Use the model that the user's project already uses. `gemini-2.0-flash` is the model in the LumoAuth documentation; ask before changing a project's model.
- `types.Part.from_text` takes `text` as a keyword argument.
- The tools are plain synchronous functions, as in the LumoAuth documentation. A tool that waits for a person blocks its call for up to 90 seconds (phone approval) or up to 5 minutes (JIT review).
- The `user_id` of the ADK session is ADK's own label. It is not a LumoAuth user and it authorizes nothing. The approver is `APPROVER_EMAIL`; a user that the agent acts for is established through `lumoauth-agent-delegation`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The model treats a refusal as data | The tool returned the refusal under `result` | Return it under `error` |
| Nothing arrives on the phone | `APPROVER_EMAIL` has no enrolled device | Enroll the LumoAuth mobile app for that user |
| JIT tokens stay valid after the run | `jit.complete_task()` was not reached | Keep it in `finally` |
