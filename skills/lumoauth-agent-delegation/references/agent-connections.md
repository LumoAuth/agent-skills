# Agent connections (the token vault)

An agent often needs a user's account at another service: Google, Slack, GitHub, Salesforce and
others. With a connection, LumoAuth keeps the long-lived credentials (refresh tokens, the OAuth
client secret) and gives the agent a short-lived access token when it asks. The agent never holds
a refresh token.

Use a connection when the token comes from a **third-party** provider. For an API that trusts
LumoAuth tokens, use the token exchange in `SKILL.md`.

Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Terms

- **Connection**: one configured provider in the organization, with the OAuth client ID and secret
  of the app that the organization registered at the provider, the scopes, and the list of agents
  that may use it.
- **Grant**: one linked credential. In a **user-delegated** connection each user links their own
  account, and the agent acts for that user. In a **machine** connection one service credential
  belongs to the connection itself.

## Setup that an admin does in the portal

Tell the user to do this; show them the values that they need.

1. **AI Agents → Agents → Connections** (`/orgs/{orgId}/portal/connections`), **Add connection**.
2. Enter a **Connection name** and pick a **Provider template**, or **Custom OAuth 2.0 provider**
   with the authorization and token endpoints.
3. Under **Whose account is used**, choose **User-delegated** or **Machine**.
4. Paste the **Client ID** and **Client secret** of the OAuth app at the provider.
5. Choose **Scopes** (empty = the template's defaults).
6. Under **Agent access**, name the agents that may use the connection (**Only selected agents**
   is the default).
7. Register the **Callback URL** that the connection's detail page shows in the provider's OAuth
   app settings. For a machine connection, click **Establish machine credential**.

Built-in templates: Google, Google Calendar, Gmail, Microsoft Graph, Slack, Atlassian, Notion,
Linear, GitHub, Asana, Airtable, Zoom, Salesforce, HubSpot, Zendesk, Shopify, Box, Dropbox, Stripe
Connect, and custom providers.

## What each user does

Under **My account → Accounts agents can use** (`/account/connections`), the user ticks the agents
that may use the account, clicks **Link account** and approves at the provider. The user can change
the allowed agents later, or **Unlink**, which revokes the grant at once.

A linked account is usable only by the agents that its owner ticked. A grant with no allowed agent
is usable by nobody.

## What the agent needs

- Its own access token, with all of its capabilities (not narrowed with `scope`), or its `agk_`
  key.
- For a user-delegated connection: **May act on behalf of users** switched on, the agent on the
  connection's allowed list, and the user's own tick for this agent.

## List the connections

`GET /orgs/{orgId}/api/v1/agents/me/connections`

```json
{
  "connections": [
    {
      "connection_id": "conn_1f3a9c2b7d8e4a5f6b0c1d2e",
      "name": "Google Workspace",
      "provider": "google",
      "provider_label": "Google",
      "grant_mode": "authorization_code",
      "scopes": ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
      "user_delegated": true,
      "machine_grant_status": null,
      "linked_users": 12
    }
  ]
}
```

The list holds only the connections that this agent may use.

## Get an access token

`POST /orgs/{orgId}/api/v1/agents/me/connections/{connectionId}/token`

Body for a user-delegated connection: `{"user_id": "<the user's ID or e-mail address>"}`. For a
machine connection, send no body.

```json
{
  "access_token": "ya29.a0Af...",
  "token_type": "Bearer",
  "expires_at": "2026-07-01T13:45:00+00:00",
  "scopes": ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"]
}
```

LumoAuth refreshes the provider token before it answers when the token is close to expiry.

The SDKs have no helper for these two endpoints. Call them with the agent's token.

Python:

```python
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET
agent.authenticate()


def provider_token(connection_id: str, user_id: str) -> str:
    """Return a short-lived provider access token for this user. Do not store or log it."""
    response = agent.api_request(
        "POST",
        f"/orgs/{agent.org_id}/api/v1/agents/me/connections/{connection_id}/token",
        data={"user_id": user_id},
    )
    if response.status_code == 503:
        raise RuntimeError(f"Refresh in progress, retry after {response.headers.get('Retry-After', '2')} s")
    if response.status_code != 200:
        raise RuntimeError(f"Connection token refused: {response.status_code} {response.json().get('error')}")
    return response.json()["access_token"]
```

TypeScript:

```ts
import { LumoAgent } from '@lumoauth/agent';

const agent = new LumoAgent(); // reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET

/** Returns a short-lived provider access token for this user. Do not store or log it. */
export async function providerToken(connectionId: string, userId: string): Promise<string> {
  const url = `${agent.baseUrl}/orgs/${agent.orgId}/api/v1/agents/me/connections/${encodeURIComponent(connectionId)}/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await agent.getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Connection token refused: ${res.status} ${body.error ?? ''}`);
  }
  return body.access_token;
}
```

The TypeScript example sends a bearer token. An agent that was created with a `dpop` signer has a
DPoP-bound token: send the request with `fetchWithDpop` from `@lumoauth/agent` instead.

Use the provider token at once, for the user that it belongs to, and let it go. Ask LumoAuth again
for the next task; do not cache it past `expires_at`.

## Errors

| Error | Status | Meaning | What to do |
|---|---|---|---|
| `delegation_not_permitted` | 403 | The agent lacks **May act on behalf of users** | An admin switches it on |
| `delegation_not_allowed` | 403 | The user did not allow this agent on their grant, or the user is deactivated or blocked | Ask the user to tick the agent under **Accounts agents can use** |
| `agent_not_allowed` | 403 | The connection's agent list excludes this agent | An admin adds the agent to the connection |
| `insufficient_scope` | 403 | The agent's token was narrowed with `scope` | Use a token with all capabilities, or the `agk_` key |
| `grant_not_found` | 404 | The user has not linked this connection. An unknown user gets the same answer | Ask the user to link the account |
| `connection_not_found` | 404 | No connection has this ID | Read the ID from the list endpoint |
| `grant_revoked`, `grant_expired`, `refresh_failed` | 409 | The stored credential can no longer be used | The user links the account again |
| `refresh_in_progress` | 503 | Another request is refreshing the same grant | Retry after the `Retry-After` header |
| `rate_limited` | 429 | More than 60 token requests per minute for this agent | Slow down |
| `budget_exceeded` | 429 | The agent's budget is spent. A token request counts as one call | See budgets in `lumoauth-agent-identity` |

Every issued token is written to the audit log as `vault.token_issued` (agent, connection, user,
scopes; never the token). A refused user-delegated request is `vault.delegated_token_denied`.

## Rules to keep

- Never ask a user to paste a provider token or password into the agent. Send them to **Accounts
  agents can use**.
- Never log the provider token. It is the user's access to the provider.
- Treat `user_id` as input that you must trust: take it from the verified user session or from the
  `sub` of a verified token, never from model output or from the prompt.
- A user who unlinks, or an admin who revokes the grant or the agent, cuts access at LumoAuth at
  once. A provider token that the agent already holds stays valid at the provider until it
  expires, so hold it only as long as the task needs.

Docs: https://docs.lumoauth.dev/agents/token-vault
