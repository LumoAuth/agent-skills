---
name: lumoauth-webhooks
description: >-
  Receives LumoAuth webhook events in an application. Covers creating a webhook endpoint
  (portal, Admin API, `lumo webhooks create`), choosing events from the event catalogue
  (user.created, user.login, user.deleted, mfa.*, role.assigned, client.*, token.*,
  organization.*, agent.*, jit.*), verifying the HMAC-SHA256 signature in the
  X-LumoAuth-Signature header (with X-LumoAuth-Timestamp and X-LumoAuth-Delivery) in Node.js,
  Python, Go and PHP with standard libraries only, replay protection, fast acknowledgement
  with asynchronous processing, retries, delivery logs and replay with
  `lumo webhooks deliveries`, signing secret rotation, and local development with
  `lumo tunnel`. Use when the user asks to add a LumoAuth webhook handler, sync users to a
  database on user.created, react to sign-in or MFA events, verify a webhook signature, fix
  "signature mismatch" or failed and dead-lettered deliveries, or test webhooks on localhost.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth webhooks

Add an HTTPS endpoint to the user's application that receives LumoAuth events, proves that
each request came from LumoAuth, acknowledges it within the time limit and processes it
once. LumoAuth sends a JSON `POST` for every subscribed event and signs it with HMAC-SHA256
and a secret that only the organization and the receiver hold.

## When to use

- The app must react to something that happens in LumoAuth: a user is created, updated,
  blocked or deleted; a sign-in succeeds or fails; an MFA factor changes; a role is
  assigned; an agent is registered; a JIT request needs approval.
- A webhook handler exists but rejects requests, misses events or processes them twice.
- The user wants to test webhooks on a local machine.

Do not use this skill for:

- Reading the history of events on demand: use audit logs (`lumoauth-audit-compliance`).
- Streaming logs to a SIEM, or alerts to Slack, Teams or PagerDuty: use
  `lumoauth-integrations`.
- Shared Signals (SSF/CAEP) streams: use `lumoauth-agent-governance`.

## Before you start

| Value | Where it comes from |
|---|---|
| Organization slug and region base URL | Ask the user. `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Public HTTPS URL of the receiver | The deployed app, for example `https://app.example.com/webhooks/lumoauth`. LumoAuth refuses `http://`, `localhost` and private addresses |
| Events to subscribe to | Ask the user what the app must react to; map it to names in [references/events.md](references/events.md) |
| Signing secret | Returned once when the webhook is created (step 3). Store it in the app's secret store |
| A credential for the organization | Only when you create the webhook from the terminal: `lumo login`, or an API key with `admin:webhooks:write` |

Ask the user for a value that you cannot find. Never guess one. Show the user every command
that creates, changes or deletes a webhook before you run it.

The signing secret is a server-side secret. Never put it in browser or mobile code, in the
repository, or in a log.

## How a delivery looks

```http
POST /webhooks/lumoauth HTTP/1.1
Content-Type: application/json
User-Agent: LumoAuth-Webhook/1.0
X-LumoAuth-Event: user.created
X-LumoAuth-Timestamp: 1762768800
X-LumoAuth-Delivery: 5f2b8c1d9e3a4f607182a3b4c5d6e7f8
X-LumoAuth-Signature: kid=v1,t=1762768800,id=5f2b8c1d9e3a4f607182a3b4c5d6e7f8,v1=53e3e9d0...

{"event":"user.created","timestamp":"2026-11-10T10:00:00+00:00","tenant":"acme-corp","data":{...}}
```

| Part | Meaning |
|---|---|
| `event` (body), `X-LumoAuth-Event` | Event name |
| `tenant` (body) | Organization slug |
| `data` (body) | Event-specific fields |
| `X-LumoAuth-Delivery`, `id=` | Delivery ID. The same ID is sent again on every retry of this delivery. It is not in the body |
| `X-LumoAuth-Timestamp`, `t=` | Unix time in seconds when this attempt was signed |
| `v1=` | Hex HMAC-SHA256 over the bytes `<t>.<id>.<raw request body>`, keyed with the signing secret as a UTF-8 string |
| `kid=` | `v1` until the secret is rotated for the first time, `v2` after that |

The signed payload is the timestamp, a dot, the delivery ID, a dot and the request body
exactly as received. A handler that parses the JSON and serializes it again computes a
different HMAC.

## Steps

### 1. Add the verification function

TypeScript on Node.js, standard library only. For another language, open the receiver
with the same behaviour: [references/receiver-python.md](references/receiver-python.md),
[references/receiver-go.md](references/receiver-go.md) or
[references/receiver-php.md](references/receiver-php.md).

```ts
// lumoauth-webhook.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface LumoAuthDelivery {
  deliveryId: string;
  signedAt: number;
  event: string;
  tenant: string;
  data: Record<string, unknown>;
}

export class WebhookVerificationError extends Error {}

/**
 * Verifies the X-LumoAuth-Signature header of one delivery.
 * rawBody must be the request body exactly as received (not parsed and re-serialized).
 */
export function verifyLumoAuthWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secrets: string[],
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): LumoAuthDelivery {
  if (secrets.length === 0) {
    throw new WebhookVerificationError("no signing secret configured");
  }
  if (!signatureHeader) {
    throw new WebhookVerificationError("missing X-LumoAuth-Signature header");
  }

  // Header format: kid=v1,t=<unix seconds>,id=<delivery id>,v1=<hex HMAC-SHA256>
  const fields = new Map<string, string>();
  for (const part of signatureHeader.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) fields.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const t = fields.get("t") ?? "";
  const id = fields.get("id") ?? "";
  const v1 = fields.get("v1") ?? "";
  if (!/^\d{1,12}$/.test(t) || id === "" || !/^[0-9a-f]{64}$/.test(v1)) {
    throw new WebhookVerificationError("malformed X-LumoAuth-Signature header");
  }

  const signedAt = Number(t);
  if (Math.abs(now - signedAt) > toleranceSeconds) {
    throw new WebhookVerificationError("timestamp outside the tolerance window");
  }

  // Signed payload: "<t>.<id>." followed by the raw body bytes.
  const signedPayload = Buffer.concat([Buffer.from(`${t}.${id}.`, "utf8"), rawBody]);
  const given = Buffer.from(v1, "hex");
  let valid = false;
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(signedPayload).digest();
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      valid = true;
    }
  }
  if (!valid) {
    throw new WebhookVerificationError("signature mismatch");
  }

  const envelope = JSON.parse(rawBody.toString("utf8")) as {
    event: string;
    tenant: string;
    data: Record<string, unknown>;
  };
  return { deliveryId: id, signedAt, event: envelope.event, tenant: envelope.tenant, data: envelope.data ?? {} };
}
```

Rules that the function enforces. Keep them when you adapt it:

- Compare with a constant-time function (`timingSafeEqual`), never with `===`.
- Use the secret string as it is. Do not hex-decode or base64-decode it.
- Reject a timestamp that is too far from the server clock (here 300 seconds).
- Parse the JSON only after the signature is valid.

### 2. Add the endpoint: verify, deduplicate, enqueue, acknowledge

The complete receiver for Node.js (`server.ts`: body size limit, verification, an
in-memory queue and a worker loop) is in
[references/receiver-node.md](references/receiver-node.md). Copy it, then replace the
in-memory queue and the in-memory set of delivery IDs with the app's own storage. Its core
is four lines:

```ts
const delivery = verifyLumoAuthWebhook(rawBody, signatureHeader, secrets); // throws on failure
if (!(await alreadySeen(delivery.deliveryId))) {
  await enqueue(delivery); // store the event and the delivery ID; do not process here
}
res.writeHead(200, { "Content-Type": "application/json" }).end('{"received":true}');
```

`secrets` is the current signing secret, plus the previous one while a rotation is in
progress. The reference reads them from `LUMOAUTH_WEBHOOK_SECRET` and
`LUMOAUTH_WEBHOOK_SECRET_PREVIOUS`; use the project's own names if it has a convention.

In a framework, the only hard part is the raw body. Read the bytes before any JSON parser:

| Framework | Raw body |
|---|---|
| Express | `app.post("/webhooks/lumoauth", express.raw({ type: "application/json" }), handler)`; `req.body` is a `Buffer`. Register the route before `express.json()` |
| Next.js route handler | `Buffer.from(await request.arrayBuffer())` |
| FastAPI | `await request.body()` |
| Flask | `request.get_data()` |
| Go `net/http` | `io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))` |
| Laravel, Symfony | `$request->getContent()` |

What the endpoint must do:

- **Acknowledge fast.** LumoAuth waits 5 seconds for the response. Return a 2xx status as
  soon as the event is stored in a queue or a table; do the work in a worker.
- **Return 2xx for a duplicate** and for an event name that the app does not handle. A 4xx
  or 5xx status, a timeout or a connection error counts as a failed attempt and is retried.
- **Do not redirect.** Redirects are not followed.
- **Return 401 for a failed verification** and log the reason, never the secret or the
  full signature.

### 3. Create the webhook in the organization

Show the command to the user first. With the CLI:

```bash
RESP=$(lumo webhooks create \
  --url https://app.example.com/webhooks/lumoauth \
  --events user.created,user.updated,user.deleted \
  -o json)
echo "$RESP" | jq '.data | {id, url, events, isActive}'
```

The response holds the signing secret once, in `data.secret`. Move it straight into the
secret store that the user names, without printing it. For a local environment file that is
ignored by version control:

```bash
printf 'LUMOAUTH_WEBHOOK_SECRET=%s\n' "$(echo "$RESP" | jq -r '.data.secret')" >> .env.local
unset RESP
```

With the Admin API (the same response shape):

```bash
curl -sS -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/webhooks" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://app.example.com/webhooks/lumoauth","events":["user.created","user.updated","user.deleted"]}'
```

The Admin API generates the secret. A `secret` field in the request body is ignored.

In the portal: **Integrations** (`/orgs/{orgId}/portal/integrations`), section **Webhooks**,
**Add webhook**. Choose the channel **Custom webhook**, enter the endpoint URL, select the
events, and enter a **Signing secret**. In the portal the secret is a value that the admin
types, and the field is optional: a webhook that is saved without a secret is delivered
without any `X-LumoAuth-*` header, and the receiver above rejects it. Generate a random
value of at least 32 bytes (for example `openssl rand -hex 32`) and enter it.

Subscribe only to the events that the app handles. `"*"` subscribes to every event. The
number of event types per webhook can depend on the organization's plan (see
https://docs.lumoauth.dev/pricing-matrix).

### 4. Replay protection

Two checks, both in the code above:

1. **Timestamp.** Reject a request whose `t` differs from the server clock by more than the
   tolerance. Every attempt, including a retry, is signed with a fresh timestamp.
2. **Delivery ID.** Store each accepted `id` and skip an ID that was seen before. Retries of
   one delivery can arrive up to about 39 hours after the first attempt, so keep IDs for at
   least two days.

An in-memory set of IDs is lost on restart and is not shared between instances.
In production use one of:

- a database table with a unique column for the delivery ID, written in the same
  transaction as the queued event;
- a key with an expiry in a shared cache, set only if absent.

Also make the worker idempotent on the business key (for example "upsert user by
`target_id`"). One fact can arrive as two deliveries with different IDs: a sign-up through a
mailed link sends `user.signup_completed`, `user.created` and `user.email_verified`.

### 5. Develop on a local machine

LumoAuth does not deliver to `localhost`. `lumo tunnel` forwards the organization's events
to a local URL:

```bash
lumo tunnel --to http://localhost:3000/webhooks/lumoauth-dev --filter user.created
```

A forwarded request is not a production delivery: the body is only the event's `data`
object, the event name is in `X-LumoAuth-Event`, the delivery ID is in
`X-LumoAuth-Delivery`, and there is no `X-LumoAuth-Signature` or `X-LumoAuth-Timestamp`
header. Do not weaken the production route for it. Add a second route that exists only
outside production, builds the same event object from the two headers and the body, and
feeds the same queue.

The route (`dev-route.ts`) is in [references/receiver-node.md](references/receiver-node.md).

Test the signature path separately with the values in
[references/test-vector.md](references/test-vector.md), and end to end
against a deployed HTTPS URL (a preview deployment works).

### 6. Operate: delivery log, replay, rotation

```bash
lumo webhooks deliveries list 42 --status failed -o json
lumo webhooks deliveries get 42 5f2b8c1d9e3a4f607182a3b4c5d6e7f8 -o json   # attempts, last response, payload
lumo webhooks deliveries replay 42 5f2b8c1d9e3a4f607182a3b4c5d6e7f8 -o json
```

A failed attempt is retried after 60 seconds, 5 minutes, 30 minutes, 2 hours, 12 hours and
24 hours. After that the delivery is `dead_lettered` and stays in the log, where it can be
replayed. The webhook stays enabled when deliveries fail.

Read [references/operations.md](references/operations.md) for the delivery fields, the
rotation procedure for the signing secret, every Admin API endpoint, and the differences of
the test delivery.

## Verify

1. Unit test: the verification function accepts the test vector in
   `references/test-vector.md` and rejects it with a wrong secret, a changed body
   and an old timestamp.
2. In the portal, open the webhook's actions menu and choose **Send test event**. The
   receiver gets a signed `webhook.test` event and answers 200.
3. Trigger a real event (for example create a test user) and check
   `lumo webhooks deliveries list <webhook-id> -o json`: the newest entry has
   `"status": "success"` and `"attempt_count": 1`.
4. Send the same request twice (replay it with `deliveries replay`): the app processes the
   event once and answers 200 both times.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Every delivery fails with `signature mismatch` | The handler hashed re-serialized JSON, or a body parser consumed the stream | Verify the raw bytes; see the framework table |
| `signature mismatch` although the raw body is used | Only the body was hashed | Hash `<t>.<id>.<raw body>` |
| `signature mismatch` after copying the secret | The secret was hex-decoded, has a trailing newline, or belongs to another webhook | Use the string as shown at creation; trim whitespace when loading it |
| Requests have no `X-LumoAuth-Signature` header | The webhook was created in the portal without a signing secret, or the request comes from `lumo tunnel` | Set a secret under **Edit**; use the development route for the tunnel |
| `POST /admin/webhooks/{id}/test` reports `success: false` with status 401 | That Admin API test request is signed differently (see `references/operations.md`) | Use **Send test event** in the portal, or a real event |
| HTTP 400 "must not point to a private or internal address" on create | The URL is `http://`, `localhost`, or resolves to a private address (check AAAA records too) | Use a public `https` URL; use `lumo tunnel` for local work |
| Deliveries time out and repeat | The handler does the work before it answers | Enqueue, answer 2xx, process in a worker |
| An event is processed twice | No deduplication on the delivery ID, or the worker is not idempotent | Step 4 |
| All deliveries fail right after a secret rotation | The receiver still holds only the old secret | Add the new secret, then replay the failed deliveries |
| `--status delivered` returns HTTP 400 | The status of a delivered event is `success` | `--status success` |
| HTTP 403 `plan_limit_reached` on create or update | The plan limits event types per webhook, and `*` counts as over the limit | Subscribe to fewer event names |

## Related skills

- `lumoauth-cli`: `lumo webhooks`, `lumo tunnel` and `lumo api` flags.
- `lumoauth-admin-api`: API keys, scopes and error format for the webhook endpoints.
- `lumoauth-users-sessions`: the user fields behind `user.*` events.
- `lumoauth-agent-approvals`: what to do with `jit.approval_required`.
- `lumoauth-audit-compliance`: the audit log, which holds the same events for later reads.

## References

- [references/events.md](references/events.md): open to choose event names and to read
  the fields of `data`.
- [references/receiver-node.md](references/receiver-node.md): the complete Node.js
  receiver, an Express variant, and the development route for `lumo tunnel`.
- [references/receiver-python.md](references/receiver-python.md),
  [references/receiver-go.md](references/receiver-go.md),
  [references/receiver-php.md](references/receiver-php.md): open for a receiver in that
  language.
- [references/test-vector.md](references/test-vector.md): open when you write the unit
  test of the verification function.
- [references/operations.md](references/operations.md): open for delivery logs, replay,
  secret rotation, the Admin API endpoints and scopes.
- https://docs.lumoauth.dev/user-guide/integrations/webhooks
- https://docs.lumoauth.dev/api-reference/webhooks
- https://docs.lumoauth.dev/cli/tunnel
