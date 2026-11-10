# CrewAI

Open this file when the agent is a CrewAI crew. It needs `lumo_guard.py` from `SKILL.md`.

```bash
pip install "lumoauth>=1.4.0" crewai crewai-tools
```

Environment, in addition to the LumoAuth variables: the model provider settings that CrewAI uses, for example `OPENAI_API_KEY`.

## Complete agent

```python
import requests
from crewai import Agent, Crew, Task
from crewai.tools import tool

from lumo_guard import approve, budget_spent, call_api, check, jit, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


@tool
def fetch_sensitive_document(document_id: str) -> str:
    """Fetch a sensitive document from the protected API."""
    refusal = check("documents.read", id=document_id)
    if refusal:
        return refusal
    response = call_api(
        "GET",
        f"https://api.example.com/v1/documents/{document_id}",
        justification=f"Read document {document_id} for the analysis task",
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
def publish_report(title: str, content: str) -> str:
    """Publish an analysis report to customers. Needs human approval."""
    refusal = check("reports.publish", title=title)
    if refusal:
        return refusal
    refusal = approve(
        f"publish-{title[:60]}",
        f"Publish the report '{title}' to customers",
        impact="high",
        action="publish-report", title=title, length=len(content),
    )
    if refusal:
        return refusal
    response = call_api(
        "POST",
        "https://api.example.com/v1/reports",
        justification=f"Publish the approved report '{title}'",
        data={"title": title, "content": content},
    )
    return "Report published." if response.status_code in (200, 201) else f"Error: HTTP {response.status_code}"


if budget_spent():
    raise RuntimeError("The agent's budget is spent.")

analyst = Agent(
    role="Senior Analyst",
    goal="Retrieve confidential documents and metrics, then produce a report",
    backstory="You are a senior analyst with access to protected company systems. "
              "If a tool says that an action is not allowed or not approved, stop and report it.",
    tools=[fetch_sensitive_document, query_financial_mcp, publish_report],
    verbose=True,
)

analysis_task = Task(
    description="Fetch document doc_9982, query the financial MCP for EBITDA, "
                "and publish a concise analysis report.",
    expected_output="Confirmation that the report was published, or the reason why it was not.",
    agent=analyst,
)

crew = Crew(agents=[analyst], tasks=[analysis_task], verbose=True)

try:
    print(crew.kickoff())
finally:
    jit.complete_task()  # revokes the JIT tokens of this run
```

## Notes for CrewAI

- One LumoAuth agent identity per process is the simplest setup: every CrewAI `Agent` in the crew then shares the capabilities of that identity. When crew members need different rights, register one LumoAuth agent for each role and create one `LumoAuthAgent(client_id=..., client_secret=...)` for each, instead of the single `agent` in `lumo_guard.py`.
- An agent can call a tool again after a refusal. Word refusals as final ("Not approved: denied.") and tell the agent in its `backstory` to stop on a refusal. Each new call of `approve` sends a new prompt to the approver's phone.
- Verbose output can include tool inputs and results. Tools in this file never return a token, so no token reaches the log.
- The `task_id` of an approval is 128 characters at most; the example cuts the title.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The approver gets several prompts for one action | The agent retried the tool after a refusal | Make the refusal final and instruct the agent to stop |
| `Error: HTTP 403` from `call_api` | The API named a permission, and the JIT request was denied, expired or still pending | Check **AI Agents → Approvals** in the portal |
| JIT tokens stay valid after the crew ends | `jit.complete_task()` was not reached | Keep it in `finally` |
