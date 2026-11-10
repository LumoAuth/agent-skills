# HRIS sync: the HR system as source of truth

An HRIS (HR information system) integration lets the HR system decide who has an account. LumoAuth pulls the employee directory on a schedule, or when the provider sends a webhook, compares it with the organization's users and applies the changes.

Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Where it is configured

Portal only: **Integrations → HR & directory sync**

```text
/orgs/{orgId}/portal/integrations/hris
```

There is no Admin API endpoint and no CLI command for HRIS sync. Give the user the page and the steps. The provider's credential is typed into the portal by the user. Do not ask for it in the chat.

## What a sync does

| Event | What LumoAuth does |
|---|---|
| Joiner: an active employee with no LumoAuth account | Creates the user or sends an invitation, sets name and attributes, adds the department group |
| Mover: an existing user whose HR record changed | Updates name, title, department and group membership. Reactivates a rehire. |
| Leaver: an employee that the HR system reports as terminated | Deactivates the account, removes group memberships, revokes every session and OAuth token |

Safety rules:

- LumoAuth never deletes a user through HRIS sync. A leaver is deactivated.
- A leaver action applies only to accounts that the sync created or linked. An account that only shares the email address, or any admin, is reported as *skipped*.
- A rehire reactivates the existing account. No second account is created.
- HR data cannot grant LumoAuth privileges. The sync never joins an existing group with the same name as a department, and never a group that carries a system role or a role that opens the portal.

## Providers

| Provider | Credentials that the user supplies | Webhooks |
|---|---|---|
| Merge | API key and linked-account token | Yes |
| Finch | Access token | Yes |
| BambooHR | API key and company subdomain | No |
| Rippling | API access token | No |
| HiBob | Service user ID and token | No |
| Personio | Client ID and client secret | No |
| Workday | Integration System User name and password, and the URL of a Report-as-a-Service report published as JSON | No |

Every provider is normalised into the same employee record: external ID, work email, first, last and display name, department, job title, manager email, employment status, start date and termination date. BambooHR and Workday have a **Column mapping** section for reports with custom labels.

## Set up

1. The user creates the API credential at the vendor. The configure page links to the right page in the vendor's console and lists the scope that is needed.
2. Under **Connect a provider**, the user opens the provider's tile, enters the credential and any vendor field (subdomain, report URL), and clicks **Connect ...**. Secrets are encrypted at rest and never shown again. On a later edit, a blank secret field keeps the stored value.
3. **Test connection** makes one read call and reports what it found, or the vendor's error.
4. Leave **Dry run only** on and press **Sync now**. The run report lists every action that the sync would take. Nothing is changed.
5. Read the report with the user. Check the leavers with care.
6. When the report is right, turn dry run off, pick a schedule and enable the integration.

Never skip the dry run. A wrongly scoped HR report can deactivate accounts.

## Options

These are in the **Sync behaviour** section of the provider form.

| Option | Default | Effect |
|---|---|---|
| **Add users to a group named after their department** | off | Groups are created on demand. When someone moves department, the membership moves too. Only groups that the sync created are populated. |
| **Invite new hires by e-mail instead of creating accounts directly** | off | Sends the standard invitation. The account is created when the person accepts. |
| **Deactivate leavers** | on | Terminated employees are deactivated, their sessions and tokens revoked, their group memberships removed |
| **Provision pre-hires before their start date** | off | When off, employees in a pending state are reported as *skipped* until they become active |
| **Dry run only** | off | Every sync produces a report and changes nothing |
| **Schedule** | daily | `manual`, `hourly` or `daily` |

## Matching

Employees are matched to users in this order:

1. External identity: the HRIS employee ID that an earlier sync stored on the user. This link survives an email change, so a renamed mailbox is a mover, not a joiner plus a leaver.
2. Work email, lower-cased and validated. A record without a usable email is reported as skipped.

Running the same sync twice changes nothing the second time. Records that fail one by one are counted as errors and the run continues.

## Running and reading a sync

- **Sync now** on the integration page queues a run. The runs list updates when it finishes.
- Enabled integrations run on their schedule.
- Merge and Finch can trigger a run with a webhook.

Each run is recorded with counts (joiners, movers, leavers, unchanged, skipped, errors) and a report per employee. Open a run to see which account was created, updated or deactivated, and why.

## Webhooks from Merge and Finch

The provider form shows the exact URL under **Webhook (optional)**. Its shape is:

```text
POST https://app.lumoauth.dev/orgs/{orgId}/hooks/hris/merge
POST https://app.lumoauth.dev/orgs/{orgId}/hooks/hris/finch
```

The user pastes the provider's signing secret into the form (**Webhook signature key** for Merge, **Webhook secret** for Finch). Without a stored secret the endpoint answers `403 webhook_not_enabled`. LumoAuth never accepts an unsigned HRIS event.

The signature is verified before any data is touched. The payload is never used as identity data: a valid event only triggers a full pull from the provider's API. A duplicate delivery is acknowledged and triggers nothing.

## Combine with outbound SCIM

HRIS sync creates and deactivates LumoAuth users. Outbound SCIM can push the result to downstream applications, including group changes that an HRIS sync made. See the outbound SCIM reference file of this skill.

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| "... rejected the credentials (HTTP 401)" | The API key, token or password is wrong, or it lost the scope to read employees | Create a new credential with the right scope |
| "BambooHR: a valid company subdomain is required" | The subdomain field holds a full URL or invalid characters | Enter only the part before `.bamboohr.com` |
| "Workday: the RaaS report URL is required" | The report URL is missing | Paste the report's JSON web-service URL |
| Everyone shows as *skipped* | The records have no usable work email, or they are pre-hires and **Provision pre-hires** is off | Fix the report, or turn the option on |
| A leaver is *skipped* | The account was not created or linked by the sync, or it is an admin | Expected. Deactivate that account by hand when it should go. |
| Webhook returns `401 invalid_signature` | The stored webhook secret differs from the one in the provider's console | Paste the current secret |
| Webhook returns `403 webhook_not_enabled` | No webhook secret is stored | Enter the secret in the provider form |

Docs: https://docs.lumoauth.dev/integrations/hris-sync
