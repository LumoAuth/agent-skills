---
name: lumoauth-agent-delegation
description: >-
  Lets an AI agent act for a signed-in user with LumoAuth. Covers OAuth token exchange (RFC 8693)
  with a subject token (the user) and an actor token (the agent), the `act` claim and the chain of
  agency, the `resource` parameter that sets the delegated token's audience, delegation to
  sub-agents, the SDK helpers (`agent.delegation` in `@lumoauth/agent`, `DelegationChain` in
  Python, Go, .NET and Java, the PHP `delegation` namespace), what the downstream API must check,
  cross-app access with the identity assertion grant (ID-JAG, XAA, `jwt-bearer`), and agent
  connections (the token vault: LumoAuth keeps a user's Google, Slack, GitHub or other third-party
  OAuth tokens and gives the agent short-lived access tokens). Use when an agent should act on
  behalf of a user, call an API as the user, exchange a token, hand a user's identity to a
  sub-agent, read the actor chain, reach another app without a second consent screen, or use a
  user's connected account.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth agent delegation

Let an agent act for a user without handing it the user's credentials. The agent exchanges the
user's access token plus its own token for a delegated token. That token names both: the user in
`sub`, the agent in `act`. The API that receives it can see who acts and for whom.

## When to use

- An agent calls your API, or LumoAuth's API, for a signed-in user: **token exchange** (this file).
- An agent hands the task to another agent and the user must stay visible: **nested delegation**
  ([references/token-exchange.md](references/token-exchange.md)).
- An app or agent must reach an app that has its own authorization server, with no second consent
  screen: **cross-app access**
  ([references/cross-app-access.md](references/cross-app-access.md)).
- An agent needs a user's Google, Slack, GitHub or other third-party account: **agent connections**
  ([references/agent-connections.md](references/agent-connections.md)).

Do not use this skill when:

- The agent acts only as itself: use `lumoauth-agent-identity`.
- A human must approve one specific action (just-in-time permissions, push approval, CIBA): use
  `lumoauth-agent-approvals`. Token exchange shows no consent screen.
- The target is an MCP server: use `lumoauth-mcp-client`.
- The agent signs requests with its own key (AAuth `exchange`): use `lumoauth-aauth`.

## How token exchange works

```
user signs in to your app ──► your app holds the user's access token   (subject token)
agent authenticates as itself ──► the agent's own access token          (actor token)

POST /orgs/{orgId}/api/v1/oauth/token
  grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  subject_token=<user token>   actor_token=<agent token>   resource=https://api.example.com

──► delegated access token:  sub = the user,  act.sub = agent_agt_…,  aud = https://api.example.com
```

Rules that shape the code:

- The request has no `client_id` and no secret. The agent's own token (the actor token)
  authenticates it.
- The delegated token's audience comes from the `resource` parameter. LumoAuth does not bind `aud`
  from `audience`. Without `resource`, `aud` is the agent's own ID, and an API that checks `aud`
  refuses the token.
- Scopes only narrow. The result is what the user's token carries, limited to what the agent's
  capabilities cover, limited again by a `scope` that you request.
- The delegated token never outlives the user's token or the agent's token.
- There is no consent screen. The user consented when the subject token was issued.

## Before you start

Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL, organization slug | `LUMOAUTH_URL` (default `https://app.lumoauth.dev`; EU `https://eu.app.lumoauth.dev`), `LUMOAUTH_ORG_ID` |
| Agent credential | `AGENT_CLIENT_ID` (`agt_…`) and `AGENT_CLIENT_SECRET`, from `lumoauth-agent-identity` |
| The user's access token | From the application where the user signed in (an OAuth client of the same organization). See `lumoauth-oauth-oidc` or the framework skill for that app |
| Resource URL | The URL of the API that will receive the delegated token, for example `https://api.example.com` |

Requirements that an admin must meet:

1. The agent has **May act on behalf of users** switched on. Set it in the portal: **AI Agents →
   Agents**, step 3 of **Register agent**, or the agent's edit page. An admin can switch it on only
   when the admin holds every capability of the agent. The Admin API reports the flag as
   `canActOnBehalfOfUsers` (check with `lumo agents get <agent-id>`). Set it in the portal: the
   Admin API create and update requests do not change it.
2. The agent's capabilities cover the scopes that it should act with. A user token with
   `documents.read` and an agent with the capability `documents.read` or `documents.*` gives a
   delegated token with `documents.read`. No overlap gives `invalid_scope`.

Both tokens are secrets. The exchange runs on a server. Never send the agent's token or its secret
to a browser, and never log any of the three tokens. Delegation depends on the organization's plan
(see https://docs.lumoauth.dev/pricing-matrix).

## Steps

### 1. Pass the user's access token to the agent backend

The app that the user signed in to calls the agent backend over HTTPS and passes the user's access
token for this one request. Keep it in memory only. Requirements for the subject token:

- It is an **access token** of this organization (a JWT or an opaque token). An ID token or a
  refresh token is refused with `400 invalid_request`.
- Its audience is not another resource server. A token that the app requested with
  `resource=https://other.example.com` is refused with `400 invalid_grant`.
- It carries the scopes that the agent should act with.

### 2. Exchange the tokens (Python)

```bash
pip install lumoauth
```

```python
from lumoauth import DelegationChain, LumoAuthAgent

agent = LumoAuthAgent()  # reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET
if not agent.authenticate():
    raise SystemExit("Agent authentication failed")

chain = DelegationChain(agent)


def delegated_token_for(session_id: str, user_access_token: str) -> str:
    """Return a token with which the agent acts for this user at https://api.example.com."""
    chain.set_user_token(session_id, user_access_token)
    return chain.exchange(
        session_id,
        scopes=["documents.read"],            # optional: narrow further
        resource="https://api.example.com",   # becomes the token's aud
    )
```

`session_id` is your own key for one user session. `exchange` raises
`LumoAuthPermissionDeniedError` on `403` and `LumoAuthApiError` on other refusals.

### 3. Exchange the tokens (TypeScript)

```bash
npm install @lumoauth/agent
```

```ts
import { LumoAgent } from '@lumoauth/agent';

// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
const agent = new LumoAgent();

/** Returns a token with which the agent acts for this user at https://api.example.com. */
export async function delegatedTokenFor(sessionId: string, userAccessToken: string): Promise<string> {
  agent.delegation.setUserToken(sessionId, userAccessToken);
  return agent.delegation.exchange(
    sessionId,
    ['documents.read'],                       // optional: narrow further
    { resource: 'https://api.example.com' },  // becomes the token's aud
  );
}
```

`exchange` throws `LumoAuthPermissionDeniedError` on `403` and `LumoAuthApiError` on other
refusals. `@lumoauth/agent` runs on a server only.

### 4. Call the API with the delegated token

Send it as a bearer token to the API that `resource` names, and only there:

```python
import requests


def list_documents(delegated_token: str) -> list:
    response = requests.get(
        "https://api.example.com/v1/documents",
        headers={"Authorization": f"Bearer {delegated_token}"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()
```

Request a new delegated token when the old one expires (`expires_in` is at most one hour). When
the session ends, call `chain.revoke(session_id)` (Python) or `agent.delegation.revoke(sessionId)`
(JS) to drop the stored tokens.

### 5. Check the delegated token in the downstream API

The API must verify the token itself. It is an ordinary LumoAuth access token (`typ: at+jwt`) with
these claims:

```json
{
  "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "sub": "8b1f6c1e-2d0a-4f6b-9c57-0c2f4a9e7d11",
  "aud": "https://api.example.com",
  "client_id": "agt_0123456789abcdef",
  "scope": "documents.read",
  "act": {
    "sub": "agent_agt_0123456789abcdef",
    "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
    "sub_profile": "ai_agent",
    "name": "Research assistant"
  }
}
```

TypeScript (`@lumoauth/agent`):

```ts
import { accessTokenScopes, createAccessTokenVerifier } from '@lumoauth/agent';

const verifier = createAccessTokenVerifier({
  issuer: 'https://app.lumoauth.dev/orgs/acme-corp/api/v1',
  resource: 'https://api.example.com', // the token's aud must contain this
});

export async function authorize(method: string, publicUrl: string, headers: Record<string, string | string[] | undefined>) {
  const claims = await verifier.verifyRequest({ method, url: publicUrl, headers }); // throws AccessTokenError
  if (!accessTokenScopes(claims).includes('documents.read')) {
    throw new Error('insufficient_scope');
  }
  return {
    userId: claims.sub,               // the user
    actor: claims.act?.sub ?? null,   // "agent_agt_…" when an agent acts for the user
    actorKind: claims.act?.sub_profile ?? null,
  };
}
```

Python (`pip install "lumoauth[verify]"`):

```python
from lumoauth import verify_access_token


def authorize(bearer_token: str) -> dict:
    claims = verify_access_token(   # raises LumoAuthTokenError
        bearer_token,
        issuer="https://app.lumoauth.dev/orgs/acme-corp/api/v1",
        resource="https://api.example.com",
    )
    if not claims.has_scope("documents.read"):
        raise PermissionError("insufficient_scope")
    return {
        "user_id": claims.sub,            # the user
        "actor": claims.actor,            # "agent_agt_…" when an agent acts for the user
        "actor_chain": claims.act_chain,  # outermost actor first
    }
```

What the downstream API must check, with or without an SDK:

1. The signature, against the organization's JWKS, and `typ` = `at+jwt`.
2. `iss` equals the organization's issuer. `exp` is in the future.
3. `aud` contains this API's own URL. Refuse a token whose `aud` is an agent ID or another API.
4. `scope` contains the scope that the operation needs.
5. `sub` is the user to authorize: apply the user's own permissions. The agent never gets more
   than the user has.
6. `act`: decide whether this agent may do this operation for a user at all, and write `sub` and
   the whole `act` chain to your audit log.
7. `cnf.jkt`, when present: the token is DPoP-bound and needs a valid DPoP proof. The SDK
   verifiers above check it when you give them the request.

Do not use `parseActorChain` / `parse_actor_chain` for authorization. Those helpers decode the
token without verifying it; they are for display and debugging.

### 6. Without an SDK

```bash
curl -X POST "$LUMOAUTH_URL/orgs/$LUMOAUTH_ORG_ID/api/v1/oauth/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$USER_ACCESS_TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "actor_token=$AGENT_ACCESS_TOKEN" \
  -d "actor_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "resource=https://api.example.com" \
  -d "scope=documents.read"
```

The response has `access_token`, `token_type`, `expires_in`, `scope` and
`issued_token_type` (`urn:ietf:params:oauth:token-type:access_token`).

## Verify

1. Decode the delegated token (for a look only): `sub` is the user's ID, `act.sub` is
   `agent_` plus the agent ID, `aud` is the resource URL, `scope` is no wider than the user's.
2. The downstream API accepts it and logs both the user and the agent.
3. Send the same token to an API with another `resource` URL in its verifier: it must be refused.
4. Switch **May act on behalf of users** off for a test agent: the exchange must fail with
   `403 access_denied`.
5. The portal audit log shows `oauth.token_exchange` for each exchange.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `403 access_denied`, "Agent is not authorized to act on behalf of users" | **May act on behalf of users** is off | An admin switches it on in the portal. There is no `delegate:on_behalf` scope or capability, although SDK error messages mention one |
| `lumo agents create --act-on-behalf` ran, but the exchange still gets `403` | The Admin API does not set this flag | Set it in the portal. Check `canActOnBehalfOfUsers` with `lumo agents get <agent-id>` |
| `400 invalid_scope` | The user's token and the agent's capabilities share no scope, or the requested `scope` is outside both | Give the agent a capability that covers the scope, or sign the user in with that scope |
| `400 invalid_grant`, "Invalid subject_token" | The user token is expired, from another organization, bound to another resource server, issued before the user signed out everywhere, or it is the agent's own token | Get a new user access token without a foreign `resource` |
| `400 invalid_request` on the subject token | An ID token or a refresh token was sent | Send the user's access token |
| `400 invalid_grant`, "Invalid actor_token" | The actor token is not this agent's own token for LumoAuth's API: it is another agent's token, a delegated token, or a token bound to an MCP server | Use the agent's plain client credentials token |
| The API refuses the token: wrong audience | `resource` was left out, so `aud` is the agent ID. Or `audience` was sent instead | Send `resource` with the API's URL |
| `400 invalid_target` | More than one `resource`, or a malformed one | One absolute `https` URL without a fragment. Request one token per API |
| `invalid_dpop_proof` | The agent's token or the user's token is DPoP-bound, or the agent must use DPoP | Give the agent a DPoP signer (`dpop` option in JS, Python and Go); see `lumoauth-agent-identity` |
| `429` with `budget_exceeded` | The agent's budget is spent. An exchange counts as one call. `Retry-After` gives the seconds until the spent window ends | See budgets in `lumoauth-agent-identity` |
| The SDK consent helpers (`getConsentUrl`, `get_consent_url`, `handleConsentCallback`) fail with "Unknown Application" or `unsupported_grant_type` | They start an authorization code flow with the agent's ID as `client_id`. An agent is not an OAuth application | Sign the user in through an application (an OAuth client) and pass the access token with `setUserToken` / `set_user_token` |

## Related skills

- `lumoauth-agent-identity`: register the agent and get its own token.
- `lumoauth-oauth-oidc`: sign the user in and get the user's access token.
- `lumoauth-api-protection`: verify access tokens in an API in any language.
- `lumoauth-agent-approvals`: ask a human before a specific action.
- `lumoauth-mcp-client`: tokens for an MCP server.
- `lumoauth-aauth`: delegation between agents with signed requests.
- `lumoauth-agent-governance`: revoke an agent and everything that it holds.

## References

- [references/token-exchange.md](references/token-exchange.md): read for every request parameter,
  the rules and error codes, nested delegation to a sub-agent, DPoP, lifetimes and revocation.
- [references/other-languages.md](references/other-languages.md): read for Go, .NET, Java and PHP.
- [references/cross-app-access.md](references/cross-app-access.md): read when the target app has
  its own authorization server (ID-JAG, both roles).
- [references/agent-connections.md](references/agent-connections.md): read when the agent needs a
  user's third-party account (Google, Slack, GitHub and others).
- https://docs.lumoauth.dev/agents/delegation
- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/agents/cross-app-access
- https://docs.lumoauth.dev/agents/token-vault
