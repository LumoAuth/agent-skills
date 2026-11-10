# Risk level, security posture and conditional access for agents

Open this file to read what the agent list shows about risk, to decide what to fix first, or to write and debug access rules.

LumoAuth shows two separate views of each agent:

| View | What it is | Where |
|---|---|---|
| Security posture | A checklist of how the agent is configured. Computed from the stored settings; nothing is sampled | Agent list (**Needs attention** filter) and the *Overview* section of the agent page |
| Risk level | `low`, `medium` or `high`, computed from registry signals about the agent over time | A badge on the agent list, a "why this score" breakdown on the agent page, `riskLevel` in the Admin API |

Agent risk is separate from the risk engine for user sign-ins. It uses no request context and no AI calls.

## Risk level

The level rises with these signals:

| Signal | What to do |
|---|---|
| The API key or client secret was not rotated for a long time | Rotate it: `lumo agents rotate-credentials {agentId}` |
| A workload agent has no recent successful attestation | Check that the workload still runs and attests (see `lumoauth-agent-identity`) |
| A high share of the agent's recent authorization decisions were denials | The agent asks for things that it may not do. Check its capabilities and its prompts or tools |
| The agent was not used for a long time | Revoke it if it is no longer needed |
| A budget window is spent | Review the budget or the agent's usage |
| The agent is suspended, inactive or revoked | Such agents show the highest level by definition |

The exact scoring is on https://docs.lumoauth.dev/agents/governance#risk-scoring. Do not hard-code it; read `riskLevel`.

Use the level in two ways: sort the inventory by it for review, and cap it in an access rule (*Risk level must be at most*).

## Security posture checklist

Each line on the agent page says why it matters and links to the page that fixes it.

| Check | Needs attention when | Usual fix |
|---|---|---|
| Identity type | The agent uses an API key or the custom type, so nothing attests where it runs. A client secret is shown for information | Move to workload federation or a private key (`lumoauth-agent-identity`) |
| Workload binding | A workload agent has no binding, accepts a generic platform audience, accepts any Git ref, or binds a whole cloud directory | Narrow the binding |
| Public keys | A private key JWT agent has no public key registered, so it cannot sign in | Register the key |
| Attestation | The agent never attested, or its last attestation is old | Check the workload |
| Credentials | The API key has no expiry, expires soon or has expired; a shared secret is old | Set an expiry; rotate |
| Capabilities | None (the agent is refused everywhere), a bare `*`, or a `resource.*` wildcard | Grant the exact capabilities that the tools need |
| Budget | No daily limit, step cap or timeout | Set a budget |
| Acting for people | *May act on behalf of users* is on without a consent step for the user | Use delegation with consent (`lumoauth-agent-delegation`) or turn the setting off |
| Access rule | No enabled access rule applies to the agent | Create a rule (below) |
| Auto-approve rules | A rule for this agent uses a wide action pattern | Narrow the rule (`lumoauth-agent-approvals`) |
| Agent card | A published card lists skills (information only) | Review what is public |
| Status | Suspended or inactive | Reactivate or revoke |

A review order that works: agents with a bare `*` capability, agents with keys that never expire, agents that may act for users, agents without an access rule, then unused agents.

## Access rules (conditional access)

Portal: **AI Agents → Agent rules → Access rules**, `/orgs/{orgId}/portal/agents/policies`. Viewing needs `agents.view`. Creating, editing, enabling, disabling and deleting need `agents.edit`. Rules are managed in the portal.

### Conditions

| Form label | Key in the audit log | Meaning | Deny `reason` |
|---|---|---|---|
| *Must have attested within (hours)* | `require_recent_attestation_hours` | The last successful workload attestation is at most N hours old. An agent that never attested is denied | `attestation_missing`, `attestation_stale` |
| *Risk level must be at most* | `max_risk_level` (`low`, `medium`, `high`) | The agent's risk level does not pass the ceiling | `risk_level_exceeded` |
| *Must connect from these IP ranges* | `allowed_ip_cidrs` | The client IP matches one CIDR or IP. A request whose IP cannot be determined is denied | `ip_not_allowed`, `ip_unknown` |
| *Must have been used in the last (days)* | `deny_dormant_days` | The agent was used within N days | `agent_dormant` |

A rule applies to *All agents* or to *Selected agents only*. Empty conditions are ignored; at least one is required.

### How rules are evaluated

- No rule in the organization: nothing changes.
- Rules exist: the first failing condition of any enabled rule that applies to the agent denies it.
- A rule exists but cannot be evaluated: the agent is denied with the reason `policy_evaluation_error`.

### Where rules are enforced

1. When an agent's access token or key is presented to LumoAuth's API.
2. At workload attestation, before a LumoAuth token is issued.
3. At the token endpoint, on every grant that an agent makes: client credentials, token exchange, on-behalf-of exchange and CIBA redemption. A denial answers `403` with `"error": "access_denied"`; the description names the reason.
4. At agent-initiated CIBA (`bc-authorize`), which answers a denied agent with `401 invalid_client`.

Token introspection answers `active: false` for an agent's token while a rule denies the agent. Introspection applies every condition except the IP ranges, because the caller is the resource server and not the agent.

On the API and at attestation a denial looks like this, and it writes an `agent.access_policy_denied` audit event that names the rule:

```json
{
  "error": "access_policy_denied",
  "error_description": "The agent was denied by a conditional access policy.",
  "reason": "risk_level_exceeded"
}
```

A token for another resource server (for example an MCP server) is validated by that server. Rules stop the agent from obtaining such a token; they do not reach a token that was already issued. Use short lifetimes or introspection there.

### Creating a rule without an outage

1. Click **Create rule**. Choose *Selected agents only* and one agent that you can test with.
2. Fill in the conditions. For IP ranges, list every egress address of the agent's runtime, one CIDR or IP on each line.
3. Read **Preview impact**. It runs the rule against the active agents and names those that it would deny today, with the reason. IP ranges are not part of the preview, because the portal has no client IP to test with.
4. Click **Create rule**. The rule is enabled at once and applies to the next authentication.
5. Run the test agent. Check for `access_policy_denied` in its logs and in the audit log.
6. Edit the rule (**Edit…** in its actions menu) and widen it to more agents or to *All agents*.

When at least one rule exists, a notice at the top of the page names every active agent that no enabled rule covers, with a **Create a rule for them** shortcut.

Rule edits are audited as `agent.access_policy_updated` with the values before and after.

### Suggested starting rules

| Agent kind | Rule |
|---|---|
| Workload agents in your cloud | *Must have attested within (hours)* with a value that fits how often the workload attests |
| Agents with a client secret or API key that run in a known network | *Must connect from these IP ranges* |
| All agents | *Risk level must be at most* `medium`, after you have cleared the current high-risk agents |
| All agents | *Must have been used in the last (days)*, so a forgotten credential stops working |

Confirm each value with the user. A rule that is too strict denies production agents at their next authentication.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Agents fail with `access_policy_denied` right after a rule was created | The rule applies to them and a condition fails | Read `reason` and the `agent.access_policy_denied` audit event. **Disable** the rule from its actions menu to recover, then fix it |
| `reason: ip_unknown` | LumoAuth could not determine the client IP of the request | Check how the agent reaches LumoAuth; remove the IP condition for that agent until it is resolved |
| `reason: attestation_missing` for an agent with a client secret | The attestation condition applies to an agent that never attests | Scope that rule to workload agents only |
| `reason: risk_level_exceeded` | The agent's risk level passed the ceiling | Open the agent page and fix what the breakdown names |
| `policy_evaluation_error` | The rule could not be evaluated, for example a malformed CIDR | Fix or disable the rule |
| Nothing changed after creating a rule | The rule is disabled, or it targets a list that does not include the tested agent | Check the status and the scope |
| The **Create rule** button is missing | The user holds `agents.view` but not `agents.edit` | Grant `agents.edit` through a role |

```bash
lumo logs list --action agent.access_policy_denied --limit 20 --output json
```
