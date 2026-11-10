# Product analytics and CRM

Two integrations forward authentication activity to business tools:

- **Analytics / CDP**: a fixed set of authentication events goes to Segment, Mixpanel, Amplitude or PostHog, pseudonymised by default.
- **CRM**: a contact is upserted in HubSpot or Salesforce when a user registers, and a company or account when an organization is created.

Both need the `settings.manage` permission. API and CLI: none; portal only. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

To send every audit event to a log store, use a log sink instead (`lumoauth-audit-compliance`). To react to events in the customer's own code, use `lumoauth-webhooks`.

## Analytics

- Page: `/orgs/{orgId}/portal/integrations/analytics` (**Analytics & CDP**)

| Provider | The user must supply | Options |
|---|---|---|
| **Segment** | Write key | Region (US or EU) |
| **Mixpanel** | Project token | Region (US or EU) |
| **Amplitude** | API key | Region (US or EU) |
| **PostHog** | Project API key | Host, for PostHog instances at another public HTTPS address |

Setup:

1. Click **Connect** on a provider card.
2. Enter the credential, choose the region, and select **Events to forward** (leave it empty to forward all events in the table below).
3. Decide on **Send identify calls** (see privacy below).
4. Turn the enable switch on and click **Save configuration**.
5. Click **Send test event**.

One destination per provider; several providers can be enabled together.

### Events that are forwarded

Only these events are forwarded. Other audit events are not.

| Event | Sent on |
|---|---|
| `user.login` | Successful sign-in (password, passkey, social, SAML, OIDC) |
| `user.login_failed` | Failed or blocked sign-in attempt |
| `user.registered` | New user account (self-service, invitation or created by an admin) |
| `mfa.enrolled` | MFA method enrolled |
| `mfa.challenge_passed` | MFA challenge completed |
| `passkey.registered` | Passkey registered |
| `agent.created` | AI agent registered or activated |
| `agent.suspended` | Agent suspended or revoked |
| `jit.requested` | Just-in-time permission requested |
| `jit.approved` | Just-in-time permission approved |
| `jit.denied` | Just-in-time permission denied |

### Privacy behaviour

- `distinct_id` is a pseudonym, not the LumoAuth user ID. It is stable per user and cannot be reversed. **It does not match the user ID that the customer's app sends to the same analytics tool.** To join the two streams, turn on **Send identify calls**, or send the app's own events with an identifier that both sides share.
- Event properties are an allow-list of non-identifying fields: event type, status, severity, action, actor and target type, location string, result reason, error code, a truncated user agent, and a short list of metadata keys such as `method`, `provider`, `risk_score`, `risk_level`, `agent_id`, `client_id` and `grant_type`.
- IP addresses are truncated (IPv4 to /24, IPv6 to /48).
- Email and name are sent only in the optional identify call, and only when **Send identify calls** is ticked. Ask the user before enabling it.

### Delivery

- Asynchronous; the sign-in that produced the event is not slowed down.
- Temporary failures (`5xx`, `429`, network) are retried. A `4xx` is treated as a configuration error and dropped.
- The page shows delivered and failed counters, the last success and the last error.

## CRM

- Page: `/orgs/{orgId}/portal/integrations/crm` (**CRM sync**)

| Provider | The user must supply |
|---|---|
| **HubSpot** | A private app token (`pat-...`) with access to contacts and companies |
| **Salesforce** | Instance URL, client ID, client secret, optional refresh token (OAuth client credentials or refresh token flow) |

Setup:

1. Click **Connect** on HubSpot or Salesforce and enter the credentials.
2. Under **What to sync**, choose **Contacts on user registration** and **Companies on organization creation** (HubSpot) or **Accounts on organization creation** (Salesforce).
3. Optional: set HubSpot's lifecycle stage (default `lead`) or Salesforce's lead source (default `LumoAuth`).
4. Turn the sync on, click **Save configuration**, then **Test connection**.

### What is synced

| Trigger | HubSpot | Salesforce |
|---|---|---|
| A user registers | Contact upsert by email: `firstname`, `lastname`, `lifecyclestage`, `lumoauth_user_id`, `lumoauth_tenant` | Contact upsert by `Email`: `FirstName`, `LastName`, `LeadSource` |
| An organization is created | Company upsert by domain, then name: `name`, `domain`, `lumoauth_org_id`, `lumoauth_tenant`; the creator's contact is associated | Account upsert by `Name`: `Website`, `AccountSource`; the creator's Contact is linked through `AccountId` |

Notes:

- The HubSpot fields `lumoauth_user_id`, `lumoauth_tenant` and `lumoauth_org_id` are custom properties. If **Test connection** passes but a sync fails, check on the CRM sync page's last error whether HubSpot knows these properties.
- The company domain comes from the creator's email domain. Common free-mailbox domains are ignored.
- A user with a one-word name is written with that word as the last name. A Salesforce Contact without a name gets `LastName = Unknown`.
- A lookup runs before each write, so a repeated sync updates instead of duplicating.
- A CRM outage does not affect sign-up. The sync runs in the background.

## Reference

- https://docs.lumoauth.dev/integrations/analytics-and-crm
