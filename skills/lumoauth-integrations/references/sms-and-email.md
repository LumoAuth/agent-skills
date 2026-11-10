# SMS and email providers

The SMS provider delivers one-time codes for MFA. The email provider carries every transactional email of the organization. Each organization has at most one SMS provider and one email provider.

- Pages: `/orgs/{orgId}/portal/integrations/sms` and `/orgs/{orgId}/portal/integrations/email` (**Integrations → SMS & email delivery**)
- Permission: `settings.manage`
- API and CLI: none for the providers. Portal only.

## SMS providers

| Provider | Credentials | Settings |
|---|---|---|
| **Twilio** | Account SID, Auth Token | From number (E.164) or Messaging Service SID |
| **Vonage** | API key, API secret | Sender ID |
| **AWS SNS** | Access key ID and secret access key of an IAM user with `sns:Publish` | Region, optional Sender ID |
| **MessageBird** | Access key | Originator |

Setup:

1. Pick the provider under **SMS provider** and enter its credentials.
2. Turn **Enable SMS delivery** on and click **Save configuration**.
3. Click **Send test SMS** and send to the user's own number. The test counts against the rate limit.
4. Allow the factor: open `/orgs/{orgId}/portal/settings/authentication`, section **MFA policy**, and tick text messages under **Allowed factors** (policy value `sms_otp` in `allowed_factors`). Until a provider exists, the checkbox is disabled.

Behaviour:

- Text messages are the weakest tier of factor. Users are directed to passkeys, the LumoAuth app or an authenticator app first.
- Codes have 6 digits, expire after 5 minutes, allow 5 attempts and are single-use. A new code invalidates the previous one.
- Numbers are validated before a code is sent and stored in E.164. Landlines are always rejected. VoIP numbers and countries can be restricted in the MFA policy (`sms_block_voip`, `sms_country_allowlist`, `sms_country_denylist`).
- Sending is rate limited per phone number.
- Delivery is by text message only. There is no voice call and no failover between providers.
- Removing the provider or unticking the factor stops new SMS challenges at once. Users whose only factor is SMS must add another method first.
- Audit events: `sms.sent`, `sms.failed`, `sms.rate_limited`, plus the `mfa.*` events.

A custom UI enrolls the factor through the MFA API (`POST /orgs/{orgId}/api/v1/me/authenticators/sms_otp/enroll`); see `lumoauth-mfa-passkeys`.

## Email providers

| Provider | Credentials | Settings |
|---|---|---|
| **Amazon SES** | Access key ID and secret access key of an IAM user with `ses:SendRawEmail` | Region |
| **SendGrid** | API key with the Mail Send permission | - |
| **Mailgun** | API key | Sending domain, US or EU region |
| **Resend** | API key | - |
| **Postmark** | Server token | - |
| **Custom SMTP** | User name, password | Host, port, STARTTLS or implicit TLS |

Setup:

1. Verify the sending domain or address at the provider (SPF and DKIM records as the provider instructs).
2. Open the page, choose the provider under **Email provider**, enter the credentials.
3. Set the **From address** (it must be a verified sender at the provider) and an optional **From name**.
4. Click **Save configuration**, then **Send test email**. The test uses the saved configuration even while the integration is disabled.
5. Turn on **Route this organization's email through my provider**.

What is routed when the integration is enabled: email verification, password reset, user and organization invitations, magic links, email one-time codes, security notices, privacy notifications and email alert channels. Email templates still apply; only the transport and the From header change. Templates belong to `lumoauth-branding`.

Behaviour:

- Without an enabled integration, mail is sent by LumoAuth from a LumoAuth address. Disabling or removing the integration returns to that.
- Delivery is asynchronous with retries. The page shows sent and failed counters and the last error.
- Sending is throttled per organization. A large batch (for example a mass invitation) goes out over time, and mail that waits too long is dropped with an error on the page. Spread large batches.
- Custom SMTP: the host must be public, certificate validation is always on, and TLS is required. Unencrypted SMTP is not offered.
- Changing the provider, the SMTP host, port or encryption mode, or the region clears the stored credentials. Enter them again.
- A credential field accepts a `secret://` reference (see `secrets-managers.md` in this folder). An unresolvable reference fails the send; there is no fallback to the default mailer in that case.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Users are not offered text messages | The factor is not allowed in the MFA policy | Tick it under **Allowed factors** |
| "That phone number is not valid" or a landline message | Number validation | Use a mobile number with the right country |
| Mail still comes from a LumoAuth address | The route switch is off | Turn it on |
| Provider rejects the sender | The From address is not verified | Verify the domain or address at the provider |
| Mail lands in spam | Missing SPF, DKIM or DMARC alignment | Fix DNS at the sending domain |
| SMTP send fails after an upgrade of the relay | STARTTLS is not offered | Enable TLS on the relay |

## Reference

- https://docs.lumoauth.dev/integrations/sms-and-email
