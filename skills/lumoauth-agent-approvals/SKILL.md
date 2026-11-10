---
name: lumoauth-agent-approvals
description: >-
  Puts a human in the loop for AI agent actions with LumoAuth. Covers push approval on the
  approver's phone (approvals.require in @lumoauth/agent and @lumoauth/backend, require_approval in
  the lumoauth Python package), just-in-time (JIT) permissions (task, request with
  authorization_details, human review, short-lived JIT token, revocation when the task ends;
  JITContext, agent.jit), async authorization (agent-initiated CIBA, poll mode), auto-approve rules,
  the approvals inbox and reviewer roles (jit.approve). Use when an agent must ask a person before it
  sends money, deletes data, sends email or runs another sensitive tool, when the user asks for
  human-in-the-loop (HITL), approval gates, step-up for agents, rich authorization requests
  (RFC 9396), Insufficient-Authorization-Details handling, or approval from Slack, Microsoft Teams,
  ServiceNow or Jira.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth agent approvals

Make an AI agent stop and ask a person before a sensitive action. This skill covers three mechanisms, the code for each, and the portal setup that reviewers need.

## When to use

| The user wants | Use | Result for the agent |
|---|---|---|
| A yes or no from one named person, on their phone, before a tool runs | Push approval | A status: `approved`, `denied`, `expired` or `pending` |
| A short-lived token for one exact operation, reviewed by the organization's reviewers when the operation is risky | JIT permissions | A JIT token that carries the approved `authorization_details` |
| A named user's authorization while that user is away from the agent, with a token as the result | Async authorization (agent CIBA) | A JIT token with the user as `sub`. Read `references/async-authorization.md` |

Do not use this skill for:

- Registering the agent or choosing its credential: use `lumoauth-agent-identity`.
- Acting for a user with token exchange: use `lumoauth-agent-delegation`.
- Wiring approval into LangGraph, CrewAI or another framework: use `lumoauth-agent-frameworks` after this skill.
- Setting up a Slack, Teams, ServiceNow or Jira approval channel: use `lumoauth-integrations`.
- Push sign-in for human users (MFA): use `lumoauth-mfa-passkeys`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` in the portal URL, for example `acme-corp` |
| Agent client ID and secret | Shown once when the agent is registered under **AI Agents → Agents → Register agent** (see `lumoauth-agent-identity`) |
| Approver | The email address of the user who must approve. The user belongs to the same organization |

Check these conditions with the user. Each one is a common cause of failure:

1. **May act on behalf of users** is on for the agent (portal: **AI Agents → Agents**, edit the agent). Push approval and agent CIBA need it. A JIT task that names a user in `on_behalf_of` needs it too.
2. For push approval and agent CIBA, the approver has enrolled the Lumo Authenticator app (the LumoAuth mobile app): **My account → Sign-in & security → Add a sign-in method → LumoAuth app**.
3. For JIT permissions, at least one user who is not the agent's owner holds the `jit.approve` permission. The owner of an agent can never review that agent's requests.

Availability of JIT permissions, approval channels and CIBA depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Steps

### 1. Install the SDK and set the environment

```bash
pip install "lumoauth>=1.4.0"        # Python 3.9 or later
npm install @lumoauth/agent          # Node.js 18 or later
```

```bash
export LUMOAUTH_URL=https://app.lumoauth.dev
export LUMOAUTH_ORG_ID=acme-corp
export AGENT_CLIENT_ID=...       # from the Agent created page
export AGENT_CLIENT_SECRET=...   # shown once; keep it in a secret store
```

`LumoAuthAgent` (Python) and `LumoAgent` (TypeScript) read these four variables. The agent secret is a server-side secret. Never put it in browser or mobile code, and never log it or the tokens that it yields.

### 2. Push approval: ask one person, wait for the answer

The helper sends a prompt to the approver's phone and polls until the person answers or the timeout passes. The prompt expires on the server after 120 seconds, so the default timeout is 90 seconds.

Python:

```python
import os

from lumoauth import (
    LumoAuthAgent,
    LumoAuthApprovalNotDeliveredError,
    require_approval,
)

agent = LumoAuthAgent()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET
if not agent.authenticate():
    raise SystemExit("agent authentication failed")


def wire_money(vendor: str, amount: int, invoice: str) -> str:
    try:
        result = require_approval(
            agent,
            task_id=f"wire-{invoice}",
            reason=f"Wire ${amount:,} to {vendor} for invoice {invoice}",
            on_behalf_of=os.environ["APPROVER_EMAIL"],
            impact="high",
            meta={"action": "wire-transfer", "vendor": vendor, "amount": amount, "invoice": invoice},
            timeout_s=90,
        )
    except LumoAuthApprovalNotDeliveredError as exc:
        # exc.reason is "email_fallback_sent" or "no_enrolled_device". Nobody approved.
        return f"Not sent: the approver has no enrolled phone ({exc.reason})."

    if result.status != "approved":
        # "denied", "expired", or "pending" when the timeout passed first.
        return f"Not sent: {result.status}."
    return f"Wired ${amount:,} to {vendor}."  # call the payment API here
```

TypeScript:

```ts
import { LumoAgent, LumoAuthApprovalNotDeliveredError } from '@lumoauth/agent';

const agent = new LumoAgent(); // reads the same four environment variables; signs in on first use

export async function wireMoney(vendor: string, amount: number, invoice: string): Promise<string> {
  try {
    const approval = await agent.approvals.require({
      taskId: `wire-${invoice}`,
      reason: `Wire $${amount} to ${vendor} for invoice ${invoice}`,
      onBehalfOf: process.env.APPROVER_EMAIL!,
      impact: 'high',
      meta: { action: 'wire-transfer', vendor, amount, invoice },
      timeoutMs: 90_000,
    });
    if (approval.status !== 'approved') {
      return `Not sent: ${approval.status}.`; // 'denied' | 'expired' | 'pending'
    }
  } catch (error) {
    if (error instanceof LumoAuthApprovalNotDeliveredError) {
      return `Not sent: the approver has no enrolled phone (${error.reason}).`;
    }
    throw error;
  }
  return `Wired $${amount} to ${vendor}.`; // call the payment API here
}
```

Rules for both languages:

- Only `approved` allows the action. Treat every other status, and every exception, as "do not run".
- In Python, TypeScript and PHP the helper **returns** `denied`, `expired` and `pending`; it does not raise for them. In Go, Java and .NET the helper raises or returns an error for them. See `references/other-languages.md`.
- An HTTP error from LumoAuth (for example `403` or `429`) is an exception: `requests.HTTPError` from Python's `require_approval(agent, ...)`, a `LumoAuthApiError` subclass from Python's `agent.approvals.require(...)` (same keyword arguments) and from TypeScript. The error code is in the response body's `error` field.
- `impact` is `low`, `medium` (default), `high` or `critical`. It sets how the prompt looks on the phone.
- `reason` is the text that the approver reads (480 characters at most). `task_id` is 128 characters at most. Build both from the arguments that the tool will really use, so the approver sees what will run.
- The result is a decision, not a credential. `result.token` identifies the approval request for status calls. When the protected API needs a token that proves the approval, use JIT permissions (step 3).
- The call must use the agent's full credential. A token that the agent narrowed with `scope`, a portal test token, and an organization API key (`lmk_...`) are refused with `403`.

### 3. JIT permissions: request one exact permission, get a short-lived token

The flow is: create a task, request a permission with `authorization_details`, wait for the decision, exchange the approval for a JIT token, call the API, complete the task. Completing the task revokes every JIT token of that task.

Python (`JITContext` completes the task when the `with` block ends):

```python
from lumoauth import JITContext, LumoAuthAgent

agent = LumoAuthAgent()
if not agent.authenticate():
    raise SystemExit("agent authentication failed")

with JITContext(agent) as jit:
    jit.create_task(name="Close ticket 4812", task_type="support")

    result = jit.request_permission(
        {
            "type": "api_call",
            "actions": ["DELETE"],
            "identifier": "https://api.example.com/v1/tickets/4812",
        },
        justification="The customer asked to delete ticket 4812",
        ttl=300,            # seconds; the server allows 60 to 900
        poll_timeout=300,   # how long to wait for a human decision
    )

    if result["status"] == "approved":
        jit_token = jit.get_token(result["request_id"])
        response = jit.call(jit_token, "DELETE", "https://api.example.com/v1/tickets/4812")
        print(response.status_code)
    elif result["status"] == "pending":
        print("No decision before the timeout. Do not run the action.")
    else:
        # "denied", "expired". agent_message is the only reviewer text that reaches the agent.
        print("Refused:", result.get("agent_message") or "no message for the agent")
```

TypeScript (`agent.jit` keeps the current task; complete it in `finally`):

```ts
import { LumoAgent } from '@lumoauth/agent';

const agent = new LumoAgent();

export async function deleteTicket(ticketId: string): Promise<number | null> {
  const url = `https://api.example.com/v1/tickets/${ticketId}`;
  await agent.jit.createTask({ name: `Close ticket ${ticketId}`, type: 'support' });
  try {
    const result = await agent.jit.requestPermission(
      { type: 'api_call', actions: ['DELETE'], identifier: url },
      {
        justification: `The customer asked to delete ticket ${ticketId}`,
        ttl: 300,
        pollTimeoutMs: 300_000,
      },
    );
    if (result.status !== 'approved') {
      return null; // 'pending' (timeout), 'denied' or 'expired': do not run the action
    }
    const jitToken = await agent.jit.getToken(result.request_id);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jitToken}` },
    });
    return response.status;
  } finally {
    await agent.jit.completeTask(); // revokes the JIT tokens of this task
  }
}
```

What to expect:

- A low-risk request comes back `approved` at once. A risky request comes back `pending` and the helper polls. A request that an authorization policy explicitly denies comes back `denied` at once and is not sent to a reviewer.
- The types `payment`, `user_data`, `credentials` and `admin_action` always need a human. So does a request outside the agent's registered capabilities, a request that carries `privileges`, and a request on a task whose `on_behalf_of` user was only named by the agent.
- `authorization_details` needs a `type`. `type` and `identifier` are strings; `actions`, `locations`, `datatypes` and `privileges` are lists of strings. Request the narrowest object that fits the operation.
- Exchange an approval for its token soon after the decision. A late exchange gets `403 request_not_redeemable`; request the permission again.
- One approval yields one token. The token expires no later than its task.
- Keep using the agent credential for JIT calls. A JIT token can only read the status of, and complete, its own task.

The API that receives the JIT token must validate it. Verify the signature with the organization's signing keys and check `iss` and `exp` (see `lumoauth-api-protection`). Then require `jit` to be `true` and compare `permissions.authorization_details` with the operation that was requested. A JIT token's `aud` is the organization slug, not the API's URL. When the agent acts for a user, `sub` is the user and `permissions.act.sub` is `agent_<agentId>`.

### 4. Give people the right to review

Show the user these portal steps; do not change roles without their confirmation.

1. Open **Access control → Roles & permissions** and create a role such as `Agent reviewer`.
2. Grant it only `jit.approve`: in the permission matrix, set **Agent approvals** in the *AI agents* group to **Full**.
3. Assign the role to people who do not own the agents that they will review.

Reviewers decide in **AI Agents → Approvals** (`/orgs/{orgId}/portal/approvals`), in the phone app, or in an approval channel. Read `references/reviewers-and-policies.md` for the review rules, auto-approve rules and the inbox.

## Verify

1. Run the push approval code with the approver's phone at hand. The phone shows the agent's name, the `reason`, the impact and each `meta` field. Tap **Approve**: the helper returns `approved`. Run it again and tap **Deny**: the helper returns `denied` and the action does not run.
2. Run the JIT code with a risky request. The request appears on the *Waiting* tab of `/orgs/acme-corp/portal/approvals`. Approve it as a user who is not the agent's owner. The code receives a token and the API call succeeds.
3. Deny a second risky request. The code must not call the API, and the status carries `agent_message` only when the reviewer wrote one for the agent.
4. Open the audit log and look for `agent.approval.requested` (push approval), or `jit.permission_requested`, `jit.permission_approved` and `jit.token_issued` (JIT).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `LumoAuthApprovalNotDeliveredError`, reason `email_fallback_sent` or `no_enrolled_device` | The approver has no enrolled phone, or the address is not a user of the organization. The server gives the same answer for both | Ask the approver to enroll the app. Check `on_behalf_of`. Never treat this as approval |
| `403 delegation_not_permitted` (push) or `403 access_denied` on a task with `on_behalf_of` | **May act on behalf of users** is off | Turn it on for the agent in the portal |
| `403 insufficient_scope` | The agent token was requested with a `scope` that covers only part of its capabilities | Authenticate without `scope`, or with a scope that covers the request |
| `403 agent_token_required` | The call used an organization API key or a user token | Use the agent's own credential |
| `403 test_token_not_accepted` | A portal test token was used | Use the agent's real credential |
| Helper returns `pending` | The timeout passed before anyone answered | Do not run the action. Tell the user, and request again later |
| JIT request stays `pending`, nobody is alerted | No user other than the agent's owner holds `jit.approve`, or the channel filters exclude the request | Add a second reviewer; check `/orgs/{orgId}/portal/approvals` |
| Reviewer gets "owner cannot approve" | The reviewer created the agent | A second person with `jit.approve` must decide. No setting relaxes this |
| `403 request_not_redeemable` on the token call | The approval was exchanged too late, the task ended, or the agent was suspended | Create a new request |
| `401 invalid_token` or `403 jit_principal_not_allowed` on a JIT call | A JIT token was used as the agent credential | Use the agent credential for task, request and token calls |
| `429` with `Agent budget exceeded` | The agent's budget policy is spent | See budgets in `lumoauth-agent-identity` |
| `429 rate_limited` on push approval | Too many prompts for one agent and user | Back off. Do not retry in a loop: repeated prompts train people to approve without reading |

## Related skills

- `lumoauth-agent-identity`: register the agent, capabilities, budgets, the Ask API.
- `lumoauth-agent-frameworks`: the same gates inside LangGraph, CrewAI, OpenAI Agents SDK, Agno, Google ADK and Microsoft Agent Framework.
- `lumoauth-agent-delegation`: obtain a delegation token so a JIT task acts for a user who already consented.
- `lumoauth-integrations`: set up Slack, Microsoft Teams, ServiceNow and Jira approval channels.
- `lumoauth-agent-governance`: suspend an agent, which also revokes its pending and approved JIT requests.
- `lumoauth-webhooks`: receive `jit.approval_required` and the decision events.

## References

- [Go, PHP, .NET and Java](references/other-languages.md): open it when the agent is not written in Python or TypeScript.
- [HTTP API](references/http-api.md): open it for raw endpoints, request and response fields, error codes, the `Insufficient-Authorization-Details` signal and the reviewer endpoints.
- [Async authorization (agent CIBA)](references/async-authorization.md): open it when the agent needs a named user's authorization and a token, and the user is not present.
- [Reviewers, auto-approve rules and the inbox](references/reviewers-and-policies.md): open it to set up reviewers, reduce approval fatigue or explain why a request needs a human.
- https://docs.lumoauth.dev/agents/push-approval
- https://docs.lumoauth.dev/agents/jit
- https://docs.lumoauth.dev/agents/async-authorization
- https://docs.lumoauth.dev/agents/mobile-approvals
- https://docs.lumoauth.dev/integrations/approval-channels
