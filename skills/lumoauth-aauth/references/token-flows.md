# AAuth token flows

All requests go to the agent token endpoint, `POST {issuer}/aauth/agent/token`, with the agent
token in the `Agent-Auth` header and a signature from the key in that token's `cnf`. The JSON body
selects the operation with `request_type`. `{issuer}` is
`https://app.lumoauth.dev/orgs/{orgId}/api/v1` (or the EU host).

| `request_type` | Purpose | Body fields | JS method |
|---|---|---|---|
| `auth` | Get an auth token for a resource | `resource_token`, `redirect_uri` (for consent) | `requestAuthToken` |
| `code` | Redeem the code from user consent | `code`, `redirect_uri` | `exchangeCode` |
| `refresh` | Renew an auth token | `refresh_token`, `resource_token` | `refresh` |
| `exchange` | Pass access on to the next agent | `auth_token`, `resource_token` | `exchangeToken` |

A success answers `200` with `request_type`, `auth_token`, `token_type` (`auth+jwt`), `expires_in`
and, when refresh tokens are enabled for the agent, `refresh_token`.

The examples use the `aauth` client and `issueAgentToken()` from `SKILL.md`.

## User consent

LumoAuth asks for consent when the agent has user authorization switched on and one of these
holds: an identity scope (`openid`, `profile`, `email`, `phone`, `address`) is requested, a
requested scope is not pre-authorized, or the agent has no pre-authorized scopes. The request must
then carry a `redirect_uri` that is registered for the agent.

```ts
import { aauth, issueAgentToken } from './aauth-agent';

const REDIRECT_URI = 'https://my-agent.example.com/oauth/callback';

/** Step 1: returns a URL for the user's browser, or the auth token when no consent is needed. */
export async function start(resourceToken: string): Promise<{ redirectTo?: string; authToken?: string }> {
  const agentToken = await issueAgentToken();
  const result = await aauth.requestAuthToken({ resourceToken, agentToken, redirectUri: REDIRECT_URI });
  if ('authorizationRequired' in result) {
    return { redirectTo: result.authorizationUri }; // valid for 10 minutes
  }
  return { authToken: result.authToken };
}

/** Step 2: called by the route behind REDIRECT_URI with the ?code= value. */
export async function finish(code: string): Promise<{ authToken: string; refreshToken?: string }> {
  // Use an agent token for the same agent key that started the request.
  const agentToken = await issueAgentToken();
  const tokens = await aauth.exchangeCode({ code, redirectUri: REDIRECT_URI, agentToken });
  return { authToken: tokens.authToken, refreshToken: tokens.refreshToken };
}
```

Rules:

- The consent page is on LumoAuth. Only a signed-in member of the organization can approve.
- On denial the browser returns to the redirect URI with `?error=access_denied`.
- The code is valid for 60 seconds and one use. It is bound to the agent, the delegate (the `sub`
  of the agent token), the agent key, the organization and the exact redirect URI. Any mismatch is
  `invalid_grant`.
- The user can grant at most the requested scopes.
- Keep the agent token's `delegate_sub` and key the same between step 1 and step 2.

Python: `client.exchange_code(code, redirect_uri, agent_token=agent_token)`.

## Refresh

A refresh token lasts 30 days and is not rotated: keep using the same one. It is a grant for one
resource. Each refresh needs a new resource token from that same resource, and the scopes in it
can only narrow the original grant.

```ts
import { aauth, issueAgentToken } from './aauth-agent';

export async function renew(refreshToken: string, freshResourceToken: string): Promise<string> {
  const refreshed = await aauth.refresh({
    refreshToken,
    resourceToken: freshResourceToken,
    agentToken: await issueAgentToken(),
  });
  return refreshed.authToken;
}
```

A refresh fails with `invalid_grant` when the resource token comes from another resource, or when
the user of a user-bound grant was blocked, deactivated or deleted, signed out everywhere, or
changed the password after the refresh token was issued. It fails with `unauthorized_agent` when
refresh tokens are disabled for the agent. Store refresh tokens encrypted, on the server.

Python: `client.refresh(refresh_token, fresh_resource_token, agent_token=agent_token)`.

## Exchange between agents

Agent A holds an auth token whose `aud` is agent B. Agent B wants to call a downstream resource
for the same request. B sends A's token and a resource token from the downstream resource:

```ts
import { aauth, issueAgentToken } from './aauth-agent'; // agent B's client

export async function downstreamToken(upstreamAuthToken: string, downstreamResourceToken: string): Promise<string> {
  const result = await aauth.exchangeToken({
    authToken: upstreamAuthToken,
    resourceToken: downstreamResourceToken,
    agentToken: await issueAgentToken(),
  });
  return result.authToken;
}
```

The new token carries an `act` claim built from the upstream token:

```json
{
  "act": {
    "agent": "https://agent-a.example.com",
    "agent_delegate": "https://agent-a.example.com/session/42",
    "sub": "user-id-when-a-user-is-bound",
    "act": {}
  }
}
```

Rules:

- **Token exchange** must be switched on for agent B in its registration (`unauthorized_agent`
  otherwise).
- The upstream token must come from this organization and be addressed (`aud`) to agent B.
- Scopes only narrow: the result is the intersection of the downstream resource token's scopes
  and the upstream token's scopes. When nothing is left the exchange fails with `invalid_scope`.
- A chain holds at most 5 actors. A deeper exchange fails with `400 invalid_request`.
- No refresh token is returned.

The Python and PHP clients have no exchange method. Go, Java and .NET do (see
`other-languages.md`).

For token exchange at the OAuth token endpoint (an agent acting for a signed-in user with
ordinary access tokens), use `lumoauth-agent-delegation`.

## Revoke

```ts
import { aauth, issueAgentToken } from './aauth-agent';

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await aauth.revoke({ token: refreshToken, tokenType: 'refresh_token', agentToken: await issueAgentToken() });
}
```

`POST {issuer}/aauth/token/revoke` takes `token` (a refresh token value, or the `jti` of an auth
token) and `token_type` (`refresh_token`, or `auth_token`, the default). An agent can revoke only
its own tokens. The answer is always `200 {"revoked": true}`.

An admin can end all AAuth tokens of an agent in the portal: **Revoke credentials** on the agent's
AAuth panel. See `lumoauth-agent-governance`.

## One key per session (delegates)

An agent server that works for many users can give each session its own key. The server keeps the
agent's registered key; the session generates a key pair and never sees the agent's key.

1. The session generates a key pair (`generateKeypair()`).
2. The agent server calls `/aauth/agent/issue` as in `SKILL.md`, with `delegate_sub` set to a URL
   for the session (for example `https://my-agent.example.com/session/42`) and
   `delegate_public_key` set to the **session's** public JWK. The request is still signed with the
   agent's registered key.
3. The session creates its own `AAuthClient` with the session's private key and uses the returned
   agent token. Its auth tokens carry `agent_delegate` with the session URL, and its refresh
   tokens are bound to the (agent, delegate) pair.

`delegate_public_key` must be a public JWK (RSA, EC or OKP). A JWK with private members is
refused. The agent must be active and have delegation enabled.

## An agent that signs its own agent tokens

Instead of calling `/aauth/agent/issue`, an agent server can sign the agent token itself with a
key from its registered JWKS. LumoAuth then verifies the token against that JWKS. Use any JWT
library that signs with your key type.

Header: `typ` = `agent+jwt`, `alg` (for an Ed25519 key `EdDSA`), `kid` (a key in the registered
JWKS).

| Claim | Value |
|---|---|
| `iss` | The agent identifier |
| `sub` | The delegate identifier (for example the session URL). Required |
| `aud` | The organization's issuer URL (optional; checked when present) |
| `iat`, `exp` | Required. The lifetime must not exceed 24 hours |
| `jti` | Required, unique |
| `cnf` | `{"jwk": <public JWK of the key that will sign requests>}`, or `{"jkt": <thumbprint>}`; with `jkt`, the thumbprint must be that of the key that signed this JWT |

When the agent publishes its keys at a JWKS URL, the document must be JSON and at most 256 KB.

## Use LumoAuth's own API with an AAuth identity

The Ask API, just-in-time permissions and connection tokens accept ordinary agent access tokens,
not AAuth auth tokens. An AAuth agent gets such a token from the bridge endpoint:

`POST {issuer}/aauth/agent/platform-token`, signed with the key in the agent token's `cnf`.

| Body field | Value |
|---|---|
| `grant_type` | `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | The agent token (`agent+jwt`) |
| `subject_token_type` | `urn:lumoauth:params:oauth:token-type:aauth-token` (optional) |
| `scope` | Optional. Narrows the agent's capabilities; a scope outside them is `invalid_scope` |

The answer is an access token with `"token_type": "DPoP"`, `"expires_in": 300`, the `agent_id`
(`agt_…`) and `cnf_jkt`. The token is bound to the agent's signing key: every call made with it
needs `Authorization: DPoP <token>` and a DPoP proof signed with that same key. Request a new
token every 5 minutes.

```ts
import { DpopProofSigner, fetchWithDpop, signRequest } from '@lumoauth/agent';
import { aauth, issueAgentToken } from './aauth-agent';

const privateKeyPem = process.env.AGENT_PRIVATE_KEY!;

export async function askLumoAuth(action: string): Promise<boolean> {
  // 1. Exchange the agent token for a DPoP-bound access token.
  const bridgeUrl = `${aauth.issuer}/aauth/agent/platform-token`;
  const bridgeBody = JSON.stringify({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: await issueAgentToken(),
    subject_token_type: 'urn:lumoauth:params:oauth:token-type:aauth-token',
  });
  const bridge = await fetch(bridgeUrl, {
    method: 'POST',
    headers: signRequest(privateKeyPem, 'POST', bridgeUrl, { body: bridgeBody }),
    body: bridgeBody,
  });
  if (!bridge.ok) throw new Error(`platform token request failed: HTTP ${bridge.status}`);
  const { access_token: accessToken } = (await bridge.json()) as { access_token: string };

  // 2. Call the Ask API with the token and a DPoP proof from the same key.
  const dpop = new DpopProofSigner({ privateKeyPem });
  const askUrl = `${aauth.issuer}/agents/ask`;
  const res = await fetchWithDpop(
    fetch,
    askUrl,
    {
      method: 'POST',
      headers: { Authorization: `DPoP ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
    dpop,
    { accessToken },
  );
  if (!res.ok) throw new Error(`ask failed: HTTP ${res.status}`);
  return ((await res.json()) as { allowed: boolean }).allowed === true;
}
```

The first bridge call links the AAuth registration to an agent record (`agt_…`) in the registry.
Conditional access policies and the agent's budget apply to the bridge: `403 access_policy_denied`,
`429 access_denied` ("Agent budget exceeded"), `429 rate_limit_exceeded` (30 requests per minute
per agent). An invalid, expired or revoked agent token, or a missing or replayed signature, is
`401 invalid_grant`.

Docs: https://docs.lumoauth.dev/agents/aauth-spec, https://docs.lumoauth.dev/agents/aauth
