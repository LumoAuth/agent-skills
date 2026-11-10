# Log sinks: stream audit events to a SIEM or log store

A log sink sends every audit event of the organization to one destination, in near real time. Sinks are configured in the portal only: `/orgs/{orgId}/portal/integrations/log-sinks` (**Integrations → SIEM & log export**). The page needs the `settings.manage` permission. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Common setup

1. Open the page and pick a destination under **Add a sink**.
2. Enter a **Display name** and the destination fields from the table below.
3. Turn **Enable this sink** on. Click **Create sink**.
4. Open the sink and click **Send test event**. The result, or the provider's error message, is shown inline.

Ask the user for the destination values. Let the user paste secrets into the portal form; do not ask for them in the conversation, and do not write them to a file.

Rules that apply to every destination:

- The endpoint must be a public HTTPS host. Loopback, private, link-local and cloud-metadata addresses are rejected when the sink is saved and before each delivery. Redirects are not followed. A request times out after 10 seconds.
- Each enabled sink receives each event independently. A failed delivery is retried with back-off.
- Client IP addresses are truncated before delivery (IPv4 to /24, IPv6 to /48).
- A secret field is never shown again after saving. Leave it blank on an existing sink to keep the stored value.
- The sink row shows **Delivered**, **Failed**, **Last success** and **Last error**. An error is cleared by the next successful delivery or by saving the configuration.
- Changes to sinks are audited: `log_sink.created`, `log_sink.updated`, `log_sink.enabled`, `log_sink.disabled`, `log_sink.deleted`.

## Destinations

| Destination | Form fields (optional ones in brackets) | Preparation on the destination |
|---|---|---|
| **Splunk** | **HEC endpoint URL** (for example `https://prd-p-xxxxx.splunkcloud.com:8088`; the path is added automatically), **HEC token**, [**Index**], [**Source**], [**Sourcetype**, default `lumoauth:audit`] | Create an HTTP Event Collector token. |
| **AWS CloudWatch Logs** | **AWS region**, **Log group name**, **Log stream name** (default `audit`), **Access key ID**, **Secret access key**, [**Session token** for temporary credentials], [**Custom endpoint**] | The log group must exist. The log stream is created when it is missing. IAM on the log group: `logs:PutLogEvents`, `logs:CreateLogStream`, `logs:DescribeLogStreams`. |
| **Microsoft Sentinel** | **Entra tenant ID**, **Application (client) ID**, **Client secret**, **Data collection endpoint**, **DCR immutable ID**, **Stream name** | Create a custom table (for example `LumoAuthAudit_CL`) and a Data Collection Rule whose stream is `Custom-LumoAuthAudit_CL`. Grant the app registration **Monitoring Metrics Publisher** on the rule. |
| **Google SecOps (Chronicle)** | **Chronicle region**, **Customer ID**, **Log type** (upper case, for example `LUMOAUTH`), **Service account key (JSON)** | Register a JSON parser for the log type. |
| **Elastic / OpenSearch** | **Cluster URL**, **Authentication** (API key or basic), **API key or user:password**, **Index or data stream** (default `logs-lumoauth.audit-default`) | The credential needs write access to the index or data stream. |
| **Sumo Logic** | **HTTP source URL**, [**Source category**], [**Source name**], [**Source host**] | Create a hosted HTTP Logs source. The URL contains the collector token, so treat it as a secret. |
| **Amazon S3 (OCSF)** | **Bucket name**, **AWS region**, [**Key prefix**], **Access key ID**, **Secret access key**, [**Session token**], [**Custom endpoint** for S3-compatible stores] | IAM: `s3:PutObject` on the prefix. |
| **OpenTelemetry (OTLP/HTTP)** | **Collector endpoint** (events go to `{url}/v1/logs`), [**service.name**], [**Extra headers**], [**Authorization header**] | A collector or vendor endpoint that accepts OTLP/HTTP JSON logs. |
| **Generic HTTP (OCSF)** | **Endpoint URL**, [**Static headers**], [**Authorization header**], **Body shape** (the bare object or an `{"events": [...]}` envelope) | An endpoint that accepts `POST` with a JSON body. |
| **Google BigQuery** | **Project ID**, **Dataset**, **Table**, **Service account key (JSON)** | Create the table first (schema in the docs page below). The service account needs permission to insert rows. |
| **Snowflake** | **Account identifier** (locator such as `xy12345.eu-west-1`, or `myorg-myaccount`), **User**, **Database**, **Schema**, **Table**, [**Warehouse**], [**Role**], **Private key (PEM)**, [**Private key passphrase**] | Create the table and set the user's `RSA_PUBLIC_KEY` (key-pair authentication). |
| **Datadog** | **Datadog site** (US1, EU, US3, US5 or custom), [**Custom intake URL**], **API key** with logs-intake permission, [**Service name**], [**Environment tag**], [**Extra tags** as `key:value`] | - |
| **Axiom** | **Axiom API domain** (`api.axiom.co` by default), **Dataset**, **API token** with ingest permission on the dataset | Create the dataset. |
| **Honeycomb** | **Dataset**, **Region** (US or EU), **Ingest API key** | - |

Datadog, Axiom and Honeycomb also appear as cards in the **Observability** section of the Integrations page (`/orgs/{orgId}/portal/integrations`). **Set up** on a card opens the same sink form.

Every form also has **Display name** and **Enable this sink**. If a form asks for a value that is not in this table, ask the user for it.

## Event formats

| Format | Destinations | Shape |
|---|---|---|
| LumoAuth JSON | Splunk, CloudWatch Logs, Sentinel, Google SecOps, Elastic / OpenSearch, Sumo Logic, BigQuery, Snowflake | Flat document: `@timestamp`, `message`, `event.{type,action,outcome,severity,reason}`, `tenant.{id,slug}`, `actor.{id,name,type}`, `target.{type,id,name}`, `source.{ip,geo}`, `http.{user_agent,method,url}`, `trace.{correlation_id,session_id,request_id}`, `error`, `metadata`, `changes` |
| OCSF 1.3 | Amazon S3, generic HTTP | Class 3002 Authentication for sign-in, sign-out, MFA and SSO events; 3001 Account Change for user, password and MFA enrollment changes; 6003 API Activity for the rest. Original fields are under `unmapped`. |
| OTLP/HTTP JSON | OpenTelemetry | One `logRecord` per event, with `severityNumber`, the message as body and attributes such as `event.name`, `enduser.id`, `client.address`, `http.request.method`, `url.full`, `session.id` |

Destination details:

- Sentinel rows carry `TimeGenerated` plus the LumoAuth JSON fields.
- S3 objects are written as one JSON-lines object per event at `{prefix}/year=YYYY/month=MM/day=DD/{uuid}.jsonl`.
- BigQuery inserts use an insert ID built from the organization and the audit row, so a retry does not duplicate a row.
- The `event.type` field holds the same names as the `eventType` filter of the audit log API.

## Write detection rules on stable fields

- Match on `event.type` (for example `login.failed`, `role.assigned`, `api_key.created`), not on `message`.
- Use `event.outcome` for success or failure.
- Group the rows of one request by `trace.request_id`.
- `actor.type` separates people (`user`) from machines (`api_key`, `agent`, `scim`, `system`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Save is refused with an address error | The host resolves to a private or loopback address | Use a public HTTPS endpoint |
| Test event fails with `401` or `403` from the provider | Wrong or under-privileged token | Create a token with ingest or write permission, save, test again |
| Test succeeds but nothing appears | Wrong index, dataset, table or log type | Check the optional routing fields |
| Rows missing in BigQuery or Snowflake | The table schema does not match | Create the table from the schema in the docs |
| Events arrive twice | Two enabled sinks point to the same destination | Disable one |

## References

- https://docs.lumoauth.dev/integrations/siem-log-export (transport details and the BigQuery and Snowflake table definitions)
- https://docs.lumoauth.dev/user-guide/integrations/observability
