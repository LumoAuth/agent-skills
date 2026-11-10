# Microsoft Agent Framework

Open this file when the agent uses the Microsoft Agent Framework, in Python (`agent-framework`) or .NET (`Microsoft.Agents.AI`). The Python part needs `lumo_guard.py` from `SKILL.md`. The .NET part is self-contained.

## Python

```bash
pip install "lumoauth>=1.4.0" agent-framework
```

Python 3.10 or later. Environment, in addition to the LumoAuth variables: the settings of the chat client that the project uses (the example uses `OpenAIChatClient`).

```python
import asyncio
from typing import Annotated

import requests
from agent_framework import Agent
from agent_framework.openai import OpenAIChatClient
from pydantic import Field

from lumo_guard import approve, budget_spent, call_api, check, jit, mcp_headers

MCP_URL = "https://mcp.example.com/mcp"


def search_company_documents(
    query: Annotated[str, Field(description="The search query for company documents")],
) -> str:
    """Search internal company documents for the given query."""
    refusal = check("documents.read", query=query)
    if refusal:
        return refusal
    response = call_api(
        "GET",
        "https://api.example.com/v1/documents/search",
        justification=f"Search documents for: {query}",
    )
    return response.text if response.status_code == 200 else f"Error: HTTP {response.status_code}"


def query_financial_mcp(
    metric: Annotated[str, Field(description="The financial metric to retrieve")],
) -> str:
    """Query the financial metrics MCP server."""
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


def wire_transfer(
    vendor: Annotated[str, Field(description="The vendor to pay")],
    amount: Annotated[int, Field(description="The amount in US dollars")],
    invoice: Annotated[str, Field(description="The invoice number")],
) -> str:
    """Wire money to a vendor to pay an invoice. Needs human approval."""
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


if budget_spent():
    raise RuntimeError("The agent's budget is spent.")

agent = Agent(
    client=OpenAIChatClient(),
    name="Research Analyst",
    instructions=(
        "You are a senior analyst. Use the tools to search documents, query metrics and pay invoices. "
        "If a tool says that an action is not allowed or not approved, do not retry. Tell the user why."
    ),
    tools=[search_company_documents, query_financial_mcp, wire_transfer],
)


async def main() -> None:
    try:
        response = await agent.run(
            "Search documents for Q3 performance, then query the financial MCP for EBITDA."
        )
        print(response)
    finally:
        jit.complete_task()  # revokes the JIT tokens of this run


if __name__ == "__main__":
    asyncio.run(main())
```

## .NET

```bash
dotnet add package LumoAuth
dotnet add package Microsoft.Agents.AI
dotnet add package Azure.AI.OpenAI
dotnet add package Azure.Identity
```

The `LumoAuth` package targets .NET 8. The Microsoft Agent Framework packages need the .NET 10 SDK.

```bash
export LUMOAUTH_URL=https://app.lumoauth.dev
export LUMOAUTH_ORG_ID=acme-corp
export AGENT_CLIENT_ID=...
export AGENT_CLIENT_SECRET=...
export APPROVER_EMAIL=...
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
export AZURE_OPENAI_DEPLOYMENT_NAME=...
```

```csharp
using System.ComponentModel;
using Azure.AI.OpenAI;
using Azure.Identity;
using LumoAuth;
using LumoAuth.Errors;
using LumoAuth.Models;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

// 1. Identity. Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID and AGENT_CLIENT_SECRET.
//    The token is fetched on first use and refreshed.
var lumo = LumoAgent.FromEnvironment();

// Stop before the run when the agent's budget is spent.
await lumo.CheckBudgetAsync();   // throws LumoAuthBudgetExceededException

// JIT context for calls to protected APIs. Disposal completes the task and revokes its tokens.
await using var jit = new JitContext(lumo);
await jit.CreateTaskAsync(CreateTaskRequest.Named("Research run"));

// 2. Preflight with the Ask API. Fails closed.
async Task<string?> CheckAsync(string action, object? context = null)
{
    try
    {
        return await lumo.IsAllowedAsync(action, context) ? null : $"Not allowed: {action}";
    }
    catch (LumoAuthException)
    {
        return $"Not allowed: {action} (check failed)";
    }
}

[Description("Search internal company documents for the given query.")]
async Task<string> SearchCompanyDocuments([Description("Search query")] string query)
{
    if (await CheckAsync("documents.read", new { query }) is { } refusal) return refusal;

    // 4b. Protected API. On 403 with Insufficient-Authorization-Details the helper
    //     requests that JIT permission and retries once.
    using HttpResponseMessage response = await jit.CallWithEscalationAsync(
        "GET",
        "https://api.example.com/v1/documents/search?q=" + Uri.EscapeDataString(query),
        options: new JitContext.RequestOptions { Justification = $"Search documents for: {query}" });
    return response.IsSuccessStatusCode
        ? await response.Content.ReadAsStringAsync()
        : $"Error: HTTP {(int)response.StatusCode}";
}

[Description("Query the secured financial metrics MCP server.")]
async Task<string> QueryFinancialMcp([Description("The financial metric")] string metric)
{
    if (await CheckAsync("mcp.financial", new { metric }) is { } refusal) return refusal;

    // 4a. Token exchange: a token that works only at this MCP server.
    string mcpToken = await lumo.McpTokenAsync("https://mcp.example.com/mcp");
    // Pass mcpToken as "Authorization: Bearer ..." to the MCP client of the project.
    return $"Token obtained for the MCP server; metric requested: {metric}";
}

[Description("Wire money in US dollars to a vendor to pay an invoice. Needs human approval.")]
async Task<string> WireTransfer(
    [Description("The vendor to pay")] string vendor,
    [Description("The amount in US dollars")] int amount,
    [Description("The invoice number")] string invoice)
{
    if (await CheckAsync("payments.wire", new { vendor, amount }) is { } refusal) return refusal;

    // 3. Human approval on the approver's phone. Anything other than approval is an exception.
    try
    {
        await lumo.Approvals.RequireAsync(new ApprovalRequest
        {
            TaskId = $"wire-{invoice}",
            Reason = $"Wire ${amount:N0} to {vendor} for invoice {invoice}",
            OnBehalfOf = Environment.GetEnvironmentVariable("APPROVER_EMAIL")!,
            Impact = ApprovalImpact.High,
            Meta = new { action = "wire-transfer", vendor, amount, invoice },
        });
    }
    catch (LumoAuthApprovalDeniedException) { return "Not approved: denied."; }
    catch (LumoAuthApprovalTimeoutException) { return "Not approved: no answer in time."; }
    catch (LumoAuthApprovalNotDeliveredException e) { return $"Not approved: the approver has no enrolled phone ({e.Reason})."; }
    catch (LumoAuthException) { return "Not approved: the approval request failed."; }

    return $"Wired ${amount:N0} to {vendor} for invoice {invoice}";   // call the payment API here
}

// Framework glue. Use ManagedIdentityCredential in production.
AIAgent agent = new AzureOpenAIClient(
        new Uri(Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")!),
        new DefaultAzureCredential())
    .GetChatClient(Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT_NAME")!)
    .AsAIAgent(
        name: "Research Analyst",
        instructions: "You are a senior analyst. Use the tools. If a tool says that an action is not allowed or not approved, do not retry. Tell the user why.",
        tools:
        [
            AIFunctionFactory.Create(SearchCompanyDocuments, name: nameof(SearchCompanyDocuments)),
            AIFunctionFactory.Create(QueryFinancialMcp,      name: nameof(QueryFinancialMcp)),
            AIFunctionFactory.Create(WireTransfer,           name: nameof(WireTransfer)),
        ]);

Console.WriteLine(await agent.RunAsync(
    "Search documents for Q3 performance, then query the financial MCP for EBITDA."));
```

## Python and .NET side by side

| Step | Python | .NET |
|---|---|---|
| Sign in as the agent | `LumoAuthAgent()` + `authenticate()` | `LumoAgent.FromEnvironment()` (token fetched on first use) |
| Preflight, server decision | `agent.ask(action, context)` / `agent.is_allowed(...)` | `lumo.AskAsync(action, context)` / `lumo.IsAllowedAsync(...)` |
| Preflight, registered capabilities | `agent.has_capability(name)` | `lumo.HasCapabilityAsync(name)` |
| Budget | `agent.is_budget_exhausted()` | `lumo.CheckBudgetAsync()` (throws) |
| Human approval | `agent.approvals.require(...)` returns a status | `lumo.Approvals.RequireAsync(...)` throws unless approved |
| MCP token | `agent.get_mcp_credential(url)` / `agent.get_mcp_token(url)` | `lumo.McpTokenAsync(url)` |
| JIT context | `JITContext(agent)` | `new JitContext(lumo)` |
| Register tools | annotated functions in `tools=[...]` | `AIFunctionFactory.Create(...)` |
| Run | `await agent.run(...)` | `await agent.RunAsync(...)` |

## Notes

- On Azure, the agent can authenticate with the identity that the platform already gives the workload instead of a client secret. That is workload federation; see `lumoauth-agent-identity`.
- The .NET `McpTokenAsync` call does not send a DPoP proof. An MCP server that is registered with **Require DPoP** refuses that token.
- The Azure OpenAI credential and the LumoAuth agent credential are separate. The first one pays for model calls. The second one is the agent's identity for authorization, approval and audit.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuthConfigException` at start | `AGENT_CLIENT_ID` or `AGENT_CLIENT_SECRET` is not set | Set the environment variables |
| `LumoAuthBudgetExceededException` from `CheckBudgetAsync` | The agent's budget is spent | Do not start the run. Budgets: `lumoauth-agent-identity` |
| `.AsAIAgent` or `AIFunctionFactory` does not resolve | The Microsoft Agent Framework packages are missing or the SDK is too old | Add the packages and use the .NET 10 SDK |
| The approval exception is not caught and the run ends | Only the denied case was handled | Catch all three approval exceptions |
