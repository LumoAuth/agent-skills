---
name: lumoauth-integrations
description: >-
  Configures the third-party integrations on the LumoAuth portal's Integrations page: alert
  channels (Slack, Microsoft Teams, PagerDuty, Opsgenie, email), approval channels (Slack,
  Teams, ServiceNow, Jira), device posture (CrowdStrike, Jamf, Intune, Kandji), risk and bot
  protection (MaxMind, IPQualityScore, AbuseIPDB, breached passwords, CAPTCHA with Turnstile,
  hCaptcha, reCAPTCHA), SMS providers (Twilio, Vonage, AWS SNS, MessageBird), email providers
  (Amazon SES, SendGrid, Mailgun, Resend, Postmark, SMTP), key storage and HSMs (AWS KMS,
  Azure Key Vault, Google Cloud KMS, Vault, PKCS#11), secrets managers and secret://
  references, analytics and CRM (Segment, Mixpanel, Amplitude, PostHog, HubSpot, Salesforce),
  billing, FIDO metadata. Use when the user wants to connect LumoAuth to one of these tools,
  send mail or SMS through their own provider, add a CAPTCHA, or keep signing keys in an HSM.
  Not for SIEM export (lumoauth-audit-compliance), SCIM or HRIS sync (lumoauth-scim) or
  webhooks (lumoauth-webhooks).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth third-party integrations

Connect a LumoAuth organization to the tools that its security, IT and data teams already run. Every integration in this skill is configured by an organization admin in the portal. This skill tells the agent which integration fits a need, which page to open, which values the user must bring, and how to test the result.

## When to use

- "Send security alerts to Slack / PagerDuty."
- "Let reviewers approve agent requests from Slack / Jira."
- "Only allow compliant devices."
- "Add a CAPTCHA to the login page." "Block Tor and VPN sign-ins." "Reject breached passwords."
- "Send our emails from our own domain." "Enable text-message codes."
- "Keep the signing key in our HSM / KMS."
- "Read integration credentials from our secrets manager." "Push the client secret to Vercel / GitHub Actions."
- "Send sign-in events to Segment / Mixpanel." "Create a HubSpot contact when a user registers."

Do not use this skill for:

- Streaming audit logs to a SIEM, a data warehouse, Datadog, Axiom or Honeycomb: use `lumoauth-audit-compliance`.
- SCIM presets, outbound SCIM and HR system sync: use `lumoauth-scim`.
- Social login, SAML and OIDC identity providers (also sections of the Integrations page): use `lumoauth-login-methods` and `lumoauth-enterprise-sso`.
- Webhooks to the customer's own app: use `lumoauth-webhooks`.
- Terraform, Kubernetes and configuration as code: use `lumoauth-admin-api`.

## Before you start

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`{orgId}`) | The portal URL: `/orgs/acme-corp/portal/` |
| An admin who can open the page | The pages need the `settings.manage` permission (`billing.manage` for Billing) |
| Credentials of the third-party tool | The user creates them at the vendor. The reference file of each area lists what is needed. |

Rules for the agent:

1. **These integrations are portal-only.** The Admin API and the `lumo` CLI have no endpoints or commands for them. Do not invent one. Give the user the page URL and the list of fields.
2. **Never handle the third-party secret yourself.** Tell the user which secret is needed and let the user paste it into the portal form. Do not ask for it in the conversation, do not write it to a file, and do not put it in the app's environment unless the app itself needs it.
3. Ask the user for a value that you do not have. Do not guess account IDs, regions or host names.
4. Availability of each integration depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix). A page whose feature the plan lacks still opens, with its form greyed out.

## Choose the integration

All page paths start with `{base}/orgs/{orgId}/portal`.

| Need | Integration | Page | The user must supply | Reference |
|---|---|---|---|---|
| Notify the security team of high-risk events | Alert channels: Slack, Microsoft Teams, PagerDuty, Opsgenie, email | `/integrations/alert-channels` | Webhook URL, routing key or API key, or recipient addresses; a minimum severity | [alerting.md](references/alerting.md) |
| Decide agent permission requests where reviewers work | Approval channels: Slack, Microsoft Teams, ServiceNow, Jira Service Management | `/integrations/approval-channels` | A Slack app or Teams bot or webhook, or ticketing credentials; reviewers with `jit.approve` | [approval-channels.md](references/approval-channels.md) |
| Use device trust in access decisions | Device posture: CrowdStrike Falcon, Jamf Pro, Microsoft Intune, Kandji | `/integrations/device-posture` | A read-only API credential and the base URL of the tool | [device-posture.md](references/device-posture.md) |
| Score sign-in IPs, block Tor and VPN | IP intelligence: MaxMind GeoIP2, IPQualityScore, AbuseIPDB | `/integrations/ip-intelligence` | Account ID and license key, or API key | [risk-and-bot-protection.md](references/risk-and-bot-protection.md) |
| Stop bots on sign-in, sign-up, password reset | CAPTCHA: Cloudflare Turnstile, hCaptcha, reCAPTCHA Enterprise | `/integrations/captcha` | Site key and secret (reCAPTCHA Enterprise: site key, Google Cloud API key, project ID) | [risk-and-bot-protection.md](references/risk-and-bot-protection.md) |
| Reject breached passwords | Have I Been Pwned | `/settings/authentication`, **Auth lifecycle** | Nothing (no API key) | [risk-and-bot-protection.md](references/risk-and-bot-protection.md) |
| Text-message codes for MFA | SMS provider: Twilio, Vonage, AWS SNS, MessageBird | `/integrations/sms` | Provider credentials and a sender | [sms-and-email.md](references/sms-and-email.md) |
| Send email from the organization's own sender | Email provider: Amazon SES, SendGrid, Mailgun, Resend, Postmark, custom SMTP | `/integrations/email` | Provider credentials and a verified From address | [sms-and-email.md](references/sms-and-email.md) |
| Hold the token signing key outside LumoAuth | Key storage: cloud KMS, HSM services, Vault, PKCS#11 sidecar | `/signing-keys`, **Generate new key** | Provider credentials and key location | [key-storage.md](references/key-storage.md) |
| Keep integration credentials in a secrets manager | Secrets managers: 1Password Connect, Doppler, Infisical, AWS Secrets Manager, CyberArk Conjur, HashiCorp Vault / OpenBao | `/integrations/secrets` | Manager address and credential; the list of allowed references | [secrets-managers.md](references/secrets-managers.md) |
| Push a new client secret to the deploy platform | Deploy targets: Vercel, Netlify, GitHub Actions, Doppler | `/integrations/secrets` | A token for the platform and the project, site or repository | [secrets-managers.md](references/secrets-managers.md) |
| Product analytics of authentication | Analytics: Segment, Mixpanel, Amplitude, PostHog | `/integrations/analytics` | Write key, project token or API key | [analytics-and-crm.md](references/analytics-and-crm.md) |
| Contacts and companies in the CRM | CRM: HubSpot, Salesforce | `/integrations/crm` | Private app token, or instance URL with client ID and secret | [analytics-and-crm.md](references/analytics-and-crm.md) |
| Recognise passkey authenticators, require certified ones | FIDO Metadata Service | `/integrations/fido-mds` | Nothing | [fido-mds.md](references/fido-mds.md) |
| Plan, add-ons, invoices | Billing | `/billing` | A payment method | [billing.md](references/billing.md) |
| A listing in an identity catalogue or cloud marketplace | Not a configurable integration | - | - | [marketplaces.md](references/marketplaces.md) |

The Integrations page itself is `/orgs/{orgId}/portal/integrations` (**Settings → Integrations**). A row of section tabs switches between the categories. **Configure** (or **Connect**, **Set up**) on a card opens the page of that integration.

## The common setup pattern

Every integration follows the same steps.

1. **Prepare the credential at the vendor.** Create a dedicated credential with the smallest permission that the reference file lists (for example a read-only device API client, or a mail-send-only key). Do not reuse a personal or admin token.
2. **Open the page** from the table and pick the provider.
3. **Confirm the sign-in when asked.** Before a credential is saved, moved to another endpoint or deleted, LumoAuth asks the admin to confirm with a fresh second factor (or the password when the admin has none). This is expected.
4. **Fill in the form.** Paste the credential, set the provider options, turn the enable switch on and save.
5. **Run the built-in test.** Each page has one: **Send test alert**, **Send test SMS**, **Send test email**, **Test with a user**, **Test with a sample IP**, **Verify test token**, **Test connection** or **Send test event**. Read the result that is shown inline; it carries the provider's own error message.
6. **Turn on what depends on it.** Some integrations do nothing until a second setting uses them. See the table below.
7. **Check the counters later.** The page and the tile on the Integrations page show delivered and failed counts and the last error.

Behaviour that is the same everywhere:

- Credentials are encrypted at rest and are never shown again. On an edit, leave a secret field blank to keep the stored value.
- Outbound calls go only to public HTTPS hosts. An address in a private, loopback or link-local range is refused when the form is saved. Calls time out after 10 seconds and do not follow redirects.
- Error messages never contain the request URL or a key.
- Each change is written to the audit log.
- A credential field accepts a `secret://` reference to a connected secrets manager instead of a literal value. See [secrets-managers.md](references/secrets-managers.md).

### Settings that an integration needs before it has an effect

| Integration | Second setting | Where |
|---|---|---|
| SMS provider | Tick text messages under **Allowed factors** in the MFA policy | `/orgs/{orgId}/portal/settings/authentication`, **MFA policy** (see `lumoauth-mfa-passkeys`) |
| Email provider | **Route this organization's email through my provider** | The Email provider page |
| CAPTCHA | Choose the **placements** (sign-in, registration, forgot password, magic link) | The CAPTCHA page |
| IP intelligence | Adaptive security on; optionally **Block Tor exit nodes** and **Block datacenter and VPN ranges** | `/orgs/{orgId}/portal/settings/adaptive-auth` |
| Device posture | An attribute rule that reads `device.trusted` or `device.compliant` | See `lumoauth-abac` |
| Approval channels | Reviewers hold the `jit.approve` permission | See `lumoauth-agent-approvals` |
| Key storage | **Sign new tokens with this key** on the generated key | The Signing keys page |
| Secrets manager | **Resolve `secret://` references** on, and entries in **Allowed references** | The manager's form |
| FIDO metadata | **Require FIDO-certified authenticators** (optional, strict) | `/orgs/{orgId}/portal/settings/authentication`, **Identity methods** |

## What changes for the app's code

Most integrations need no change in the customer's app. The exceptions:

- **CAPTCHA with a custom sign-in form.** An app that posts credentials to the JSON login endpoint must send the widget's token as `captcha_token`. Without a valid token the endpoint answers `400` with `"status": "captcha_required"`. Apps that use the hosted login page need no change: the page renders the widget.
- **Key storage.** Tokens are verified against the same JWKS URL as before. A new key has a new `kid`; an app that caches the JWKS must refetch on an unknown `kid` (the LumoAuth SDKs and standard JWT libraries do).
- **Email provider.** Mail arrives from the organization's From address. Update SPF, DKIM and DMARC records at the provider, and any allow-list in the app's tests.
- **Deploy targets.** The synced variables are named `LUMO_CLIENT_ID` and `LUMO_CLIENT_SECRET`. Map them to the names that the app's SDK reads if they differ.
- **Plan-gated API calls.** An API call to a feature that the plan lacks returns `403` with `"error": "feature_not_in_plan"` or `"plan_limit_reached"` and an `upgrade` object. Surface that message to the user; do not retry.

## Verify

- The built-in test of the page reports success.
- The counters on the page increase after a real event, and **Last error** is empty.
- The audit log has the configuration event (for example `alert_channel.created`, `captcha.created`, `risk_provider.created`); see `lumoauth-audit-compliance`.
- End to end: trigger the real behaviour once (a sign-in for CAPTCHA and IP intelligence, an MFA enrollment for SMS, a password reset for email, a token request for a new signing key) and confirm the result at the vendor.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Looking for an API or CLI command to configure an integration | They are portal-only | Open the page; give the user the field list |
| Save is refused with a URL error | The endpoint is `http://` or resolves to a private address | Use a public HTTPS endpoint |
| The form is greyed out and the button reads **Upgrade to enable** | The plan does not include the feature | Check https://docs.lumoauth.dev/pricing-matrix; the Billing page shows the options |
| SMS provider saved, but users are not offered text messages | The MFA policy does not allow the factor | Tick text messages under **Allowed factors** |
| Email still comes from a LumoAuth address | The route switch is off | Turn on **Route this organization's email through my provider** |
| Test email works, real mail fails | The From address is not a verified sender at the provider | Verify the sender or domain at the provider |
| Tor / VPN block switches have no effect | No IP intelligence provider answers with those flags | Add a provider that returns proxy and Tor flags |
| Alerts stop and are not retried | Alert delivery is best-effort | Fix the channel and use **Send test alert** |
| Tokens stop being issued after a key was disabled at the KMS or HSM | External keys cannot sign when the provider refuses | Re-enable the key, or make another key the primary one |
| `secret://` reference fails | Manager disabled, resolve switch off, or the reference is not on the allow-list | Fix the manager's **Purposes** settings |
| Secret pasted into chat or committed | The agent handled the secret | Rotate it at the vendor; the user enters the new one in the portal |

## Related skills

- `lumoauth-audit-compliance`: log sinks (SIEM, warehouse, observability) and the audit log.
- `lumoauth-scim`: SCIM presets, outbound provisioning and HR system sync.
- `lumoauth-mfa-passkeys`: MFA policy, text-message codes, passkey policy, adaptive MFA.
- `lumoauth-agent-approvals`: the approval flow that approval channels deliver.
- `lumoauth-abac`: attribute rules that use the `device` attributes.
- `lumoauth-branding`: email templates and the login page that shows the CAPTCHA.
- `lumoauth-webhooks`: events for the customer's own endpoints.
- `lumoauth-admin-api`: configuration as code for the parts that do have an API.

## References

Open the file of the area that you are configuring.

- [references/alerting.md](references/alerting.md): alert channel destinations, severity, what arrives.
- [references/approval-channels.md](references/approval-channels.md): Slack, Teams, ServiceNow and Jira setup, callback URLs, reviewer rules.
- [references/device-posture.md](references/device-posture.md): providers, credentials, the `device` attributes.
- [references/risk-and-bot-protection.md](references/risk-and-bot-protection.md): IP intelligence, breached passwords, CAPTCHA providers and placements.
- [references/sms-and-email.md](references/sms-and-email.md): SMS and email providers, fields, limits.
- [references/key-storage.md](references/key-storage.md): key storage providers and fields, the PKCS#11 sidecar contract.
- [references/secrets-managers.md](references/secrets-managers.md): managers, `secret://` syntax, the token-vault key, deploy targets.
- [references/analytics-and-crm.md](references/analytics-and-crm.md): forwarded events, privacy behaviour, CRM field mapping.
- [references/billing.md](references/billing.md): the Billing page and plan-gate errors.
- [references/fido-mds.md](references/fido-mds.md): authenticator metadata and the certified-only policy.
- [references/marketplaces.md](references/marketplaces.md): what to answer when the user asks about catalogue or marketplace listings.
- https://docs.lumoauth.dev/integrations
