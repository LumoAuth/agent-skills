# Alert channels

LumoAuth raises a security alert when the audit log records a high-risk or critical-risk event (for example an account lockout, a signing-key change, a new API key, an admin setting another user's password, a blocked sign-in). An alert channel routes those alerts to a tool that the security team watches.

- Page: `/orgs/{orgId}/portal/integrations/alert-channels` (**Integrations → Alerting & notifications**; the page title is **Security alert channels**)
- Permission: `settings.manage`
- API and CLI: none. Portal only.

## Setup

1. Pick a destination under **Add a channel**.
2. Enter a **Name**, choose the **Minimum severity**, fill in the destination fields.
3. Click **Create channel**.
4. Click **Send test alert**. It posts a synthetic medium-severity alert (`alert_channel.test`), which is delivered whatever the channel's threshold is.

## Destinations

| Type | The user must supply | What arrives |
|---|---|---|
| **Slack** | An incoming webhook URL (`hooks.slack.com`). The URL is the credential. | A Block Kit message with a colour bar per severity, the organization, user, IP address and a block of JSON details |
| **Microsoft Teams** | A Workflows webhook URL ("Post to a channel when a webhook request is received") or a classic `*.webhook.office.com` connector URL | An Adaptive Card |
| **PagerDuty** | An Events API v2 routing key | A triggered event. Severity map: critical → `critical`, high → `error`, medium → `warning`, low → `info`. Repeats of one event type, organization and IP within an hour collapse into one incident. |
| **Opsgenie** | An API key and the region (US or EU) | An alert with priority P1 (critical) to P4 (low), an alias for deduplication, tags and details |
| **Email** | A **Recipients** list (up to 10 addresses, separated by commas or new lines) | HTML and plain-text email, sent through the organization's email provider when one is configured |

A Teams channel with a URL on a host other than `*.webhook.office.com`, `*.logic.azure.com` or `*.powerplatform.com` is treated as a generic HTTPS receiver. It gets the same JSON envelope plus the header `X-LumoAuth-Event: security.alert`.

## Minimum severity

Each channel has a minimum severity: `low`, `medium`, `high` or `critical`. The default is `high`. An alert is delivered when its risk level is at or above the threshold. A common layout: one PagerDuty channel at `critical`, one chat channel at `high`.

Which event has which risk level is listed in the audit events reference of `lumoauth-audit-compliance`.

## Behaviour

- Delivery is asynchronous. The request that raised the alert is not slowed down.
- Failed deliveries are not retried. Fix the configuration and send a test alert.
- A disabled channel keeps its configuration and receives nothing.
- Each channel shows delivered and failed counts, the last success time and the last error.
- Alert bodies carry the event type, severity, organization, user email, IP address and the sanitized audit context. Credentials, tokens and passwords are never included.
- Changes are audited: `alert_channel.created`, `alert_channel.updated`, `alert_channel.enabled`, `alert_channel.disabled`, `alert_channel.deleted`, `alert_channel.tested`.

## Alert channels compared with other outputs

| Need | Use |
|---|---|
| High-risk security events to people | Alert channels (this page) |
| Every audit event to a SIEM or log store | Log sinks, see `lumoauth-audit-compliance` |
| Selected platform events to the customer's own endpoint or chat | Webhooks, see `lumoauth-webhooks` |

There is no editor for custom alert rules. For thresholds (for example a failure rate), forward events to the SIEM or observability tool and alert there.

## Reference

- https://docs.lumoauth.dev/integrations/alerting
