# Shared signals (SSF, CAEP, RISC) and the Agent activity dashboard

Open this file to send security events about agents to another system, to build the receiver for them, to let another identity system stop agents in LumoAuth, or to read the Agent activity dashboard.

LumoAuth implements the OpenID Shared Signals Framework (SSF) 1.0 in both directions:

- **Transmitter**: LumoAuth pushes signed security event tokens (SETs) with CAEP events to the receivers that you configure.
- **Receiver**: LumoAuth accepts SETs with CAEP and RISC events from other transmitters and acts on them.

What is not implemented, so do not build on it: updating a stream through the API, a per-stream status endpoint, and adding or removing subjects of a stream. Outbound delivery is push only. Recreate a stream to change it through the API, or edit it in the portal.

Portal page for both directions: **AI Agents → Agent activity → Security signals**, `/orgs/{orgId}/portal/agent-guard/security-signals`. Viewing needs `agents.view` and `webhooks.view` (as `GET /ssf/stream` does). Creating, changing or verifying a stream needs `settings.manage`, in the portal and with `POST /ssf/stream`, `DELETE /ssf/stream` and `POST /ssf/verify`.

## Sending events (transmitter)

### Discovery

No authentication is needed:

```bash
curl -s https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/ssf-configuration
```

```json
{
  "spec_version": "1_0",
  "issuer": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "jwks_uri": "https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/jwks.json",
  "delivery_methods_supported": ["urn:ietf:rfc:8935"],
  "configuration_endpoint": "https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/stream",
  "verification_endpoint": "https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/verify",
  "events_supported": [
    "https://schemas.openid.net/secevent/caep/event-type/session-revoked",
    "https://schemas.openid.net/secevent/caep/event-type/token-claims-change",
    "https://schemas.openid.net/secevent/caep/event-type/assurance-level-change"
  ]
}
```

SETs are signed with the organization's signing key. The `issuer` in SETs is always this organization issuer, also when the organization uses a custom domain.

### Create a stream in the portal

1. On the **Streams (outbound)** tab, click **Create stream**.
2. **Delivery endpoint**: the receiver's public HTTPS URL. One signed token arrives in each `POST`.
3. **Audience**: how the receiver names itself. It becomes the `aud` claim of every SET.
4. **Bearer token**: sent as `Authorization: Bearer ...` on every delivery. It is required unless you tick **This endpoint accepts unauthenticated deliveries**. Generate a long random value and store it in the receiver's secret store.
5. **Events to send**: "Agent session revoked", "Agent permission revoked" and "Agent downgraded by governance" are selected for a new stream. "User credential changed" and "Device compliance changed" are optional.
6. Click **Create stream**, then **Send verification** on the new stream.

A stream's actions also offer **Edit…**, **Pause** / **Enable** and delete. A paused stream receives nothing.

### Create a stream with the API

The stream endpoints accept the same admin credentials as the Admin API. An API key needs the scope `admin:webhooks:write` to create, verify and delete, and `admin:webhooks:read` to read. Show the user the command before you run it.

```bash
curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/stream \
  -H "X-API-Key: $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "delivery": {
      "method": "urn:ietf:rfc:8935",
      "endpoint_url": "https://receiver.example.com/events",
      "authorization_token": "'"$RECEIVER_BEARER"'"
    },
    "audience": "https://receiver.example.com",
    "events_requested": [
      "https://schemas.openid.net/secevent/caep/event-type/session-revoked",
      "https://schemas.openid.net/secevent/caep/event-type/token-claims-change"
    ]
  }'
```

- `endpoint_url` must be a public HTTPS URL. Private and internal addresses are refused.
- `authorization_token` is stored encrypted and never returned.
- `events_requested` is required. `events_delivered` in the `201` response is the subset that LumoAuth supports.
- The response carries the generated `stream_id` (`ssf_...`).

```bash
# All streams, or one
curl -s https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/stream -H "X-API-Key: $LUMOAUTH_API_KEY"
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/stream?stream_id=$STREAM_ID" -H "X-API-Key: $LUMOAUTH_API_KEY"

# Send a verification event
curl -s -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/verify \
  -H "X-API-Key: $LUMOAUTH_API_KEY" -H "Content-Type: application/json" \
  -d '{"stream_id": "'"$STREAM_ID"'", "state": "check-1"}'

# Delete
curl -s -X DELETE "https://app.lumoauth.dev/orgs/acme-corp/api/v1/ssf/stream?stream_id=$STREAM_ID" \
  -H "X-API-Key: $LUMOAUTH_API_KEY"
```

### Events that LumoAuth sends

Event type URIs start with `https://schemas.openid.net/secevent/`.

| Event type | Sent when | Subject (`sub_id`) |
|---|---|---|
| `caep/event-type/session-revoked` | An agent leaves `active` (suspended, deactivated or revoked) | `iss_sub`: `iss` is the organization issuer, `sub` is the agent id (`agt_...`) |
| `caep/event-type/session-revoked` | Continuous access evaluation suspends a JIT task | `opaque`: the CAEP session id of the task (`caep_...`). The payload carries `task_id` and `agent_id` |
| `caep/event-type/token-claims-change` | One JIT permission is revoked | `opaque`: the JIT token id (`jti`). The payload carries `task_id` and `agent_id` |
| `caep/event-type/assurance-level-change` | The dormancy job deactivates an agent | `iss_sub` with the agent id. Levels `active` → `dormant-deactivated` in the namespace `https://lumoauth.dev/assurance/agent` |
| `caep/event-type/credential-change`, `caep/event-type/device-compliance-change` | An inbound signal forced a password change or reported a compliance change | The user |
| `ssf/event-type/verification` | On request | `opaque`: the stream id. The payload echoes `state` |

An event is sent only when at least one enabled stream subscribes to its type. Deliveries are asynchronous and retried with backoff. Each attempt is audited as `ssf.set_delivered` or `ssf.set_delivery_failed`.

### Build the receiver

Rules for the endpoint:

1. Accept `POST` with `Content-Type: application/secevent+jwt`. The body is the SET, a compact JWT.
2. Check the bearer token of the stream in constant time.
3. Verify the signature against the transmitter's `jwks_uri`. Require the header `typ` to be `secevent+jwt`, `iss` to equal the transmitter `issuer`, and `aud` to equal your audience.
4. Deduplicate on `jti`. A redelivery reuses the same `jti`.
5. Answer `202 Accepted` as soon as the SET is stored. Any answer outside 2xx is retried. Answer `400` with an `err` code only for a SET that you will never accept.
6. Act on the event after the answer: for `session-revoked` with an agent subject, drop that agent's sessions and refuse its tokens. Agent access tokens carry the agent id in `client_id`.

```ts
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://app.lumoauth.dev/orgs/acme-corp/api/v1';
const AUDIENCE = 'https://receiver.example.com';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const SESSION_REVOKED = 'https://schemas.openid.net/secevent/caep/event-type/session-revoked';

const seen = new Set<string>();           // use a shared store with an expiry in production
const revokedAgents = new Set<string>();  // consult this where you validate agent tokens

function bearerOk(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${process.env.RECEIVER_BEARER ?? ''}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const app = express();

app.post('/events', express.text({ type: 'application/secevent+jwt' }), async (req, res) => {
  if (!bearerOk(req.headers.authorization)) {
    res.status(401).end();
    return;
  }
  try {
    const { payload } = await jwtVerify(req.body, JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      typ: 'secevent+jwt',
    });
    const jti = String(payload.jti ?? '');
    if (jti === '') {
      throw new Error('missing jti');
    }
    if (!seen.has(jti)) {
      seen.add(jti);
      const subject = payload.sub_id as { format?: string; sub?: string } | undefined;
      const events = (payload.events ?? {}) as Record<string, unknown>;
      if (SESSION_REVOKED in events && subject?.format === 'iss_sub' && subject.sub) {
        revokedAgents.add(subject.sub); // agt_...
      }
    }
    res.status(202).end();
  } catch (error) {
    res.status(400).json({ err: 'invalid_request', description: String(error) });
  }
});

app.listen(8443);
```

Do not log the SET or the bearer token.

## Receiving events (receiver)

Use this when Okta, Microsoft Entra, Google, an EDR or an MDM should be able to end sessions or stop agents in LumoAuth.

### Add a receiver in the portal

1. On the **Receivers (inbound)** tab, click **Add receiver**.
2. Pick the **Transmitter** preset. The dialog asks only for what the preset cannot derive, for example the Okta org subdomain or the Entra directory id.
3. Check the **Audience**: the `aud` value that the transmitter must put in every event.
4. Choose **How events name the user**: by email address, by provider subject, by provider subject strictly, or by phone number.
5. Choose **Delivery**: push (the transmitter sends each event to LumoAuth) or poll (LumoAuth asks the transmitter for new events on a schedule; enter the poll URL and bearer).
6. Tick the **Events to act on** and click **Create receiver**.
7. Copy the push endpoint and the bearer, which is shown once, into the transmitter's console. **Rotate bearer** in the receiver's actions issues a new one.

The push endpoint has the form `{base}/orgs/{orgId}/hooks/ssf/{streamId}`. The transmitter sends `Content-Type: application/secevent+jwt` and `Authorization: Bearer <bearer of the stream>`.

A link with `?tab=receivers&preset=okta` opens the dialog for a preset. Preset keys: `okta`, `entra`, `google_risc`, `duo`, `ping`, `jamf`, `crowdstrike`, `generic`.

| Preset | You enter |
|---|---|
| Okta (Identity Threat Protection) | The org subdomain or custom login host |
| Microsoft Entra ID | The directory (tenant) id |
| Google RISC (Cross-Account Protection) | Nothing; users are matched by Google subject to a linked identity |
| Cisco Duo, Ping Identity, Jamf, CrowdStrike, Generic | Issuer and JWKS URL from the vendor console |

### What LumoAuth does with an inbound event

LumoAuth verifies each SET before acting: token type, an asymmetric signature against the transmitter's keys, issuer, audience, freshness, and a `jti` that was not seen on this stream. A repeated `jti` is acknowledged and ignored.

| Event | Action |
|---|---|
| CAEP `session-revoked`, RISC `sessions-revoked` | Revokes the user's sessions and tokens. **Suspends every agent that the user owns** (kill switch). Sends CAEP `session-revoked` on your outbound streams |
| CAEP `credential-change`, RISC `credential-compromise` | Requires a password change, revokes sessions and tokens, sends CAEP `credential-change` onward |
| RISC `account-disabled` | Deactivates the user and revokes sessions and tokens |
| RISC `account-enabled` | Reactivates the user, only when a signal had disabled the account |
| CAEP `device-compliance-change` | Stored as a risk signal and sent onward. No revocation |
| CAEP `assurance-level-change`, RISC `account-purged`, `identifier-changed` | Stored as a risk signal. No immediate action |
| SSF `verification` | Marks the stream as verified |

**Agent subjects.** A subject that does not match a user is tried as an agent of the organization: an `iss_sub` subject whose `iss` is the stream issuer, an `opaque` subject or a bare `sub` that carries the public agent id (`agt_...`) or the identifier of a linked AAuth registration. A revocation event aimed at an agent (CAEP `session-revoked` or `credential-change`; RISC `sessions-revoked`, `credential-compromise` or `account-disabled`) suspends that agent through the kill switch. Other event types are recorded only. Reactivation stays a human decision.

A subject that matches neither a user nor an agent is stored as *ignored*.

Every inbound event is audited (`ssf.receiver.*`) and listed under **Recent events** on the tab.

Answers of the push endpoint: `202` accepted, `400` with `err` (`invalid_request`, `invalid_key`, `access_denied`) and a `description`, `401` for a bad bearer or an unknown stream, `429` when the stream sends too fast.

Tell the user about the side effect before enabling a receiver: a session revocation for a person at the other system suspends that person's agents in LumoAuth, and each must be reactivated by an admin.

## The Agent activity dashboard (CAEP dashboard)

Portal: **AI Agents → Agent activity**, `/orgs/{orgId}/portal/caep-dashboard`. Select the last 24 hours, 7 days or 30 days. Each tile compares the period with the one before it. Each chart has a **View as table** link.

| Tile | Use it to answer |
|---|---|
| Agent tasks | How many tasks did agents start, complete, and still run? |
| JIT requests | How many permission requests were raised, granted and denied? |
| Pending approval | Is someone waiting for a reviewer now, and for how long? Links to the Approvals inbox |
| CAEP flagged | How many tasks did continuous access evaluation flag? |
| Approval rate | Which share of decided requests was granted, and how many by an auto-approve rule? |
| Time to decision | How long do reviewers take? |
| Average task risk | Is risk across tasks rising? |

Below the tiles: tasks by status (active, completed, suspended, terminated), task risk bands, task types, the busiest agents, high-risk agents, a weekday-by-hour heatmap, JIT requests by outcome (approved, used, denied, pending, expired, revoked), requested permission types and actions, and recent CAEP events.

| Observation | Check |
|---|---|
| Many suspended or terminated tasks | The **Activity** section of the agent's page |
| Many JIT denials | The agent's capabilities, and whether the agent asks for things that it should not need |
| A rise in pending requests | Whether reviewers get their notifications (`lumoauth-agent-approvals`) |
| A high share of requests approved by rules | Whether the auto-approve rules are still narrow |
| No task activity | Whether the agent is active and uses the JIT API at all |

The page of one agent (`/orgs/{orgId}/portal/agents/{agentId}`) has an **Activity** section with the timeline of its tasks, JIT requests and audit events, with a time range filter.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No **Create stream** or **Add receiver** button | The user lacks `settings.manage` | Grant it through a role |
| "The delivery endpoint must be a public HTTPS URL" | The endpoint is private, loopback or not HTTPS | Use a public HTTPS host. A tunnel works for testing |
| The verification event never arrives | The endpoint answered outside 2xx | Read the `ssf.set_delivery_failed` audit event for the status that the endpoint returned |
| The receiver rejects the signature | It uses the wrong JWKS, or checks `iss` against a custom domain | Use `jwks_uri` and `issuer` from the discovery document |
| Inbound SET answered `400 invalid_key` | The signature could not be verified against the transmitter's JWKS | Check the JWKS URL of the receiver configuration |
| Inbound SET answered `400` naming a claim | Issuer or audience mismatch, for example an Okta custom login host entered as the org subdomain | Correct the receiver configuration |
| Inbound SET answered `202` but nothing happened | The subject did not match a user or an agent | See the event as *ignored* under **Recent events**; fix the subject mapping |
| Agents were suspended unexpectedly | A user session revocation arrived for their owner | Reactivate the agents after review; decide whether the receiver should act on that event type |
