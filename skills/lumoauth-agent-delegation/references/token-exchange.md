# Token exchange for agents: reference

`POST {base URL}/orgs/{orgId}/api/v1/oauth/token`, `Content-Type: application/x-www-form-urlencoded`.

This file covers the exchange in which an agent acts for a user (the on-behalf-of exchange). The
agent authenticates with its own token in `actor_token`; the request carries no `client_id` and no
`client_secret`.

## Parameters

| Parameter | Required | Value |
|---|---|---|
| `grant_type` | Yes | `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | Yes | The user's access token |
| `subject_token_type` | Yes | `urn:ietf:params:oauth:token-type:access_token` (an opaque or JWT access token) or `urn:ietf:params:oauth:token-type:jwt` (a JWT access token) |
| `actor_token` | Yes | The agent's own access token for LumoAuth's API (from the client credentials grant, a private key JWT assertion or workload identity) |
| `actor_token_type` | Yes, with `actor_token` | `urn:ietf:params:oauth:token-type:access_token` |
| `resource` | Recommended | One absolute `https` URL: the API that will receive the token. It becomes `aud` |
| `scope` | No | Space-separated. Narrows the result |

`audience` is not used to bind the token. Send `resource`.

`requested_token_type` selects other products of the same grant: the identity assertion for
cross-app access (see `cross-app-access.md`) and transaction tokens, which are off by default for
an organization and are not covered here.

## Response

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "documents.read",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}
```

`token_type` is `DPoP` when the request carried a DPoP proof. No refresh token is issued: request
a new delegated token with a current user token when the old one expires.

## Rules

| Rule | Detail | Error when broken |
|---|---|---|
| Agent flag | The agent has **May act on behalf of users** switched on | `403 access_denied` |
| Agent status | The agent is active | `400 invalid_grant` |
| Subject type | An access token. Not an ID token, not a refresh token | `400 invalid_request` |
| Subject validity | A live token of this organization for an active user. A token issued before the user signed out everywhere, or before a password reset, is refused | `400 invalid_grant` |
| Subject audience | The user token is not bound to a resource server outside the organization's issuer (for example an MCP server) | `400 invalid_grant` |
| Not itself | The agent's own token cannot be the subject | `400 invalid_grant` |
| Actor | `actor_token` resolves to the agent that makes the request. It is a token for LumoAuth's own API: not a delegated token, not a token bound to another resource | `400 invalid_grant` |
| One resource | At most one `resource` | `400 invalid_target` |
| Scopes | Result = (requested scopes, or all subject scopes) ∩ the subject token's scopes ∩ what the agent's capabilities cover ∩ the actor token's scope when that token was narrowed. An empty result is refused | `400 invalid_scope` |
| Lifetime | At most one hour, and never longer than the time left on the user's token or on the agent's token | |
| Chain depth | At most 5 actors | `400 invalid_request` |
| Key binding | A DPoP-bound subject or actor token needs a DPoP proof from the key that it is bound to | `invalid_dpop_proof` |
| Conditional access | The agent's access policies are checked | `403 access_denied` |
| Budget | One call against the agent's budget | `429 access_denied` |

Special-purpose tokens are never accepted as subject or actor: just-in-time permission tokens,
logout tokens, transaction tokens, identity assertions and test tokens from the portal.

`resource` that names a registered MCP server brings that server's policy with it (scope
vocabulary, lifetime, Require DPoP). Use `lumoauth-mcp-client` for that case.

The scope strings in the result are the user's own: LumoAuth does not rewrite them. Capability
matching ignores case and treats `:`, `-` and `.` alike, so the capability `documents.*` covers the
scope `documents:read`.

## The `act` claim

```json
{
  "sub": "8b1f6c1e-2d0a-4f6b-9c57-0c2f4a9e7d11",
  "aud": "https://api.example.com",
  "scope": "documents.read",
  "act": {
    "sub": "agent_agt_0123456789abcdef",
    "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
    "sub_profile": "ai_agent",
    "name": "Research assistant"
  }
}
```

| Member | Meaning |
|---|---|
| `act.sub` | The actor: `agent_` plus the agent ID for an agent, the user ID for a user |
| `act.iss` | The issuer that `act.sub` belongs to |
| `act.sub_profile` | `ai_agent`, `user` or `workload` (an OAuth client) |
| `act.name` | The agent's display name |
| `act.act` | The earlier actor, when the token went through more than one exchange |

Read the chain from the outside in: the outermost `act` is the party that presents the token now;
each nested `act` is the party that handed the request to it.

## Nested delegation: agent to sub-agent

Agent A acts for the user and hands part of the task to agent B. B exchanges A's delegated token
(subject) with its own token (actor). The result has `sub` = the user, `act` = B, `act.act` = A.

Requirements:

- Agent B also has **May act on behalf of users** switched on, and its capabilities cover the
  scopes.
- A's delegated token is for LumoAuth's API or for no resource: A requested it **without**
  `resource` (its `aud` is then A's ID). A token that A requested for `https://api.example.com`
  cannot be the subject of B's exchange (`invalid_grant`).
- B requests its token with the `resource` of the API that B will call.

Python, in agent A, which holds B's token (B gave it to A over a trusted channel) or in a service
that holds both:

```python
from lumoauth import DelegationChain, LumoAuthAgent

agent_a = LumoAuthAgent()
agent_a.authenticate()
chain = DelegationChain(agent_a)


def token_for_sub_agent(session_id: str, user_access_token: str, sub_agent_token: str) -> str:
    chain.set_user_token(session_id, user_access_token)
    chain.exchange(session_id)   # user -> A, no resource: aud is agent A
    return chain.delegate_to_sub_agent(
        session_id,
        sub_agent_token,                     # agent B's own access token
        scopes=["documents.read"],
        resource="https://api.example.com",  # the API that B will call
    )
```

TypeScript:

```ts
import { LumoAgent } from '@lumoauth/agent';

const agentA = new LumoAgent();

export async function tokenForSubAgent(sessionId: string, userAccessToken: string, subAgentToken: string): Promise<string> {
  agentA.delegation.setUserToken(sessionId, userAccessToken);
  await agentA.delegation.exchange(sessionId); // user -> A, no resource: aud is agent A
  return agentA.delegation.delegateToSubAgent(sessionId, subAgentToken, ['documents.read'], {
    resource: 'https://api.example.com',
  });
}
```

The cleaner split is that A sends its delegated token to B, and B runs the second exchange itself
with its own token as `actor_token`: then no agent ever holds another agent's token. With raw
HTTP, B sends `subject_token=<A's delegated token>`, `actor_token=<B's token>`, `resource=…`.

The chain holds at most 5 actors; a deeper exchange gets `400 invalid_request`. The SDK constants
named `MAX_DELEGATION_DEPTH` say 3 and the SDKs look for a `delegation_depth_exceeded` error; the
server's limit and error are the ones stated here.

## DPoP

Send a `DPoP` proof with the exchange (method `POST`, URL of the token endpoint) and the delegated
token is bound to that key: `token_type` is `DPoP` and the token carries `cnf.jkt`. Then every call
with the token needs `Authorization: DPoP <token>` and a fresh proof.

- JS: `new LumoAgent({ dpop: DpopProofSigner.generate() })`. `agent.delegation.exchange` sends the
  proof, and `agent.delegation.request(sessionId, method, url)` presents the token with a proof.
- Go: `AgentConfig{DPoP: signer}`.
- Python: `LumoAuthAgent(dpop=True)` binds the agent's own token. `DelegationChain` does not send a
  proof on the exchange, so with a DPoP-bound agent token in Python, call the token endpoint
  yourself and add the header from `agent.dpop_proof("POST", token_url)`.

A proof is mandatory when the agent has **Only issue DPoP-bound tokens** on, when the user's token
or the agent's token is DPoP-bound, or when `resource` is an MCP server with Require DPoP. DPoP is
the only sender constraint that LumoAuth offers. Its availability depends on the organization's
plan (see https://docs.lumoauth.dev/pricing-matrix).

## Ending a delegation

- A delegated token expires on its own, within an hour at most.
- Revoking the user's refresh token at `POST /orgs/{orgId}/api/v1/oauth/revoke`
  (`token_type_hint=refresh_token`, sent by the application that owns it) ends that sign-in: the
  user's access tokens from it stop working, so no new exchange succeeds.
- When an admin suspends or revokes the agent, the delegated tokens that it obtained are
  deny-listed in LumoAuth. An API that verifies tokens locally does not see that until the token
  expires. For operations where that matters, check the token with the introspection endpoint
  (see `lumoauth-api-protection`).

## SDK helper summary

| | JS (`agent.delegation`) | Python (`DelegationChain`) |
|---|---|---|
| Register the user token | `setUserToken(sessionId, token)` | `set_user_token(session_id, token)` |
| Exchange | `exchange(sessionId, scopes?, { resource })` | `exchange(session_id, scopes=None, *, resource=None)` |
| Call an API with the cached token | `request(sessionId, method, url, { body, headers })` | `request(session_id, method, endpoint, data=None, params=None)` |
| Sub-agent | `delegateToSubAgent(sessionId, subAgentToken, scopes?, { resource })` | `delegate_to_sub_agent(session_id, sub_agent_token, scopes=None, *, resource=None)` |
| Forget a session | `revoke(sessionId)`, `revokeAll()` | `revoke(session_id)`, `revoke_all()` |
| State | `activeSessions`, `hasDelegation(sessionId)` | `active_sessions`, `has_delegation(session_id)` |
| Decode for display (no verification) | `DelegationModule.parseActorChain(token)` (the class is exported by `@lumoauth/shared`, a dependency of `@lumoauth/agent`) | `DelegationChain.parse_actor_chain(token)` |

`request` caches one delegated token per session. Call `exchange` with the `resource` first; a
`request` on a session without a cached token runs an exchange without `resource`.

The helpers `getConsentUrl` / `get_consent_url` and `handleConsentCallback` /
`handle_consent_callback` start an authorization code flow with the agent's ID as the OAuth
`client_id`. The authorization endpoint and the `authorization_code` grant accept registered
applications only, not agents, so do not build on these helpers. Sign the user in through an
application and pass the access token with `setUserToken` / `set_user_token`.

Docs: https://docs.lumoauth.dev/agents/delegation, https://docs.lumoauth.dev/oauth/token
