# The attestation endpoint

`POST /orgs/{orgId}/api/v1/agents/{agentId}/attest`

A `workload` agent presents the OIDC token that its platform issued (GitHub Actions, Kubernetes,
AWS EKS, GCP, Azure, SPIFFE, a CI/CD platform or another OIDC issuer) and gets a short-lived
LumoAuth access token. The agent stores no secret. The endpoint needs no other credential: the
platform token is the credential.

Use this endpoint when the workload has its agent ID. Use the token exchange in
`workload-federation.md` when it does not. Register the agent and its binding first; that file
explains how, and lists the binding keys for each platform.

"Attestation" here means workload attestation: proof of where the code runs. It is not
attestation-based client authentication for OAuth clients (see `lumoauth-oauth-advanced`).

## Request and response

```http
POST /orgs/acme-corp/api/v1/agents/agt_0123456789abcdef/attest
Content-Type: application/json

{
  "attestation_token": "<JWT issued by the platform>",
  "scope": "reports.send"
}
```

`scope` is optional (a space-separated string or a list). It can only narrow the agent's
capabilities. A scope outside them is refused with `400 invalid_scope`.

```json
{
  "access_token": "eyJraWQi...",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "reports.send",
  "identity": {
    "provider": "github",
    "subject": "github:acme-corp/data-pipeline:refs/heads/main",
    "issuer": "https://token.actions.githubusercontent.com"
  }
}
```

The token lasts 15 minutes. Attest again before it expires, each time with a new platform token.

## TypeScript

```ts
import { attestWorkload } from '@lumoauth/agent';

// LUMOAUTH_URL and LUMOAUTH_ORG_ID are read from the environment.
export async function agentToken(platformToken: string): Promise<string> {
  const result = await attestWorkload({
    agentId: process.env.LUMOAUTH_AGENT_ID!,   // your own variable name: the agt_… ID
    attestationToken: platformToken,
  });
  console.log(result.identity.subject, result.expiresIn);
  return result.accessToken;
}
```

`attestWorkload` also takes `baseUrl`, `orgId`, `fetch` and `dpop` (a `DpopProofSigner`; the token
then comes back with `tokenType: "DPoP"`). It does not send `scope`. It throws `LumoAuthApiError`
when the token is refused.

## Python

The Python SDK has no helper for this endpoint. Call it with `requests`:

```python
import os

import requests

LUMOAUTH_URL = os.environ.get("LUMOAUTH_URL", "https://app.lumoauth.dev")
ORG_ID = os.environ["LUMOAUTH_ORG_ID"]
AGENT_ID = os.environ["LUMOAUTH_AGENT_ID"]   # your own variable name: the agt_… ID


def agent_token(platform_token: str) -> str:
    response = requests.post(
        f"{LUMOAUTH_URL}/orgs/{ORG_ID}/api/v1/agents/{AGENT_ID}/attest",
        json={"attestation_token": platform_token},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]
```

## GitHub Actions

Register the agent with `workloadIdentityProvider: "github"`, the `repository` and a `ref` or an
`environment`. Then, in the workflow:

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  run-agent:
    runs-on: ubuntu-latest
    env:
      LUMOAUTH_URL: https://app.lumoauth.dev
      LUMOAUTH_ORG_ID: acme-corp
      LUMOAUTH_AGENT_ID: agt_0123456789abcdef
    steps:
      - name: Get a LumoAuth agent token
        run: |
          AUDIENCE="$LUMOAUTH_URL/orgs/$LUMOAUTH_ORG_ID/api/v1/agents/$LUMOAUTH_AGENT_ID"
          ID_TOKEN=$(curl -sS -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$AUDIENCE" | jq -r .value)
          ACCESS_TOKEN=$(curl -sS -X POST "$AUDIENCE/attest" \
            -H "Content-Type: application/json" \
            -d "{\"attestation_token\": \"$ID_TOKEN\"}" | jq -r .access_token)
          echo "::add-mask::$ACCESS_TOKEN"
          echo "AGENT_ACCESS_TOKEN=$ACCESS_TOKEN" >> "$GITHUB_ENV"
```

The default audience is the agent's own URL, which is also the prefix of the attestation URL.

## Token rules

| Rule | Detail |
|---|---|
| One-time use | A platform token is accepted once. Fetch a new one for every attestation |
| `exp` required | The token must expire within 24 hours. Ask the platform for about 10 minutes |
| Audience | The token's `aud` must contain the audience that is configured on the agent, exactly |
| Subject | The token's subject must match the registered binding. A prefix matches only at a `:` boundary (`/` for SPIFFE). The `custom` provider matches exactly |
| Status | The agent and the organization must be active |
| Budget | An attestation counts against the agent's budget |

## Errors

| HTTP | `error` | Meaning |
|---|---|---|
| 401 | `attestation_rejected` | The token could not be verified for this agent. The body never says why. An unknown agent ID gets the same answer |
| 403 | `access_policy_denied` | The token verified, but a conditional access policy denied the agent. `reason` names the rule |
| 400 | `missing_attestation_token`, `invalid_json`, `invalid_scope` | The request body is wrong |
| 429 | `rate_limit_exceeded` | More than 30 attestations per minute from one IP address or for one agent. Honour `Retry-After` |
| 429 | `budget_exceeded` | The agent's budget is spent |

To find the cause of `attestation_rejected`, ask an admin to open the audit log in the portal and
filter for `agent.attestation.rejected`. The `reason` in the event names the failing check
(audience, subject, issuer, expiry, replay).

A policy that requires a recent attestation denies an agent that has never attested, including the
first attempt. An admin must switch the policy on after the first attestation.

Docs: https://docs.lumoauth.dev/agents/attestation
