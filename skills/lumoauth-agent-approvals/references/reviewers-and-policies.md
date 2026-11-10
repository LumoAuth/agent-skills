# Reviewers, auto-approve rules and the approvals inbox

Open this file to set up the people who decide, to explain why a request went to a person, or to reduce the number of prompts without removing the human step for risky actions.

"Approval" covers three item types in LumoAuth. Name the right one when you talk to the user.

| Item | Created by | Decided by | Where |
|---|---|---|---|
| JIT permission request (includes agent CIBA requests) | `POST /jit/request`, `JITContext`, `agent.jit`, `bc-authorize` | A reviewer with `jit.approve`; for an asserted delegation or a CIBA request, also the named user | Inbox, phone app, approval channels, reviewer API |
| Push action approval | `approvals.require` / `require_approval` | Only the user named in `on_behalf_of` | That user's phone |
| AAuth user consent | An AAuth agent's authorization request (see `lumoauth-aauth`) | The end user, in the agent's redirect | Shown in the inbox for information |

## Which JIT requests go to a person

LumoAuth assesses each request and gives it a risk level: `low`, `medium`, `high` or `critical`. The level is returned as `risk_level`.

| Request | Outcome |
|---|---|
| Low or medium risk, inside the agent's capabilities | Approved automatically and audited |
| High or critical risk (for example delete, admin, execute and transfer actions, or sensitive types) | Held for a reviewer |
| Type `payment`, `user_data`, `credentials` or `admin_action` | Always held for a reviewer, whatever the risk level |
| Outside the agent's registered capabilities | Always held for a reviewer |
| Carries `privileges` | Always held for a reviewer |
| Task acts for a user whom the agent only named (`delegation_consent_required: true`) | Always a human decision: the named user consents, or a reviewer overrides |
| An ABAC policy explicitly denies it | Denied at once. Not sent to a reviewer |
| An ABAC policy or relationship explicitly allows it | Lowers the assessed risk. Never moves a critical type past human review |

Capability matching: LumoAuth turns each requested action into `type.action` (for example `invoices.approve`). A capability `invoices.approve` or `invoices.*` covers it. A request with no action is checked as the bare type (`invoices`), which `invoices.*` does not cover. Names compare without regard to case, `:` and `-`.

To make a routine request pass without a prompt, give the agent the matching capability (see `lumoauth-agent-identity`) or write an authorization policy (see `lumoauth-abac`), and keep the action out of the critical types.

## Who can review

The same rules apply in the inbox, the phone app, the approval channels and the reviewer API.

| Rule | Meaning |
|---|---|
| A human | Agent tokens, `agk_` keys, JIT tokens and delegated tokens cannot approve. Organization API keys cannot hold `jit:approve` |
| Holds `jit.approve` | A seeded system permission. Organization admins hold it. Other users need a role that grants it |
| Same organization | A user of another organization is refused |
| Not the agent's owner | The user who created the agent can never approve or deny that agent's requests. A second person is needed. Short-lived sandbox organizations are the only exemption |
| Not the on-behalf-of user | The user that the task acts for cannot approve their own request, except as the consent step of an asserted delegation |
| Request not expired | A request past `expires_at` cannot be approved |
| Allowed to use the agent | When the agent is limited to certain customer organizations, the reviewer must be allowed to use it |

### Create a reviewer role

1. Open **Access control → Roles & permissions** in the portal.
2. Create a role, for example `Agent reviewer`.
3. In the permission matrix, find **Agent approvals** in the *AI agents* group and set it to **Full**. This grants `jit.approve` and nothing else.
4. Assign the role to the reviewers. Choose people who do not own the agents that they will review.

Do not hand out admin rights for reviewing. Role management in general belongs to `lumoauth-rbac`.

## The approvals inbox

**AI Agents → Approvals**, `/orgs/{orgId}/portal/approvals`.

- Status tabs: *Waiting*, *Approved*, *Denied*, *All permission requests*.
- Type filters: *Everything*, *Permission requests*, *User consents*, *Action approvals*. Each shows a count of waiting items.
- On the *Waiting* tab, select several requests (or **Select all**), type an optional reason, and click **Approve selected** or **Deny selected**. Each request is checked on its own, so part of a batch can be skipped. The summary says how many were processed and how many were skipped.
- The row menu (**…**) of a pending request has **Approve**, **Create auto-approve rule…** and **Deny**.
- The page updates while it is open.

Push action approvals are answered on the named user's phone; other admins see them for information. AAuth user consents are for information only.

What a reviewer writes:

- **Notes** and a denial **reason** stay inside the organization (audit log, inbox). The agent only learns that notes exist (`has_notes`).
- **Message for the agent** (`agent_message`, 500 characters at most) is the only free text that reaches the agent.

Text that an agent supplies (task names, justifications, reasons) is cleaned before a reviewer sees it. Reviewers should still decide on the structured fields: agent, type, actions, identifier, risk level.

## Auto-approve rules (approval policies)

An auto-approve rule approves a narrow class of low or medium risk requests that would otherwise alert a person. Manage rules under **AI Agents → Agent rules → Auto-approve rules** (`/orgs/{orgId}/portal/agents/rules/auto-approve`), or use **Create auto-approve rule…** on a pending request, which fills in the form from that request.

The dialog asks for:

| Field | Values |
|---|---|
| Agent | One agent, or *Any agent in this organization* (needs an explicit confirmation) |
| Authorization type | The `authorization_details.type` to match |
| Actions the rule may approve | Comma-separated. Exact names or `prefix*`. Add `@type` to cover requests that name no action |
| Max risk level | Low or Medium |
| Expires in | 1, 3 or 7 days |

Limits that no rule can pass:

- High and critical risk requests are never approved by a rule.
- The critical types `payment`, `user_data`, `credentials` and `admin_action` cannot have a rule.
- A bare `*` action pattern is refused.
- A request that names no action is approved only by a rule whose patterns include `@type`.
- Requests with `privileges`, requests outside the agent's capabilities, requests on an asserted delegation, and agent CIBA requests are never approved by a rule.
- The owner of an agent cannot create a rule for that agent. An organization-wide rule that an owner creates does not apply to that owner's agents.
- Every rule has an expiry of 7 days at most. An expired or revoked rule stops matching at once.

Each automatic approval by a rule is audited as `jit.permission_policy_approved` with the rule's id.

Tell the user to keep rules narrow: one agent, one type, exact actions, the shortest expiry that works.

## Approval on the phone

Reviewers who hold `jit.approve` and have enrolled the LumoAuth mobile app can list, inspect, approve and deny JIT requests there, one at a time or in a batch. Each decision is signed by the phone. Enrollment is under **My account → Sign-in & security → Add a sign-in method → LumoAuth app**. A custom approver app must follow the device contract at https://docs.lumoauth.dev/agents/mobile-approvals.

## Approval channels

A channel posts each request that needs a person to a place where reviewers already work, and takes the decision back:

| Channel | The request appears as | The decision comes back by |
|---|---|---|
| Slack | A message with **Approve** and **Deny** buttons | A signed interactivity callback |
| Microsoft Teams | An Adaptive Card | A Bot Framework invoke or an outgoing webhook |
| ServiceNow | A record in a table that you choose | A Business Rule that calls a callback URL with a bearer token |
| Jira Service Management | An issue in a project that you choose | An Automation rule that calls a callback URL with a bearer token |

Channels are configured under **Integrations → Approval channels** (`/orgs/{orgId}/portal/integrations/approval-channels`). Each channel can be limited to a minimum risk level, to certain agents and to a list of allowed reviewer emails. The reviewer rules above apply to every channel decision. Decisions are audited as `approval_channel.decision`; refused attempts as `approval_channel.decision_rejected`.

Setup of each channel (provider apps, callback URLs, secrets) belongs to `lumoauth-integrations`.

## Audit events

| Event | When |
|---|---|
| `jit.task_created` | A task was created |
| `jit.permission_requested` | A permission was requested |
| `jit.permission_auto_approved`, `jit.permission_policy_approved` | Approved without a person, by risk level or by a rule |
| `jit.hitl_triggered` | The request was sent to reviewers |
| `jit.permission_approved`, `jit.permission_denied` | A person decided |
| `jit.delegation_consented`, `jit.delegation_consent_refused`, `jit.delegation_approved_by_reviewer` | Consent step of an asserted delegation |
| `jit.token_issued`, `jit.token_issuance_refused` | Token exchange succeeded or was refused |
| `jit.requests_retired`, `jit.permission_revoked` | Task completion or suspension retired requests or revoked a permission |
| `agent.approval.requested`, `agent.approval.email_fallback` | Push action approval was sent, or fell back to an email notice |

Use `lumoauth-audit-compliance` to query and export audit logs.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `403 insufficient_permissions` when approving | The user lacks `jit.approve` or belongs to another organization | Grant the reviewer role |
| "The owner cannot approve" | The reviewer created the agent | Ask a second reviewer |
| "The owner of an agent cannot create an auto-approval policy" | Same separation of duties | Another user with `jit.approve` creates the rule |
| A `payment` request never passes automatically | Critical types always need a person | By design. Keep the reviewer step |
| A rule exists but the request still waits | The request names no action and the rule lacks `@type`, the risk is high, the request is outside the agent's capabilities, or the rule expired | Check the request against the limits above |
| Nothing is posted to Slack or Teams | The request's risk is below the channel's minimum, or the agent filter excludes the agent | Check the channel's filters and its failure count |
| The user consented but the request is still pending | The request also needs review for another reason (critical type, outside capabilities, high risk) | A reviewer with `jit.approve` must decide |
