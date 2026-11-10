# Privacy tools, data export, analytics and residency

These tools are in the organization portal. Unless a section names an API, there is none: give the user the page to open. The privacy pages need the `gdpr.manage` permission (approving a DPIA needs `gdpr.dpo`).

This file describes what each tool does. It does not state what a regulation requires.

## Privacy pages

Sidebar group **GDPR & privacy**: **Privacy overview**, **Subject requests**, **Consent records**. Every privacy page has the same tab bar: **Overview**, **Subject requests**, **Consents**, **Records of processing**, **Breaches**, **Privacy policies**, **Sub-processors**, **Automated decisions**, **Settings**.

| Tool | Path |
|---|---|
| Privacy overview | `/orgs/{orgId}/portal/gdpr` |
| Data subject requests | `/orgs/{orgId}/portal/gdpr/dsr` |
| Consent records | `/orgs/{orgId}/portal/gdpr/consent-records` |
| Records of processing | `/orgs/{orgId}/portal/gdpr/processing-activities` |
| Breach incidents | `/orgs/{orgId}/portal/gdpr/breaches` |
| Privacy policies | `/orgs/{orgId}/portal/gdpr/privacy-policies` |
| Automated decisions | `/orgs/{orgId}/portal/gdpr/automated-decisions` |
| Sub-processors | `/orgs/{orgId}/portal/gdpr/subprocessors` |
| GDPR settings | `/orgs/{orgId}/portal/gdpr/settings` |

## Data subject requests

A request that a person makes about their data is tracked as a data subject request (DSR). Users file one from their account (`/account/dsr`, **Make a privacy request**). Admins process it:

1. Open `/orgs/{orgId}/portal/gdpr/dsr`.
2. Filter by status (**Pending**, **In progress**, **Verification**, **Completed**, **Rejected**) or by type: **Access (Art. 15)**, **Rectification (Art. 16)**, **Erasure (Art. 17)**, **Restriction (Art. 18)**, **Portability (Art. 20)**, **Objection (Art. 21)**.
3. Click the email address on a request to open it.
4. **Update** the status and the assignee, **Add note**, then **Mark completed** with a response to the person, or **Reject** with a reason.

An access or portability export contains the user's profile, login history and session data, role and group assignments, MFA enrollment status, social account links, consent records and the audit log entries about the user.

There is no API to create or process a DSR.

## Erasure

Three paths run the same full erasure. None can be undone.

| Path | How |
|---|---|
| A DSR of type **Erasure (Art. 17)** | Open the request, verify the person's identity, click **Execute erasure** and confirm |
| An admin deletes the user | Portal user list, **Delete**; or `DELETE /orgs/{orgId}/api/v1/admin/users/{userId}`; or `lumo users delete <user-id>` |
| The user deletes the account | `/account/privacy`, **Restrict or delete**, when the organization allows self-service deletion |

Show the user what will be deleted and get a confirmation before you run a delete.

| Deleted or revoked | Kept |
|---|---|
| Profile, sessions and remember-me cookies, access and refresh tokens, login attempts, consents, MFA methods, passkeys, social account links, group memberships, role assignments, invitations and one-time links for the address, relationship tuples that name the user | Audit log entries, pseudonymised (email and name removed; rows keep IDs only). The DSR record with its metadata. |

- Whether an erasure anonymizes or hard-deletes by default is the **Default erasure type** in **GDPR settings → Self-service**.
- The applications and SCIM targets that received the user's data are notified of the erasure.
- The erasure is recorded as `gdpr.erasure.completed` plus `user.deleted`.

## Self-service for users

**GDPR settings → Self-service** sets what users can do alone: account deletion, data export, restriction of processing. The user's pages:

| Action | Page |
|---|---|
| Download own data (JSON, CSV, portable file) | `/account/data-export` |
| Send data to another service | `/account/data-portability/transmit` |
| File a privacy request | `/account/dsr` |
| Consent history | `/account/consent-history` |
| Authorized apps | `/account/consents` |
| Cookie preferences | `/account/consent/cookies` |
| Restrict processing, delete account | `/account/privacy`, **Restrict or delete** |

When self-service restriction or deletion is off, the buttons send a privacy request instead.

## Consent records

`/orgs/{orgId}/portal/gdpr/consent-records` lists each consent with:

- **Purpose** (whatever the organization records, for example terms of service or marketing) and **Legal basis**
- **Action** (granted, withdrawn, updated, expired, forced to re-consent) and **Date**
- **Method** (web form, API, registration, double opt-in, admin or system)
- **Policy version** in force

Publishing a new privacy policy version at `/orgs/{orgId}/portal/gdpr/privacy-policies` can trigger re-consent.

## Retention

`/orgs/{orgId}/portal/gdpr/settings`, section **Data retention**:

1. Turn on **Enable automated data retention enforcement**.
2. Set the dormant-account threshold and action (deactivate, anonymize or delete), the soft-delete retention and **Audit log retention (days)**.
3. Click **Save GDPR settings**.

A daily job applies the settings of each organization. Organizations that have not enabled retention enforcement are skipped. Audit log retention can also be set through the API (see `audit-log-api.md` in this folder).

Changing these values can delete accounts and history. Show the user the values and confirm before saving.

## Records of processing (RoPA)

`/orgs/{orgId}/portal/gdpr/processing-activities`:

- **Register processing activity**: activity name, legal basis, retention period, purpose, security measures, data categories and recipients; then **Register activity**.
- Edit or deactivate an activity from the **⋯** menu on its row.
- **Export RoPA (JSON)** downloads the record as a JSON file.

The export contains only the activities that the organization registered. LumoAuth does not pre-fill them, and deactivated activities are left out. Fields per activity: `name`, `purpose`, `legal_basis`, `data_categories`, `data_subject_categories`, `recipients`, `third_country_transfers`, `retention_period`, `security_measures`, `controller_contact`, `dpo_contact`, `joint_controller`, `dpia_required`, `dpia_status`, `is_automated_decision`, `profiling`, `human_review_contact`, `logic_disclosure`, `is_active`, `last_reviewed`.

There is no PDF export and no API for the RoPA.

## Sub-processors

- Portal: `/orgs/{orgId}/portal/gdpr/subprocessors` shows the current list. Enter an address under **Subscriptions** and click **Subscribe** to get an email for each change to the list.
- Public list: https://docs.lumoauth.dev/user-guide/compliance/sub-processors

Third parties that the organization itself configures (email and SMS providers, log sinks, chat channels) are activated only by that configuration.

## Organization data export

`/orgs/{orgId}/portal/data-export` (**Data export** under **Settings**), **Download export**. The export is one JSON file, generated while the user waits. Repeated downloads are rate limited (`429`).

| Group | Included |
|---|---|
| Organization configuration | Sign-in settings and policies, login page customization, adaptive authentication settings, AI and SCIM settings |
| Users and access | User profiles and preferences; roles, permissions and groups; session history; consent grants |
| Applications and integrations | OAuth clients, SAML service providers and identity providers, OIDC identity providers, social login providers, webhooks, LDAP configurations |
| Security and audit | Signing keys (public keys only), audit logs of the last 90 days (only when the admin holds `audit.export`), IdP connections |

Client secrets, private keys, passwords, MFA secrets and access tokens are not in the file. The file still contains personal data of all users: store it in a place that the user chose, and never commit it.

The export is recorded as `data.exported`.

## Analytics

The organization **Dashboard** (`/orgs/{orgId}/portal/`) holds the analytics: summary tiles (applications, users, roles, new signups, sign-ins, active users, failed sign-in rate, tokens issued) and charts (sign-ins, active users, sign-in methods, tokens issued, audit events, failure reasons, authentication latency, top applications, security posture, adaptive security decisions). The range buttons switch between **24h**, **7 days**, **30 days** and **90 days**. Each chart has a **View as table** link.

API (scope `admin:analytics:read`, permission `analytics.view`); each returns `{ "data": { ... } }`:

| Endpoint | Returns |
|---|---|
| `GET /orgs/{orgId}/api/v1/admin/analytics/dashboard` | Summary of users, clients, authentication and audit activity. No parameters. |
| `GET /orgs/{orgId}/api/v1/admin/analytics/logins?days=7` | Daily login activity for the last N days (`days` 1 to 90, default 30) |
| `GET /orgs/{orgId}/api/v1/admin/analytics/users?days=30` | Registrations, verification and MFA status for the last N days |

```bash
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/analytics/logins?days=7" \
  -H "Authorization: ApiKey $LUMO_API_KEY"
```

These endpoints take `days` only. For a date range, query the audit log API with `from` and `to`.

For metrics in an external tool, stream audit events through a log sink (Datadog, Axiom, Honeycomb, OpenTelemetry and the others; see `log-sinks.md` in this folder).

## Data residency

| Region | Base URL |
|---|---|
| United States | `https://app.lumoauth.dev` |
| European Union | `https://eu.app.lumoauth.dev` |

- The regions are independent deployments. Nothing replicates between them.
- The region is chosen with the **Data region** selector on the sign-up form and cannot be changed later.
- Stored in the region: user records, session state, application configuration, audit logs, signing keys, webhook delivery logs, SCIM data, the agent registry, approval history and backups.
- Data that can leave the region depends on the organization's configuration: email goes to the email provider in use, text messages to the configured SMS provider, AI requests to the AI provider when AI features are on, and audit events to the configured log sinks.
- To keep data flows in the EU: use the EU region, route email through the organization's own provider (see `lumoauth-integrations`), leave SMS unconfigured, and turn AI features off.

## References

- https://docs.lumoauth.dev/user-guide/compliance/gdpr
- https://docs.lumoauth.dev/user-guide/compliance/ropa
- https://docs.lumoauth.dev/user-guide/compliance/sub-processors
- https://docs.lumoauth.dev/user-guide/compliance/data-export
- https://docs.lumoauth.dev/user-guide/compliance/data-residency
- https://docs.lumoauth.dev/user-guide/compliance/analytics
