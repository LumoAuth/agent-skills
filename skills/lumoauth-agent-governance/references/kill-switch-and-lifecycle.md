# Kill switch and agent lifecycle

Open this file before you stop, delete or reactivate an agent, when you explain what a suspension revokes, or when an agent was deactivated for dormancy.

## Statuses

| Status | Meaning | Can move to |
|---|---|---|
| `active` | The agent can authenticate | `inactive`, `suspended`, `revoked` |
| `suspended` | Stopped by an admin or by an inbound security signal | `active`, `inactive`, `revoked` |
| `inactive` | Taken out of service by an admin or by the dormancy job | `active`, `suspended`, `revoked` |
| `revoked` | Retired. Final | nothing |

An invalid transition, such as reactivating a revoked agent, returns `400`.

## Actions

Paths are under `{base}/orgs/{orgId}/api/v1/admin`. `lumo api` resolves a path such as `/agents/...` against that base.

| Action | Admin API | CLI | Portal (row menu **⋯** on **AI Agents → Agents**) |
|---|---|---|---|
| Suspend | `POST /agents/{agentId}/disable` | `lumo api POST /agents/{agentId}/disable` | not offered |
| Deactivate | `POST /agents/{agentId}/deactivate` | `lumo agents disable {agentId}` | not offered |
| Revoke | `PATCH /agents/{agentId}` with `{"status": "revoked"}` | `lumo api PATCH /agents/{agentId} --data '{"status":"revoked"}'` | **Revoke** |
| Reactivate | `POST /agents/{agentId}/enable` or `POST /agents/{agentId}/activate` | `lumo agents enable {agentId}` | **Reactivate** (suspended or inactive agents) |
| Delete | `DELETE /agents/{agentId}` | `lumo agents delete {agentId}` | **Delete** |
| Rotate the credential | `POST /agents/{agentId}/rotate-credentials` | `lumo agents rotate-credentials {agentId}` | **Rotate API key** / **Rotate client secret** in the **Credentials** section of the edit page |
| Revoke the API key only | `POST /agents/{agentId}/revoke-key` | `lumo api POST /agents/{agentId}/revoke-key` | |

Permissions: the status and credential actions need `agents.edit` (API key scope `admin:agents:write`). Delete needs `agents.delete`. Reading needs `agents.view` (`admin:agents:read`).

`{agentId}` is the public id (`agt_...`). `lumo agents` also answers to `lumo agent`.

Show the user the exact command and the agent's name before you run any of these. Ask for confirmation again before a revoke or a delete: neither can be undone.

## What the kill switch revokes

Every move out of `active` (to `suspended`, `inactive` or `revoked`, from the portal, the Admin API, the CLI, the dormancy job or an inbound security signal) runs the same revocation in the same step as the status change:

| What | Effect |
|---|---|
| AAuth agent, auth and refresh tokens of the linked AAuth registration | Marked revoked. The AAuth registration moves to `suspended` or `revoked` to match, so the AAuth token endpoint stops issuing |
| Pending JIT requests and approved requests that were not yet exchanged | Moved to `revoked`. A late approval by a person yields no token |
| Issued JIT tokens and active JIT tasks | Permissions revoked, the token id denied at once, tasks suspended |
| Token vault grants (third-party credentials that LumoAuth holds for the agent) | Revoked. The stored refresh token is wiped. When the provider has a revocation endpoint, LumoAuth calls it on a best-effort basis |
| OAuth access and refresh tokens issued to the agent | Marked revoked |
| Live agent access tokens (client credentials, workload and on-behalf-of exchange, attestation, admin mint) | Each token id is put on a deny list, so LumoAuth's own API and introspection refuse the token before `exp` |
| Keys at connected AI gateways | Revoked at the gateway in the background |
| Receivers of shared signals | A CAEP `session-revoked` event is sent on every configured stream |

The revocation is audited as `agent.credentials_revoked` with a count for each category. Running it again on an agent that is already stopped changes nothing.

From the moment of the change, LumoAuth refuses the agent's `agk_` keys and JWTs on every request, and introspection answers `active: false` for its tokens.

### The limit: offline verification

An API or MCP server that verifies an agent JWT only against the JWKS does not learn about the suspension. It accepts the token until `exp`. Choose at least one of these for each such API:

- Keep agent token lifetimes short.
- Introspect the token for operations that matter (`lumoauth-api-protection`).
- Subscribe to the CAEP `session-revoked` event and drop the agent's sessions when it arrives (see the shared signals reference of this skill).

Tell the user which of their APIs verify offline when you report that an agent "is stopped".

## Reactivation

Moving a suspended or inactive agent back to `active` changes the status and moves the linked AAuth registration back. Nothing else returns: every token, grant, approval and gateway key that the stop revoked stays revoked. The agent requests new tokens; users reconnect token vault connections.

A revoked agent cannot be reactivated on any surface. Register a new agent.

## Changing capabilities

When an agent loses a capability, its live tokens are revoked in the same way, because a token keeps the scope that it was issued with. Adding a capability revokes nothing. Plan a capability reduction like a short interruption: the agent must authenticate again.

## Deleting

Delete runs the revocation first (AI gateway keys are revoked before the delete returns), then removes the agent. The agent's fine-grained authorization tuples are removed in the same transaction: `permission:...#grantee@agent:<id>`, `mcp_tool:...#invoke@agent:<id>`, `mcp_server:...#invoke@agent:<id>` and every `agent:<id>` object. An agent that is registered later under the same id inherits nothing.

Prefer revoke over delete when the audit trail should keep showing the agent in the registry.

## Dormancy

A daily job moves an agent from `active` to `inactive` when it has had no activity for a long period. Activity is the agent's last use (an `agk_` authentication, an Ask API call, an MCP tool authorization, a token vault fetch) or a successful workload attestation. A newly registered agent is not flagged before the same period has passed since its creation. The current period is stated at https://docs.lumoauth.dev/agents/governance#dormancy-lifecycle.

- The move is a kill switch like any other: the agent's tokens are revoked.
- Each move is audited as `agent.deactivated_dormant`, and an `assurance-level-change` event is sent on shared signals streams.
- An admin reactivates the agent with **Reactivate** or `lumo agents enable {agentId}`.
- The access rule condition *Must have been used in the last (days)* reads the same last-use time, so an agent in regular use is never denied as dormant.

To turn automatic deactivation off for the organization, set `agent_governance.auto_deactivate_dormant` to `false` in the organization settings. Show the command first; it needs `settings.manage` (API key scope `admin:settings:write`):

```bash
lumo api PATCH /organization --data '{"settings":{"agent_governance":{"auto_deactivate_dormant":false}}}'
```

Leave it on unless the user has a reason: an unused credential is a liability.

## Inbound signals that stop an agent

When the organization receives shared signals from another system, some events stop agents without an admin acting:

- An event that names an agent (by its `agt_...` id or a linked AAuth identifier) and means "revoke" suspends that agent.
- A session revocation for a user suspends every agent that the user owns.

Reactivation stays a human decision. See the shared signals reference of this skill.

## Audit events

| Event | When |
|---|---|
| `agent.created` | Registration (capabilities, identity type, delegation flag, creator) |
| `agent.updated` | A change, with old and new values: capabilities, status, act on behalf of users, workload binding, API key expiry, budget |
| `agent.deleted` | Deletion through the Admin API, with the revocation counts |
| `aauth.agent_revoked`, `aauth.agent_deleted` | Revoke and delete from the portal |
| `agent.credentials_revoked` | The kill switch ran. Counts for each category |
| `agent.credentials_rotated`, `agent.key_rotated`, `agent.key_revoked` | Credential changes |
| `agent.deactivated_dormant` | The dormancy job deactivated the agent |
| `agent.token_issued` | An admin minted a token for the agent (carries the token id) |

Agent events carry the actor type `agent` where the agent acted. Query and export them with `lumoauth-audit-compliance`. The webhook events `agent.created`, `agent.updated` and `agent.revoked` are covered by `lumoauth-webhooks`.

## A stop procedure to follow

1. Identify the agent: `lumo agents list --search <name> --output json`. Confirm the `agentId` and name with the user.
2. Decide with the user: suspend (reversible) or revoke (final).
3. Show the command, then run it.
4. Confirm the status with `lumo agents get {agentId} --output json`.
5. Check `agent.credentials_revoked` in the audit log.
6. List the APIs that verify the agent's tokens offline and tell the user until when an issued token can still be accepted there.
7. When a credential leaked, rotate or replace it before any reactivation.
