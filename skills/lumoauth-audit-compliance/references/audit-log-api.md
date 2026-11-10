# Audit log API and CLI

All paths are relative to `{base}/orgs/{orgId}/api/v1`. `{base}` is `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Authenticate with `Authorization: ApiKey lmk_...` or `X-API-Key: lmk_...`, from a server only.

## Endpoints

| Method | Path | Permission | Scope | Purpose |
|---|---|---|---|---|
| GET | `/admin/audit-logs` | `audit.view` | `admin:audit:read` | List with filters and pagination |
| GET | `/admin/audit-logs/{logId}` | `audit.view` | `admin:audit:read` | One entry with detail fields. `{logId}` is an integer. |
| GET | `/admin/audit-logs/stats` | `audit.view` | `admin:audit:read` | Counts by event type, action and severity |
| GET | `/admin/audit-logs/actions` | `audit.view` | `admin:audit:read` | The distinct actions and event types that this organization has recorded |
| GET | `/admin/audit-logs/export` | `audit.export` | `admin:audit:read` | Download as CSV or JSON |
| GET | `/admin/audit-logs/retention` | `audit.view` | `admin:audit:read` | Read retention settings |
| PUT, PATCH | `/admin/audit-logs/retention` | `settings.manage` | `admin:settings:write` | Change retention settings |

For an API key, the user who created the key must still hold the permission. Export also depends on the organization's plan.

## List

Query parameters:

| Parameter | Alias | Description |
|---|---|---|
| `page` | | Page number, default 1 |
| `limit` | | Rows per page, default 25, maximum 100 |
| `eventType` | | Exact event type, for example `user.login` |
| `action` | | Action |
| `actorId` | `userId` | The actor's ID |
| `targetType` | `resourceType` | Type of the affected resource |
| `targetId` | | ID of the affected resource |
| `severity` | | `info`, `warning`, `error`, `critical` |
| `ipAddress` | | Source IP as stored |
| `search` | | Keyword search across the entry |
| `from` | `startDate` | Start of the range, ISO 8601 |
| `to` | `endDate` | End of the range, ISO 8601 |

A date value that cannot be parsed is ignored, and the request then returns unfiltered dates. Check the format when a range seems to have no effect.

Response envelope:

```json
{
  "data": [],
  "meta": { "total": 904, "page": 1, "limit": 25, "totalPages": 37, "hasNextPage": true, "hasPreviousPage": false },
  "resourceType": "audit_logs"
}
```

## Entry fields

List rows:

| Field | Description |
|---|---|
| `id` | Integer ID |
| `createdAt` | ISO 8601 time when the row was written |
| `eventType` | Event name, for example `role.assigned` |
| `action` | Action |
| `severity` | Severity of the event |
| `message` | Human-readable message |
| `actorId`, `actorName`, `actorType` | Who did it. `actorType` is `user`, `api_key`, `agent`, `scim` or `system`. |
| `authMethod` | How the actor authenticated: `session`, `api_key`, `bearer`, `scim`, `agent` or `system` |
| `targetType`, `targetId`, `targetName` | The resource that was affected |
| `ipAddress` | Source IP, truncated (IPv4 to /24, IPv6 to /48) |

`GET /admin/audit-logs/{logId}` adds:

| Field | Description |
|---|---|
| `eventTime` | Time of the event |
| `durationMs` | Duration, when recorded |
| `initiatedBy` | What started the action |
| `clientId` | The application, when a token was used |
| `userAgent`, `geoLocation` | Request metadata |
| `sessionId` | Stored as a keyed hash, not the real session ID |
| `requestId` | Shared by all rows that one request wrote. Use it to group rows. |
| `status`, `statusReason` | Result (success or failure) and the reason |
| `changes` | The raw change set |
| `oldValue`, `newValue` | Before and after values taken from `changes` |
| `context` | Event-specific metadata, for example `method`, `reason`, `api_key_id`, `actor_owner_id` |

## Actor attribution

| Caller | `actorType` | `actorId` / `actorName` | Also in `context` |
|---|---|---|---|
| Browser session or user access token | `user` | The user | `oauth_client_id` for tokens |
| Organization API key | `api_key` | The key's ID and name | `api_key_id`, `actor_owner_id` (the creator of the key) |
| AI agent | `agent` | The `agent_id` and name | `actor_owner_id` (the owner of the agent) |
| SCIM provisioning | `scim` | - | `actor_owner_id` when the SCIM token maps to a user |
| Background job | `system` | - | - |

Tokens that appear in URL paths (reset, magic link, invitation and consent links) are stored as `[REDACTED]`.

Failure rows for credentials and `403` responses are limited to one per credential, route and event per minute. A burst of failed requests therefore produces fewer rows than requests.

## Statistics

`GET /admin/audit-logs/stats?from=2026-11-01&to=2026-11-08`

```json
{
  "data": {
    "total": 1280,
    "period": { "from": "2026-11-01T00:00:00+00:00", "to": "2026-11-08T00:00:00+00:00" },
    "byEventType": { "user.login": 640, "login.failed": 22 },
    "byAction": {},
    "bySeverity": { "info": 1250, "warning": 30 }
  }
}
```

## Export

`GET /admin/audit-logs/export?format=csv&from=2026-10-01&to=2026-11-01`

| Parameter | Values | Default |
|---|---|---|
| `format` | `csv`, `json` | `csv` |
| `eventType`, `action` | As in the list | - |
| `from` / `startDate`, `to` / `endDate` | ISO 8601 | - |

- The response body is the file (`Content-Disposition: attachment`), not a JSON envelope.
- Maximum 10,000 rows per request. The other list filters (`actorId`, `targetId`, `severity`, `search`) do not apply to the export.
- The export is recorded as `audit.exported`.

```bash
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/audit-logs/export?format=csv&from=2026-10-01&to=2026-11-01" \
  -H "Authorization: ApiKey $LUMO_API_KEY" \
  -o audit-2026-10.csv
```

## Retention

```json
{ "data": { "retentionDays": 730, "autoDelete": true, "planLimitDays": 730 } }
```

| Field | Description |
|---|---|
| `retentionDays` | Days that audit rows are kept. Send an integer. Minimum 90, maximum 3650, capped by `planLimitDays`. Default 730. |
| `autoDelete` | `false` stops deletion of audit rows |
| `planLimitDays` | Read-only. The maximum that the organization's plan allows. |

The portal field for the same value is **Audit log retention (days)** in `/orgs/{orgId}/portal/gdpr/settings`, section **Data retention** (click **Save GDPR settings**). Deletion runs daily and only for organizations that have **Enable automated data retention enforcement** switched on.

## CLI

```text
lumo logs list [--action <action>] [--user <actor-id>] [--from <date>] [--to <date>] [--page N] [--limit N]
lumo logs get <log-id>
lumo logs stats [--from <date>] [--to <date>]
lumo logs export [--from <date>] [--to <date>] [--export-format json|csv]
```

- Aliases of `logs`: `audit-logs`, `audit`.
- `lumo logs export` writes the raw file to stdout. Redirect it to a file. Its default format is `json`.
- Use `-o json` with `lumo logs list` to get every field.
- For the filters that have no flag (`eventType`, `targetType`, `targetId`, `severity`, `search`, `ipAddress`), use `lumo api`:

```bash
lumo api GET /audit-logs --query eventType=api_key.created --query from=2026-11-01
lumo api GET /audit-logs/actions
lumo api GET /audit-logs/retention
lumo api PUT /audit-logs/retention --data '{"retentionDays": 365}'
```

Credentials: `LUMO_ORG` and `LUMO_API_KEY` in the environment (plus `LUMO_BASE_URL=https://eu.app.lumoauth.dev` for an EU organization), or a profile from `lumo login`.

## Portal

**Audit logs** in the sidebar (`/orgs/{orgId}/portal/audit-logs`):

- Filters: **Actor**, **Search**, **Event type**, **Status**, **Severity**, **From** / **To**. Click **Apply filters**; **Clear** resets them.
- **Data** on a row opens **Log entry metadata** with the full context of the event.
- **Export logs** downloads the whole filtered result as CSV, up to 100,000 rows. It needs the `audit.export` permission.
