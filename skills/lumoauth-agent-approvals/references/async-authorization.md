# Async authorization (agent-initiated CIBA)

Open this file when an agent needs the authorization of one named user, the user is not present in the agent's process (a batch job, a long workflow), and the agent needs a token as the result.

The agent sends a backchannel authorization request (OpenID CIBA) that names the user and carries one `authorization_details` object. The user gets a push prompt on their enrolled phone. The agent polls the token endpoint and receives a JIT token after the approval.

Facts to keep in mind:

- Delivery is poll mode only. There is no ping or push delivery to the agent and no `user_code`.
- The result is a JIT token: short-lived (60 to 900 seconds), one token per approval, revocable, no refresh token. Run the flow again for new access.
- A person always decides. Auto-approve rules never apply to these requests.
- The SDKs have no helper for this flow. Use HTTP as shown here.
- Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Before you start

- **May act on behalf of users** is on for the agent (portal: **AI Agents → Agents**, edit the agent).
- The target user has enrolled the LumoAuth mobile app. Organization reviewers can also decide in the approvals inbox.
- Agent-initiated CIBA is allowed in the organization's settings. It is on by default.

## 1. Send the request

`POST {base}/orgs/{orgId}/api/v1/oauth/bc-authorize`, form encoded, authenticated with the agent's own credential.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/bc-authorize \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  --data-urlencode "login_hint=$USER_EMAIL" \
  --data-urlencode "binding_message=Send the Q3 report to the board list" \
  --data-urlencode 'authorization_details={"type":"email_access","actions":["send"],"identifier":"board-list"}' \
  --data-urlencode "requested_expiry=300" \
  --data-urlencode "requested_ttl=300"
```

| Parameter | Required | Notes |
|---|---|---|
| `login_hint` or `id_token_hint` | exactly one | The target user: email or username, or an ID token of that user |
| `authorization_details` | yes | One JSON object (or an array with exactly one). `type` is required. Same validation as JIT requests |
| `binding_message` | recommended | 255 characters at most. Shown to the user as a quoted field. The headline of the prompt is built by LumoAuth from `authorization_details`, not from this text |
| `requested_expiry` | no | Lifetime of the request in seconds. Default 300, 600 at most |
| `requested_ttl` | no | Lifetime of the token in seconds, 60 to 900 |
| `agent_id` | only in the client form | See "Initiating from an OAuth client" |

Rules for the agent credential:

- An agent access token must be a token for LumoAuth's own API. A token whose audience is another resource server (for example an MCP server) and a delegated token (one with an `act` claim) are refused with `401 invalid_client`.
- A DPoP-bound token needs a `DPoP` proof for this request, signed with the same key and carrying `ath`.
- A token that the agent narrowed with `scope` can ask only for `authorization_details` that its scope covers (`403 insufficient_scope` otherwise).
- An `agk_` key works only for an agent of the API key type. An expired key gets `401`.
- The agent's conditional access policies apply. A denied agent gets `401 invalid_client`.

Response:

```json
{ "auth_req_id": "9d1c5f2e6b...", "expires_in": 300, "interval": 5 }
```

The response has the same shape for an unknown user. It does not confirm that the user exists.

An authorization policy that explicitly denies the request rejects it here with `access_denied`.

## 2. The user decides

The target user gets a push prompt and approves or denies on the phone. Reviewers with `jit.approve` see the same request in **AI Agents → Approvals** (filter **Permission requests**) and can decide there. The user's approval is the consent step, so the task is recorded as a consented delegation.

## 3. Poll the token endpoint

The agent that sent the request polls, with the same authentication that it uses for its client credentials grant. Wait at least `interval` seconds between polls.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -d grant_type=urn:openid:params:grant-type:ciba \
  -d auth_req_id="$AUTH_REQ_ID" \
  -d client_id="$AGENT_CLIENT_ID" \
  -d client_secret="$AGENT_CLIENT_SECRET"
```

An agent of the API key type sends `client_id=agk_...` and no secret.

| Response | Meaning | Do |
|---|---|---|
| `{"error": "authorization_pending"}` | No decision yet | Wait `interval` seconds and poll again |
| `{"error": "slow_down"}` | Polling too fast | Increase the wait |
| `{"error": "access_denied"}` | Denied | Stop. Do not run the action |
| `{"error": "expired_token"}` | Nobody decided in time | Stop, or start a new request later |
| `{"error": "invalid_grant"}` | The `auth_req_id` was already used | Each `auth_req_id` yields one token |
| `200` with `access_token` | Approved | Use the token |

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 300,
  "authorization_details": [
    { "type": "email_access", "actions": ["send"], "identifier": "board-list" }
  ],
  "jit_request_id": "jit_5f2e...",
  "task_id": "task_ab12..."
}
```

Minimal Python poll loop (standard library plus `requests`):

```python
import os
import time
from typing import Optional

import requests

TOKEN_URL = "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token"


def wait_for_ciba_token(auth_req_id: str, interval: int, expires_in: int) -> Optional[str]:
    deadline = time.monotonic() + expires_in
    while time.monotonic() < deadline:
        time.sleep(interval)
        response = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "urn:openid:params:grant-type:ciba",
                "auth_req_id": auth_req_id,
                "client_id": os.environ["AGENT_CLIENT_ID"],
                "client_secret": os.environ["AGENT_CLIENT_SECRET"],
            },
            timeout=30,
        )
        body = response.json()
        if response.ok:
            return body["access_token"]
        if body.get("error") == "slow_down":
            interval += 5
        elif body.get("error") != "authorization_pending":
            return None  # access_denied, expired_token, invalid_grant
    return None
```

## The token

In the token, `sub` is the approving user and `permissions.act.sub` is `agent_<agentId>`. `jit` is `true`, and `permissions.authorization_details` holds the approved object. The API that receives it validates it like any JIT token (see "The JIT token" in the HTTP API reference of this skill).

## Initiating from an OAuth client

A CIBA-enabled OAuth client can send the request for an agent: add the client's own authentication and `agent_id=agt_...` to the form. Naming an agent is not enough. The agent must authenticate the same request with its own credential in the `Authorization` header, and it must be the agent that `agent_id` names. Otherwise the answer is `403 unauthorized_client`. The client then polls the token endpoint with its own credentials.

## Audit events

`ciba.agent_initiated`, `ciba.agent_approved`, `ciba.agent_denied`, and `jit.token_issued` when the poll returns the token.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `400 unauthorized_client` | CIBA is not available on the organization's plan | See the pricing matrix |
| `401 invalid_client` | The agent token is bound to another resource, is a delegated token, lacks its DPoP proof, or conditional access denied the agent | Use the agent's own token for LumoAuth's API |
| `403 unauthorized_client` | `agent_id` was sent, but that agent did not authenticate the request | Add the agent's credential in the `Authorization` header |
| `invalid_authorization_details` | More than one object, or `type` missing | Send exactly one object |
| `429 slow_down` on the request | The target user already has too many pending requests, or the agent sends too many | Back off. Do not send repeated prompts |
| The user never sees a prompt | No enrolled phone | Ask the user to enroll the app, or have a reviewer decide in the inbox |
