# Operating LumoAuth webhooks

Open this file to read delivery logs, replay deliveries, rotate the signing secret, or call
the webhook endpoints of the Admin API.

## Delivery lifecycle

| Status | Meaning |
|---|---|
| `pending` | Queued, or replayed and not yet attempted |
| `success` | The receiver answered with a status below 400 |
| `failed` | The last attempt failed; another attempt is scheduled (`next_attempt_at`) |
| `dead_lettered` | Every attempt failed. No further attempt is made until someone replays the delivery |

An attempt fails when the receiver answers 400 or higher, does not answer within 5 seconds,
or cannot be reached. Redirects are not followed. After a failed attempt the next one comes
after 60 seconds, then 5 minutes, 30 minutes, 2 hours, 12 hours and 24 hours. Every attempt
of one delivery carries the same delivery ID and a fresh timestamp and signature.

A webhook is not disabled when its deliveries fail. Watch the log, and disable a webhook
whose endpoint is gone.

## Read the log

```bash
lumo webhooks deliveries list 42 -o json
lumo webhooks deliveries list 42 --status dead_lettered --limit 100 -o json
lumo webhooks deliveries get 42 5f2b8c1d9e3a4f607182a3b4c5d6e7f8 -o json
```

`--status` takes `pending`, `success`, `failed` or `dead_lettered`. `--limit` is at most
200; the default is 50. The list is the most recent deliveries; it has no page parameter.

One entry:

```json
{
  "id": "0192a3f4-1111-7000-8000-000000000000",
  "webhook_id": 42,
  "delivery_id": "5f2b8c1d9e3a4f607182a3b4c5d6e7f8",
  "event_name": "user.created",
  "status": "failed",
  "attempt_count": 2,
  "last_status_code": 500,
  "last_response_body": "Internal Server Error",
  "last_error": null,
  "next_attempt_at": "2026-11-10T10:35:00+00:00",
  "succeeded_at": null,
  "dead_lettered_at": null,
  "created_at": "2026-11-10T10:00:00+00:00",
  "updated_at": "2026-11-10T10:05:00+00:00"
}
```

The list response also has `meta.count` and `meta.dead_lettered_count`. The detail response
(`deliveries get`) adds `payload` (the `data` object that was sent) and `attempts` (one
entry per attempt with `at`, `status_code` and `error`).

How to read a failure:

| Observation | Likely cause |
|---|---|
| `last_status_code` 401 | The receiver rejected the signature: wrong secret, or the body was not verified as raw bytes |
| `last_status_code` 404 or 405 | The URL path or method of the route is wrong |
| `last_status_code` 5xx | The handler threw. Read the app's logs for the delivery ID |
| `last_status_code` null with `last_error` | No HTTP answer: timeout, DNS, TLS, or the URL now resolves to a private address |
| `attempt_count` grows on events that the app did process | The handler answers too slowly. Enqueue first, answer, then process |

In the portal the same log is under **Integrations**, **Webhooks**, the webhook's actions
menu, **Deliveries** (`/orgs/{orgId}/portal/integrations/webhooks/{id}/deliveries`).

## Replay

```bash
lumo webhooks deliveries replay 42 5f2b8c1d9e3a4f607182a3b4c5d6e7f8 -o json
```

Replay resets the delivery to `pending` and queues it again with the same delivery ID and
the same payload. The attempt history is kept. Show the command to the user first.

A receiver that deduplicates on the delivery ID answers 200 and skips a replay of a
delivery that it already stored. That is the correct result for a delivery that failed
after the app had stored it. To force a second processing run, remove the ID from the app's
deduplication store first.

To replay every dead-lettered delivery of one webhook after a fix:

```bash
lumo webhooks deliveries list 42 --status dead_lettered --limit 200 -o json \
  | jq -r '.data[].delivery_id' \
  | while read -r id; do lumo webhooks deliveries replay 42 "$id" -o json; done
```

## Rotate the signing secret

The secret of a webhook can be replaced in two ways. They differ in who chooses the new
value, and that decides the order of the steps.

**Portal: the admin enters the new value (no failed deliveries).**

1. Generate the new value: `openssl rand -hex 32`.
2. Deploy the receiver with both values accepted: the new one in
   `LUMOAUTH_WEBHOOK_SECRET`, the old one in `LUMOAUTH_WEBHOOK_SECRET_PREVIOUS`.
3. In the portal, open the webhook, **Edit**, and enter the new signing secret.
4. Check that new deliveries have status `success`.
5. Remove the old value from the receiver.

**Admin API: LumoAuth generates the new value.**

```bash
lumo api POST /webhooks/42/rotate-secret -o json
```

The response returns the new secret once, in `data.secret`. From that moment every delivery
is signed with the new secret only, and `kid` in the signature header is `v2`.

1. Show the command to the user, run it, and move `data.secret` into the secret store
   without printing it.
2. Deploy the receiver with the new value.
3. Deliveries that arrived between step 1 and step 2 were rejected by the receiver with
   401. LumoAuth retries them on the schedule above; the first retry comes after 60
   seconds. To speed that up, replay the `failed` deliveries.

`kid` states only whether the secret was ever rotated (`v1`: never, `v2`: at least once).
It does not identify one of several secrets. A receiver that holds two secrets must try
both, as the receivers in this skill do.

Rotate at once when the secret may have leaked (it was committed, logged or pasted into a
chat).

## Enable, disable, change, delete

```bash
lumo api POST /webhooks/42/disable -o json
lumo api POST /webhooks/42/enable -o json
lumo webhooks update 42 --events user.created,user.deleted -o json   # replaces the event list
lumo webhooks update 42 --url https://app.example.com/webhooks/lumoauth-v2 -o json
lumo webhooks delete 42 -o json
```

A disabled webhook receives nothing, and events that occur while it is disabled are not
queued for it. Show each of these commands to the user before you run it.

## Admin API endpoints

All paths are relative to `{base}/orgs/{orgId}/api/v1/admin`. Send
`Authorization: ApiKey <key>` or `X-API-Key: <key>`, or an OAuth access token with the
scope (or the blanket `admin` scope).

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/webhooks` | `admin:webhooks:read` | List. Query: `page`, `limit`, `isActive`, `event`, `sortBy` (`createdAt`, `isActive`), `sortDir` |
| GET | `/webhooks/events` | `admin:webhooks:read` | Event catalogue |
| GET | `/webhooks/{webhookId}` | `admin:webhooks:read` | One webhook |
| POST | `/webhooks` | `admin:webhooks:write` | Create. Body: `url`, `events` (required), `isActive`, `type`. Returns `data.secret` once |
| PUT, PATCH | `/webhooks/{webhookId}` | `admin:webhooks:write` | Update `url`, `events`, `isActive`, `type` |
| POST | `/webhooks/{webhookId}/enable` | `admin:webhooks:write` | Enable |
| POST | `/webhooks/{webhookId}/disable` | `admin:webhooks:write` | Disable |
| DELETE | `/webhooks/{webhookId}` | `admin:webhooks:write` | Delete |
| POST | `/webhooks/{webhookId}/rotate-secret` | `admin:webhooks:write` | New signing secret, returned once |
| POST | `/webhooks/{webhookId}/test` | `admin:webhooks:write` | Test request (see below) |
| GET | `/webhooks/{webhookId}/deliveries` | `admin:webhooks:read` | Delivery log. Query: `status`, `limit` |
| GET | `/webhooks/{webhookId}/deliveries/{deliveryId}` | `admin:webhooks:read` | One delivery with `payload` and `attempts` |
| POST | `/webhooks/{webhookId}/deliveries/{deliveryId}/replay` | `admin:webhooks:write` | Replay |

A webhook object: `id` (an integer), `url`, `url_masked`, `events`, `type`, `isActive`,
`failureCount`, `createdAt`, `lastTriggeredAt`. The secret is never returned after
creation or rotation.

`type` is `custom` (the default: the signed JSON described in this skill), `slack`,
`discord` or `teams`. The three chat types send a formatted message for that product
instead of the JSON envelope; their URL carries its own credential and is shown masked
(`url_masked: true`) in list and get responses. For chat alerts, use `lumoauth-integrations`.

## The Admin API test request is different

`POST /webhooks/{webhookId}/test` sends a request that does not follow the delivery format:

| | Delivery (and **Send test event** in the portal) | `POST .../test` |
|---|---|---|
| Event name | the subscribed event, or `webhook.test` | `test.webhook` |
| Signature header | `X-LumoAuth-Signature: kid=..,t=..,id=..,v1=..` | `X-Webhook-Signature: <hex HMAC-SHA256>` |
| Signed bytes | `<t>.<id>.<raw body>` | the raw body only |
| Other headers | `X-LumoAuth-Event`, `X-LumoAuth-Timestamp`, `X-LumoAuth-Delivery` | `X-Webhook-Event: test.webhook` |
| In the delivery log | yes for events; the portal test is sent directly | no |

A receiver that verifies `X-LumoAuth-Signature` answers 401 to this request, and the API
reports `{"success": false, "statusCode": 401}`. That result does not mean that real
deliveries fail. Use the API test only to check that the URL is reachable. To check the
signature path, use **Send test event** in the portal or trigger a real event. Do not add
support for `X-Webhook-Signature` to the receiver: that request has no timestamp and no
delivery ID, so it has no replay protection.

## URL rules

LumoAuth checks the URL when the webhook is created, updated and tested, and again before
every delivery:

- The scheme must be `https`.
- The URL must not contain a user name or password.
- The host must resolve to public addresses only. `localhost`, private ranges, link-local
  and loopback addresses are refused. One private AAAA record is enough for a refusal.

The Admin API answers HTTP 400 with "Webhook URL must not point to a private or internal
address". For a machine inside a private network, use `lumo tunnel` during development and
a public reverse proxy in production.

## Local development with `lumo tunnel`

```bash
lumo tunnel --to http://localhost:3000/webhooks/lumoauth-dev --filter user.created
```

- The tunnel receives every event of the organization; `--filter` drops other event names
  in the CLI. Other webhooks of the organization still get their deliveries.
- The CLI waits up to 30 seconds for the local handler.
- Events that occur while the tunnel is not connected are not forwarded later.
- Two `lumo tunnel` processes are two tunnels; each event goes through both.
- The stream reconnects on its own; a line `stream dropped ... reconnecting in 2s` is normal.
- Stop the process with Ctrl+C so that it removes its temporary webhook. If a webhook with a
  `tunnel://` URL remains in `lumo webhooks list`, delete it.
- Use a sandbox organization for experiments when the plan includes it:
  `lumo dev start` (see the `lumoauth-cli` skill).
