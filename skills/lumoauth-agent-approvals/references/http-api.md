# Approvals HTTP API

Open this file when no SDK fits, when you debug a request, or when you build the API side of the flow (the `Insufficient-Authorization-Details` signal, a reviewer app).

All paths are under `{base}/orgs/{orgId}/api/v1`. Examples use `https://app.lumoauth.dev` and `acme-corp`.

## Credentials

| Caller | Credential | Used for |
|---|---|---|
| Agent | `Authorization: Bearer <agent access token>`, or `Authorization: Bearer agk_...` for an agent of the API key type | Tasks, permission requests, status, token exchange, task completion, push approval |
| JIT token | `Authorization: Bearer <JIT token>` | Only the status of, and the completion of, its own task. Everything else: `401 invalid_token` or `403 jit_principal_not_allowed` |
| Human reviewer | Browser session, or a user access token with the `jit:approve` scope | `GET /jit/pending`, `POST /jit/approve/{id}`, `POST /jit/deny/{id}` |

Agent credentials never create a session. Send the credential on every request. Get an agent token with the client credentials grant (see `lumoauth-agent-identity`):

```bash
AGENT_TOKEN=$(curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -d grant_type=client_credentials \
  -d client_id="$AGENT_CLIENT_ID" \
  -d client_secret="$AGENT_CLIENT_SECRET" | jq -r .access_token)
```

A token that the agent requested with a `scope` that covers only part of its capabilities is "narrowed". A narrowed token can request and redeem only permissions that its scope covers (`403 insufficient_scope` otherwise), and it cannot send push approval prompts.

## JIT permissions

### Create a task

`POST /jit/task` returns `201`.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/jit/task \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Close ticket 4812", "type": "support"}'
```

| Body field | Notes |
|---|---|
| `name`, `type` | Optional labels. Reviewers see them |
| `parent_task_id` | Optional, for nested tasks |
| `on_behalf_of` | Optional email of the user that the task acts for. Needs **May act on behalf of users** on the agent. Not needed when the agent authenticates with a delegation token: the user is read from the token |

```json
{
  "task_id": "task_a1b2c3d4e5f6g7h8",
  "caep_session_id": "caep_xyz789",
  "expires_at": "2026-01-30T15:00:00Z",
  "agent_id": "agt_0123456789abcdef",
  "agent": { "agent_id": "agt_0123456789abcdef", "name": "Support Bot" },
  "on_behalf_of": null,
  "delegation_consent_required": false
}
```

Two ways for a task to act for a user:

| How the user was established | `delegation_consent_required` | Effect on permission requests |
|---|---|---|
| The agent authenticated with a delegation token (token exchange; `sub` is the user, `act.sub` is the agent). See `lumoauth-agent-delegation` | `false` | Normal handling: low-risk requests are approved automatically, auto-approve rules apply |
| The agent named the user in `on_behalf_of` | `true` | Always a human decision. The named user consents (no `jit.approve` needed), or a reviewer with `jit.approve` overrides. When the request also needs review for another reason, the user's consent is recorded and a reviewer still decides |

An unknown, inactive or blocked user in `on_behalf_of` returns `400 invalid_request`.

### Request a permission

`POST /jit/request` returns `201`.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/jit/request \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_a1b2c3d4e5f6g7h8",
    "authorization_details": {
      "type": "api_call",
      "actions": ["DELETE"],
      "identifier": "https://api.example.com/v1/tickets/4812"
    },
    "justification": "The customer asked to delete ticket 4812",
    "requested_ttl": 300,
    "callback_url": "https://agent.example.com/hooks/jit"
  }'
```

| Body field | Required | Notes |
|---|---|---|
| `task_id` | yes | A live task of this agent |
| `authorization_details` | yes | One object. `type` is required. `type` and `identifier` are strings; `actions`, `privileges`, `locations` and `datatypes` are lists of non-empty strings |
| `justification` | no | Text for the reviewer, 1,000 characters at most |
| `requested_ttl` | no | Integer seconds for the token lifetime. Default 600, allowed 60 to 900. The SDKs send 300 unless told otherwise |
| `callback_url` | no | Public HTTPS URL. LumoAuth posts the decision to it |

Approved at once:

```json
{
  "request_id": "jit_abc123xyz",
  "status": "approved",
  "risk_level": "low",
  "task_id": "task_a1b2c3d4e5f6g7h8",
  "token_url": "/orgs/acme-corp/api/v1/jit/request/jit_abc123xyz/token",
  "granted_ttl": 300
}
```

Waiting for a person:

```json
{
  "request_id": "jit_def456uvw",
  "status": "pending",
  "risk_level": "high",
  "task_id": "task_a1b2c3d4e5f6g7h8",
  "status_url": "/orgs/acme-corp/api/v1/jit/request/jit_def456uvw/status",
  "expires_at": "2026-01-30T14:05:00Z",
  "delegation_consent_required": false,
  "message": "Request requires human approval. Poll status_url or wait for callback."
}
```

A request that an authorization policy explicitly denies comes back with `status: "denied"`, `has_notes` and `agent_message`. It is not sent to a reviewer.

Common authorization types: `file_access`, `api_call`, `database_query`, `tool_invocation`, `payment`, `user_data`. The type is free text, but `payment`, `user_data`, `credentials` and `admin_action` are critical types: a person always decides. Type and action names compare without regard to case, `-` and `:` (`User-Data` is `user_data`).

### Poll the status

`GET /jit/request/{request_id}/status`

`status` is `pending`, `approved`, `denied`, `expired`, `used` (the approval was exchanged for its token) or `revoked`. `approved` adds `token_url` and `granted_ttl`. `pending` adds `expires_at` and `delegation_consent_required`. Every decided request adds `has_notes` (boolean) and `agent_message` (string or `null`). Reviewer notes and denial reasons are not returned; only the message that a reviewer wrote for the agent is.

Poll every few seconds, not in a tight loop. The endpoint is rate limited per agent.

The `callback_url` receives a JSON `POST` with `request_id`, `status`, `task_id`, `granted_ttl`, `has_notes`, `agent_message` and `timestamp`. Treat it as a signal and read the status endpoint before acting on it.

### Exchange the approval for a JIT token

`POST /jit/request/{request_id}/token` (no body)

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 300,
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "authorization_details": [
    { "type": "api_call", "actions": ["DELETE"], "identifier": "https://api.example.com/v1/tickets/4812" }
  ],
  "task_id": "task_a1b2c3d4e5f6g7h8",
  "jit_request_id": "jit_abc123xyz"
}
```

One approval yields one token. `expires_in` never passes the end of the task.

### Complete the task

`POST /jit/task/{task_id}/complete` (no body) revokes the JIT tokens of the task and retires approvals that were never exchanged.

```json
{ "task_id": "task_a1b2c3d4e5f6g7h8", "status": "completed", "completed_at": "2026-01-30T14:20:00+00:00" }
```

### Errors on the agent endpoints

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | Missing `task_id` or `authorization_details`, malformed details, task not active, bad `callback_url`, unusable `on_behalf_of` user. `error_description` says which |
| 400 | `invalid_authorization_details` | `authorization_details.type` is missing |
| 401 | `invalid_token` | No valid agent credential, or a JIT token on an endpoint that needs the agent credential |
| 403 | `access_denied` | The task or request belongs to another agent, or the agent may not act for users |
| 403 | `insufficient_scope` | A narrowed agent token asked for, or tried to redeem, a permission outside its scope |
| 403 | `jit_principal_not_allowed` | A JIT token acted on a task that is not its own |
| 403 | `authorization_pending` | Token exchange before the request was approved. `error_description` carries the status |
| 403 | `request_not_redeemable` | The approval can no longer become a token: exchanged too late, task completed or suspended, agent or organization inactive, or the on-behalf-of user deactivated. Request again |
| 404 | `request_not_found`, `task_not_found` | Unknown id in this organization |
| 429 | `rate_limit_exceeded` | Too many calls. Honour `Retry-After` when present |
| 429 | `access_denied` with "Agent budget exceeded" | The agent's budget policy is spent |

Errors are flat: `{"error": "...", "error_description": "..."}`.

## The JIT token

The JIT token is a JWT signed with the organization's signing key.

| Claim | Value |
|---|---|
| `iss` | The organization issuer, `https://app.lumoauth.dev/orgs/acme-corp/api/v1` |
| `aud` | The organization slug |
| `sub` | `agent_<agentId>` when the agent acts for itself (the owner's user id is in `owner`). The user's id when the task acts for a user |
| `jit` | `true` |
| `task_id`, `jti`, `iat`, `nbf`, `exp` | Task binding, token id and times |
| `permissions.authorization_details` | A list with the approved object |
| `permissions.task_id`, `permissions.jit_request_id`, `permissions.risk_level`, `permissions.agent_id` | Context of the grant |
| `permissions.act.sub` | `agent_<agentId>`, present when the task acts for a user |

An API that accepts JIT tokens must verify the signature against the organization's JWKS, check `iss`, `exp` and `jit`, and enforce `permissions.authorization_details` against the request (type, action, identifier). `lumoauth-api-protection` covers JWKS retrieval and JWT checks.

## Telling the agent which permission is missing

An API can state the exact permission that a request needs. Agents and the SDK escalation helpers read this signal and request that permission.

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_authorization_details"
Insufficient-Authorization-Details: eyJ0eXBlIjoiYXBpX2NhbGwiLCJhY3Rpb25zIjpbIkRFTEVURSJdfQ==
Content-Type: application/json

{
  "error": "insufficient_authorization_details",
  "error_description": "Token lacks required permission",
  "authorization_details_hint": { "type": "api_call", "actions": ["DELETE"] }
}
```

The header value is the base64 encoding of one `authorization_details` JSON object. On the agent side: decode the header, send the object to `POST /jit/request`, exchange the approval, and retry once with the JIT token.

## Push approval

### Create a request

`POST /agents/me/approvals`

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/agents/me/approvals \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "wire-INV-7741",
    "reason": "Wire $4,500 to Bluepeak Supplies for invoice INV-7741",
    "impact": "high",
    "on_behalf_of": "'"$APPROVER_EMAIL"'",
    "meta": {"amount": 4500, "invoice": "INV-7741"}
  }'
```

| Body field | Required | Notes |
|---|---|---|
| `task_id` | yes | Your identifier for the action, 128 characters at most |
| `reason` | yes | Text on the approver's phone, 480 characters at most |
| `on_behalf_of` | yes | The approver: email address or user id |
| `impact` | no | `low`, `medium` (default), `high`, `critical` |
| `meta` | no | Object. Each key and value is shown as a row on the phone |

| HTTP | Body | Meaning |
|---|---|---|
| 201 | `approval_token`, `status: "pending"`, `expires_at`, `task_id`, `impact` | A prompt was sent. Poll the status. The token is returned only here |
| 202 | `status: "email_fallback_sent"`, `message`, `task_id`, `impact` | No prompt was sent: the user has no enrolled phone, or is not a user of this organization. Nothing to poll. Not an approval |
| 400 | `invalid_json`, `invalid_task_id`, `invalid_reason`, `invalid_impact`, `on_behalf_of_required` | Bad input |
| 403 | `agent_token_required`, `delegation_not_permitted`, `insufficient_scope`, `test_token_not_accepted` | Not an agent, agent may not act for users, narrowed token, or portal test token |
| 428 | `no_enrolled_device` | No enrolled phone, and the email notice could not be sent |
| 429 | `rate_limited` | Too many prompts from this agent to this user |

### Poll the status

`GET /agents/me/approvals/{approval_token}/status`

```json
{
  "approval_token": "…",
  "status": "approved",
  "task_id": "wire-INV-7741",
  "impact": "high",
  "reason": "Wire $4,500 to Bluepeak Supplies for invoice INV-7741",
  "responded_at": "2026-01-30T14:01:12+00:00",
  "approved_by": { "user_id": 42 }
}
```

`status` is `pending`, `approved`, `denied` or `expired`. `approved_by` is `null` unless the status is `approved`. Only the agent that created the request can read it. The approval token identifies the request; it is not an access token for another API.

## Reviewer endpoints

A person calls these, never an agent. Agent tokens, `agk_` keys, JIT tokens and delegated tokens are refused. For a reviewer app of your own, allow the `jit:approve` scope on the client and request `scope=openid jit:approve`.

| Endpoint | Body | Result |
|---|---|---|
| `GET /jit/pending` | none | `pending_requests` (also under `data`) and `count`. Each entry has `request_id`, `agent_id`, `agent_name`, `task_id`, `authorization_details`, `justification`, `risk_level`, `on_behalf_of`, `requested_ttl`, `created_at`, `expires_at`, `delegation_consent_required`, `your_consent_required` |
| `POST /jit/approve/{request_id}` | optional `ttl` (integer, 900 at most), `notes` (internal), `agent_message` (500 characters at most, relayed to the agent) | `{"request_id": "...", "status": "approved", "granted_ttl": 300}` |
| `POST /jit/deny/{request_id}` | optional `reason` (internal), `agent_message` | `{"request_id": "...", "status": "denied"}` |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/jit/approve/jit_def456uvw \
  -H "Authorization: Bearer $REVIEWER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Approved for ticket 4812", "agent_message": "Approved once."}'
```

| HTTP | `error` | Cause |
|---|---|---|
| 401 | `invalid_token`, `authentication_required` | Not a human session or user token |
| 403 | `forbidden` | The user token lacks the `jit:approve` scope |
| 403 | `insufficient_permissions` | The user lacks the `jit.approve` permission or belongs to another organization |
| 403 | `access_denied` | The user may not use this agent, or consent was recorded and a reviewer must still decide |
| 404 | `request_not_found` | Unknown request id |
| 400 | `invalid_request` | Not pending, expired, caller owns the agent, or caller is the on-behalf-of user of a token-backed delegation |
| 429 | `rate_limit_exceeded` | Too many reviewer calls |

The scope is written `jit:approve`; the permission is written `jit.approve`.

## Webhooks

Organization webhooks can deliver `jit.approval_required` (a request waits for a person; the payload includes `authorization_details`, `risk_level`, `on_behalf_of`, `delegation_consent_required` and a summary), `jit.request.approved` and `jit.request.denied`. Use `lumoauth-webhooks` for endpoints and signature verification.
