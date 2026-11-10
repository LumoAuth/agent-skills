---
name: lumoauth-audit-compliance
description: >-
  Works with LumoAuth audit logs and compliance tools: what the audit log records, searching
  it in the portal, the audit log Admin API (filters, pagination, export, statistics,
  retention), the lumo logs CLI commands, streaming audit events to a SIEM or log store
  through log sinks (Splunk, Microsoft Sentinel, Google SecOps, Elastic, OpenSearch, Sumo
  Logic, CloudWatch Logs, Amazon S3 in OCSF, OpenTelemetry OTLP, Datadog, Axiom, Honeycomb,
  BigQuery, Snowflake), the analytics dashboard and API, GDPR tools (data subject requests,
  erasure, consent records, retention, records of processing, sub-processors), organization
  data export, and data residency (US and EU regions). Use when the user asks who did what,
  investigates a sign-in or an admin change, exports or ships logs, connects a SIEM, handles
  a data access or deletion request, sets log retention, or chooses a region. Not for
  webhooks (lumoauth-webhooks) or alert channels (lumoauth-integrations).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth audit logs and compliance tools

Read, export and stream the audit log of a LumoAuth organization, and use the privacy tools that the portal provides. This skill describes the tools. It does not say what a law requires; the user's own counsel decides that.

## When to use

- Find out who did something: a sign-in, a failed sign-in, a role change, an API key, a deleted user.
- Pull audit events into a script, a report or the customer's own admin screen.
- Stream every audit event to a SIEM, a data lake or an observability tool.
- Set how long audit rows are kept.
- Process a data subject request (access, erasure, portability), review consent records, export the records of processing.
- Export all organization data.
- Answer where data is stored (US or EU).

Do not use this skill for:

- Real-time notifications to the customer's app: use `lumoauth-webhooks`.
- Alert channels (Slack, Teams, PagerDuty, Opsgenie, email) for high-risk events: use `lumoauth-integrations`.
- Agent tracing and shared signals: use `lumoauth-agent-governance`.
- Deleting or blocking one user as an admin task: use `lumoauth-users-sessions`.

## Before you start

Ask the user for a value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). The region is fixed when the organization is created. |
| Organization slug (`{orgId}`) | The portal URL: `/orgs/acme-corp/portal/` |
| Admin credential | An API key from `/orgs/{orgId}/portal/settings/api-keys`, or `lumo login --org acme-corp` |

Scopes and permissions:

| Task | API key scope | Permission |
|---|---|---|
| Read audit logs, statistics, retention | `admin:audit:read` | `audit.view` |
| Export audit logs | `admin:audit:read` | `audit.export` |
| Change audit log retention | `admin:settings:write` | `settings.manage` |
| Read analytics | `admin:analytics:read` | `analytics.view` |
| Configure log sinks (portal) | - | `settings.manage` |
| GDPR pages (portal) | - | `gdpr.manage` (`gdpr.dpo` to approve a DPIA) |

Availability of audit export, log sinks (SIEM export) and the Admin API depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

Audit data contains personal data (emails, names, IP ranges). Write exports to a location that the user chose, never to a public path or a repository, and do not paste rows into third-party services.

## Where each task is done

| Task | Portal | Admin API | CLI |
|---|---|---|---|
| Search audit logs | `/orgs/{orgId}/portal/audit-logs` | `GET /admin/audit-logs` | `lumo logs list` |
| One entry in full | **Data** on a row | `GET /admin/audit-logs/{logId}` | `lumo logs get <log-id>` |
| Export | **Export logs** (CSV, up to 100,000 rows) | `GET /admin/audit-logs/export` (up to 10,000 rows) | `lumo logs export` |
| Statistics | Dashboard | `GET /admin/audit-logs/stats` | `lumo logs stats` |
| Retention | `/orgs/{orgId}/portal/gdpr/settings`, **Data retention** | `GET`, `PUT /admin/audit-logs/retention` | `lumo org update --set audit_log_retention_days=...` |
| Stream to a SIEM or log store | `/orgs/{orgId}/portal/integrations/log-sinks` | Portal only | - |
| Analytics | `/orgs/{orgId}/portal/` (Dashboard) | `GET /admin/analytics/*` | - |
| Data subject requests, erasure | `/orgs/{orgId}/portal/gdpr/dsr` | Portal only | - |
| Consent records | `/orgs/{orgId}/portal/gdpr/consent-records` | Portal only | - |
| Records of processing | `/orgs/{orgId}/portal/gdpr/processing-activities` | Portal only | - |
| Sub-processors | `/orgs/{orgId}/portal/gdpr/subprocessors` | Portal only | - |
| Organization data export | `/orgs/{orgId}/portal/data-export` | Portal only | - |

Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`. Where the table says "Portal only", give the user the page to open. Do not invent an endpoint.

## Steps

### 1. Query the audit log

With the CLI (set `LUMO_ORG` and `LUMO_API_KEY`, or sign in with `lumo login`):

```bash
lumo logs list --from 2026-11-01 --to 2026-11-08 --limit 50 -o json
lumo logs list --user <user-id> -o json
lumo logs get 48213 -o json
```

`lumo logs list` flags: `--action`, `--user` (the actor's ID), `--from`, `--to`, `--page`, `--limit`. Use `-o json`: the JSON output has every field of each row.

The API has more filters than the CLI flags. Reach them with `lumo api` (the path is relative to the Admin API) or curl:

```bash
lumo api GET /audit-logs --query eventType=login.failed --query from=2026-11-01 --query limit=100

curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/audit-logs?eventType=role.assigned&from=2026-11-01&to=2026-11-08&page=1&limit=100" \
  -H "Authorization: ApiKey $LUMO_API_KEY"
```

| Filter | Meaning |
|---|---|
| `eventType` | Exact event name, for example `login.failed` |
| `action` | Action name |
| `actorId` (alias `userId`) | ID of the actor. For a user it is the user ID, not the email. |
| `targetType` (alias `resourceType`), `targetId` | The resource that was affected |
| `severity` | `info`, `warning`, `error`, `critical` |
| `ipAddress` | Stored IP value (addresses are stored truncated) |
| `search` | Keyword search |
| `from` (alias `startDate`), `to` (alias `endDate`) | ISO 8601 date or date-time |
| `page`, `limit` | `limit` defaults to 25, maximum 100 |

Response:

```json
{
  "data": [
    {
      "id": 48213,
      "createdAt": "2026-11-07T14:30:00+00:00",
      "eventType": "role.assigned",
      "action": "assign",
      "severity": "info",
      "message": "Role assigned",
      "actorId": "019d6190-9bba-7b5f-a0a5-07a6d10184d2",
      "actorName": "admin@example.com",
      "actorType": "user",
      "authMethod": "session",
      "targetType": "user",
      "targetId": "019d61a4-0c1e-7f33-8d5a-51c6a3b0e9aa",
      "targetName": "jane@example.com",
      "ipAddress": "203.0.113.0/24"
    }
  ],
  "meta": { "total": 904, "page": 1, "limit": 100, "totalPages": 10, "hasNextPage": true, "hasPreviousPage": false },
  "resourceType": "audit_logs"
}
```

`GET /admin/audit-logs/{logId}` adds the detail fields: `status` (success or failure), `statusReason`, `requestId`, `sessionId`, `clientId`, `userAgent`, `geoLocation`, `changes`, `oldValue`, `newValue`, `context` (event metadata) and `durationMs`.

To learn which event names exist in this organization, call `GET /admin/audit-logs/actions`. The common names are in [references/audit-events.md](references/audit-events.md).

### 2. Page through results in code

```ts
// audit.ts — server only. The API key must never reach a browser.
const BASE = process.env.LUMOAUTH_URL ?? "https://app.lumoauth.dev";

export interface AuditEntry {
  id: number;
  createdAt: string;
  eventType: string;
  action: string | null;
  severity: string;
  message: string | null;
  actorId: string | null;
  actorName: string | null;
  actorType: string | null;
  authMethod: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  ipAddress: string | null;
}

export async function* auditEntries(filters: Record<string, string>): AsyncGenerator<AuditEntry> {
  const org = process.env.LUMOAUTH_ORG_ID;
  const key = process.env.LUMOAUTH_API_KEY;
  if (!org || !key) throw new Error("LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY must be set");

  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ ...filters, page: String(page), limit: "100" });
    const res = await fetch(`${BASE}/orgs/${org}/api/v1/admin/audit-logs?${query}`, {
      headers: { Authorization: `ApiKey ${key}` },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`Audit log request failed: ${res.status}`);
    const body = (await res.json()) as { data: AuditEntry[]; meta: { hasNextPage: boolean } };
    yield* body.data;
    if (!body.meta.hasNextPage) return;
  }
}

// Usage: failed sign-ins since a date
// for await (const e of auditEntries({ eventType: "login.failed", from: "2026-11-01" })) { ... }
```

For continuous delivery do not poll this endpoint. Configure a log sink (step 4).

### 3. Export

```bash
lumo logs export --from 2026-10-01 --to 2026-11-01 --export-format csv > audit-2026-10.csv
lumo logs export --from 2026-10-01 --to 2026-11-01 --export-format json > audit-2026-10.json
```

- `GET /admin/audit-logs/export` accepts `format` (`csv` is the API default, `json`), `eventType`, `action`, `from`, `to`. It returns the file itself, with a maximum of 10,000 rows. Split a larger range by date.
- The CLI flag is `--export-format` (default `json`), because `-o` controls the CLI's own output.
- The portal export (**Export logs** on the Audit logs page) contains the whole filtered result up to 100,000 rows.
- Each export is itself recorded as `audit.exported`.

### 4. Stream audit events to a SIEM or log store

Log sinks are configured in the portal. There is no API or CLI for them.

1. Open `/orgs/{orgId}/portal/integrations/log-sinks` (**Integrations → SIEM & log export**).
2. Under **Add a sink**, pick the destination.
3. Fill in **Display name** and the destination fields. The fields per destination are in [references/log-sinks.md](references/log-sinks.md). The user must supply the credentials; ask for them and let the user paste secrets into the portal directly.
4. Turn **Enable this sink** on and click **Create sink**.
5. Open the sink and click **Send test event**. A synthetic `integration.test` event goes through the real pipeline and the result is shown inline.

Destinations: Splunk (HEC), AWS CloudWatch Logs, Microsoft Sentinel, Google SecOps, Elastic / OpenSearch, Sumo Logic, Amazon S3 (OCSF), OpenTelemetry (OTLP/HTTP), generic HTTP (OCSF), Google BigQuery, Snowflake, Datadog, Axiom, Honeycomb.

Behaviour to know:

- Every enabled sink receives every audit event. Several sinks, also of the same kind, are allowed. A failing sink does not block the others.
- Delivery is asynchronous and does not slow the request that caused the event. A failed delivery is retried.
- The endpoint must be a public HTTPS host. Private, loopback and link-local addresses are rejected.
- Client IP addresses are truncated before they leave LumoAuth (IPv4 to /24, IPv6 to /48).
- Secrets are not shown again after saving. On an existing sink, leave a secret field blank to keep the stored value.
- The sink page shows **Delivered**, **Failed**, **Last success** and **Last error**.

### 5. Set audit log retention

```bash
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/audit-logs/retention" \
  -H "Authorization: ApiKey $LUMO_API_KEY"

curl -s -X PUT "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/audit-logs/retention" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays": 365, "autoDelete": true}'
```

- The response is `{ "data": { "retentionDays", "autoDelete", "planLimitDays" } }`. The value in force is capped by the plan (`planLimitDays`).
- `retentionDays` must be an integer. The minimum is 90 days.
- `autoDelete: false` keeps audit rows without deletion. The portal has no switch for it.
- Rows are deleted by a daily job only when the organization has turned on **Enable automated data retention enforcement** in `/orgs/{orgId}/portal/gdpr/settings`, **Data retention**. Each deletion is recorded as `security.audit_log_retention_deletion`.
- Shortening retention deletes history that cannot be restored. Show the user the change and confirm before you run it. If long-term history is needed, set up a log sink first.

### 6. Privacy and data requests

These are portal workflows. Open [references/privacy-tools.md](references/privacy-tools.md) for the click path of each one.

| Request | Tool |
|---|---|
| A person asks for a copy of their data | The person: `/account/data-export`. The admin: a subject request at `/orgs/{orgId}/portal/gdpr/dsr`. |
| A person asks to be deleted | Subject request of type **Erasure (Art. 17)**, then **Execute erasure**. `DELETE /admin/users/{userId}` runs the same erasure. It cannot be undone. |
| Proof of consent | `/orgs/{orgId}/portal/gdpr/consent-records` |
| Record of processing activities | `/orgs/{orgId}/portal/gdpr/processing-activities`, **Export RoPA (JSON)** |
| List of sub-processors | `/orgs/{orgId}/portal/gdpr/subprocessors`, public page https://docs.lumoauth.dev/user-guide/compliance/sub-processors |
| Full export of the organization | `/orgs/{orgId}/portal/data-export`, **Download export** (one JSON file, no secrets) |

After an erasure, the user's audit rows stay but are pseudonymised: emails and names are removed and the rows keep IDs only.

### 7. Data residency

| Region | Base URL |
|---|---|
| United States | `https://app.lumoauth.dev` |
| European Union | `https://eu.app.lumoauth.dev` |

- The two regions are independent. Nothing replicates between them.
- The region is chosen at sign-up and cannot be changed afterwards. Ask the user which region the organization is in before you write any URL.
- Every URL of the organization uses the region's base URL: issuer, discovery document, Admin API, SCIM, the CLI (`LUMO_BASE_URL`) and the SDK configuration. A request to the wrong region does not find the organization.
- User records, sessions, application configuration, audit logs, signing keys and backups stay in the region. Email, SMS and log sinks go to the providers that the organization configures, in the regions of those providers.

## Verify

- `lumo logs list --limit 1 -o json` returns a row. A `403` with `details.required_scopes` means that the key lacks `admin:audit:read`.
- Do a test action (for example a failed sign-in), then query `eventType=login.failed`. The new row appears.
- For a sink: **Send test event** shows success, **Delivered** increases, and the `integration.test` event is visible in the destination.
- For retention: `GET /admin/audit-logs/retention` returns the new `retentionDays`.
- For an export: the row count matches `meta.total` of the same filter (when it is under the export maximum).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Filter by email returns nothing | `actorId` takes the user ID | Look the user up first (`lumo users get <email>`), or use `search` |
| Filter name ignored | Snake case (`event_type`) | Parameters are camelCase: `eventType`, `actorId`, `targetType` |
| Export stops at 10,000 rows | API export maximum | Split by date range, or use the portal export or a sink |
| `403` on export only | Missing `audit.export` permission, or the plan lacks audit export | Grant the permission; check the plan |
| A sink shows **Failed** | Wrong token, wrong URL, or a private address | Read **Last error** on the sink, fix, **Send test event** |
| IPs in the SIEM end in `.0/24` | IPs are truncated before storage and delivery | Expected; correlate on `requestId` or session fields |
| Old rows were not deleted | Automated retention enforcement is off | Turn it on in GDPR settings |
| Searching for a `status` filter in the list API | `status` is a detail field | Filter by `eventType` (for example `login.failed`) or read `status` from the detail entry |
| Saved SIEM rule for `password_reset_requested` no longer matches | The event is named `password_reset.requested` | Update the rule |
| Requests to `app.lumoauth.dev` return not found for an EU organization | Wrong region | Use `https://eu.app.lumoauth.dev` |
| Looking for an API to file a data subject request | Subject requests are a portal workflow | Send the user to `/orgs/{orgId}/portal/gdpr/dsr` |

## Related skills

- `lumoauth-admin-api`: API keys, scopes, pagination, rate limits.
- `lumoauth-cli`: install and sign in to `lumo`.
- `lumoauth-webhooks`: push selected events to the customer's app.
- `lumoauth-integrations`: alert channels for high-risk events, and the other integrations.
- `lumoauth-users-sessions`: delete, block and sign out users.
- `lumoauth-agent-governance`: agent activity, tracing and shared signals.

## References

- [Audit log API and CLI](references/audit-log-api.md): open it for every endpoint, the entry fields, actor attribution and the CLI flags.
- [Audit event names](references/audit-events.md): open it when you need the event name to filter on, or the risk level of an event.
- [Log sinks](references/log-sinks.md): open it when you configure a SIEM or log store and need the fields and event format of a destination.
- [Privacy tools, data export, analytics](references/privacy-tools.md): open it for subject requests, erasure, consent, retention, records of processing, sub-processors, organization export and the analytics API.
- https://docs.lumoauth.dev/user-guide/compliance/audit-logs
- https://docs.lumoauth.dev/api-reference/audit-logs
- https://docs.lumoauth.dev/integrations/siem-log-export
- https://docs.lumoauth.dev/user-guide/integrations/observability
- https://docs.lumoauth.dev/user-guide/compliance/gdpr
- https://docs.lumoauth.dev/user-guide/compliance/data-residency
- https://docs.lumoauth.dev/tracks/compliance
