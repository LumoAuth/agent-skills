# Approval channels

Some AI agent requests need a human decision, for example a high-risk just-in-time (JIT) permission request. LumoAuth already notifies reviewers through the approvals inbox, push notifications and email. An approval channel adds a place where reviewers already work.

- Page: `/orgs/{orgId}/portal/integrations/approval-channels` (**Integrations → Approval channels**)
- Permission: `settings.manage`
- API and CLI: none for the channel configuration. Portal only.
- The approval flow itself (how an agent asks, how the app waits for the decision) belongs to `lumoauth-agent-approvals`.

## Channels

| Channel | How the request appears | How the decision comes back |
|---|---|---|
| **Slack** | A message with **Approve** / **Deny** buttons | Slack interactivity callback, verified with the app's signing secret |
| **Microsoft Teams** | An Adaptive Card with action buttons | Bot Framework invoke, or an outgoing webhook with an HMAC |
| **ServiceNow** | A record in a table that the admin chooses | A Business Rule posts to a callback URL with a bearer token |
| **Jira Service Management** | An issue in a project that the admin chooses | An Automation rule posts to a callback URL with a bearer token |

Each channel can be limited to a **minimum risk level** and to specific **agent IDs**. Several channels of one type are allowed.

## Before the channel

1. Give the reviewers the `jit.approve` permission (organization admins hold it; for others create a role that grants only `jit.approve`).
2. A reviewer must not be the owner of the agent, and must not be the user that the agent acts for.

## Setup

1. Open the page. Under **Add a channel**, pick the type.
2. Follow the provider steps. The portal shows the same steps under the form, with the exact callback URL and a copy button.
3. Click **Add channel**. Credentials and callback tokens are shown once.
4. Trigger a high-risk request and decide it from the channel. The audit log then has `approval_channel.decision`.

Callback URLs have this shape (use the one that the portal shows):

```text
{base}/orgs/{orgId}/hooks/approvals/slack
{base}/orgs/{orgId}/hooks/approvals/teams
{base}/orgs/{orgId}/hooks/approvals/servicenow
{base}/orgs/{orgId}/hooks/approvals/jira
```

### Slack

1. Create a Slack app. Under **OAuth & Permissions** add the bot scopes `chat:write`, `users:read` and `users:read.email`. Install the app and copy the bot token (`xoxb-...`).
2. Under **Interactivity & Shortcuts**, enable interactivity and set the Request URL to the Slack callback URL.
3. Copy the **Signing Secret** from **Basic Information**.
4. Invite the bot to the channel and copy the channel ID.

The reviewer is the LumoAuth user whose email equals the email on the Slack profile.

### Microsoft Teams

Cards are posted through an incoming webhook (a Workflows "post to a channel when a webhook request is received" flow). Paste its URL. To let people decide from the card, choose one mode:

- **Bot Framework**: register an Azure Bot whose messaging endpoint is the Teams callback URL, and enter the bot's Microsoft App ID.
- **Outgoing webhook**: create an outgoing webhook in the team that points to the same URL, and enter its security token.

Without either, the card only links to the approvals inbox. The outcome is posted as a follow-up card.

### ServiceNow

LumoAuth creates one record per request in the chosen table. Authentication is an integration user (basic) or OAuth 2.0. When the channel is created, the portal shows a **callback token** once. Store it in ServiceNow and add a Business Rule that calls:

```http
POST {base}/orgs/{orgId}/hooks/approvals/servicenow
Authorization: Bearer <callback token>
Content-Type: application/json

{"request_id": "<correlation_id>", "decision": "approved", "actor_email": "<approver email>", "comment": "<optional>"}
```

`decision` is `approved` or `denied`. Responses: `200` on success, `403` when the actor is not permitted, `404` when the request is unknown, `409` when the request is no longer pending.

### Jira Service Management

LumoAuth creates an issue per request in the configured project and issue type, with the labels `lumoauth-approval` and `risk-<level>`. Authentication is an Atlassian account email and API token. Add an Automation rule (issue transitioned, label = `lumoauth-approval`, send web request) to the Jira callback URL with `Authorization: Bearer <callback token>` and the same JSON body as for ServiceNow.

## Allowed reviewers

For ServiceNow and Jira, the callback names the reviewer (`actor_email`); the ticketing system asserts it. Fill **Allowed reviewers** on the channel (one email per line) so that a leaked callback token can act only as those people. Slack and Teams channels honour the same list. Rotate a callback token with **Rotate callback token** on the channel page.

## Rules that always apply

- The reviewer must hold `jit.approve`.
- The agent's owner cannot decide requests of their own agent.
- The user that the agent acts for cannot approve the request.
- An expired request cannot be approved.
- Refused attempts are audited as `approval_channel.decision_rejected`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The reviewer clicks Approve and is refused | No `jit.approve`, or the reviewer owns the agent or is the user it acts for |
| ServiceNow or Jira callback returns `403` for a valid reviewer | `actor_email` matches no user of the organization, or **Allowed reviewers** excludes it |
| Callback returns `409` | The request was already decided, or it expired |
| Nothing is posted | The risk level is below the channel's minimum, or the agent ID filter excludes the agent |

## Reference

- https://docs.lumoauth.dev/integrations/approval-channels
