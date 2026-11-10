# Outbound SCIM: push users and groups to a SaaS target

With outbound SCIM, LumoAuth acts as a SCIM client. It pushes user creations, updates and deletions, and optionally groups and their members, to one downstream application. Changes are pushed as they happen, and a batch sync can reconcile everything on a schedule.

Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Where it is configured

Portal: **Integrations → SCIM provisioning → Outbound SCIM**

```text
/orgs/{orgId}/portal/integrations/scim-outbound
```

The same settings are the `outbound` object of `GET` / `PATCH {base}/orgs/{orgId}/api/v1/admin/settings/scim` (scope `admin:settings:read` / `admin:settings:write`, permission `scim.view` / `scim.edit`). Use the portal for the first setup: it builds the base URL from the preset, shows the vendor's notes and has the **Test connection** button. The credential of the target is typed into the portal by the user. Do not ask for it in the chat.

## Set up

1. Open **Integrations**, find **SCIM provisioning** and click **Set up** on the **Outbound SCIM** card.
2. Pick the vendor under **Target preset**. The page shows the vendor's notes and quirks, and the placeholder fields.
3. Fill in the placeholders (subdomain, organization, directory ID). The base URL is generated. For OAuth 2.0 presets the token URL is generated too.
4. Enter the bearer token, the Basic credentials or the OAuth 2.0 client credentials. They are encrypted at rest. On a later edit, leave a secret field blank to keep the stored value.
5. Click **Save configuration**, then **Test connection**.
6. Turn on **Enable outbound SCIM provisioning** and choose the events: **Push user creations**, **Push user updates**, **Push user deletions**, **Push group changes**.
7. Optional, under **Sync options**: **Sync on user login** and **Batch sync**.

A secret field can hold a `secret://<manager>/<ref>` reference to a secrets manager instead of the value. It is resolved each time a push runs. See `lumoauth-integrations`.

The endpoint must be a public `https` host. When the endpoint URL or the token URL changes, the stored secret must be entered again. Changing the endpoint URL also discards the stored remote IDs of users and groups.

## Presets

**Generic SCIM 2.0 server (no vendor quirks)** is the default: `PUT` updates, `DELETE` deprovisioning, `application/scim+json`, `Bearer` tokens.

| Preset | Base URL template | Authentication | What differs |
|---|---|---|---|
| Okta | `https://{subdomain}.okta.com/api/v1/scim/v2` | Bearer with the `SSWS` scheme | `userName` is the email; no password; deprovision by deactivation |
| Microsoft Entra ID | `.../servicePrincipals/{servicePrincipalId}/synchronization/jobs/{jobId}/bulkUpload` | OAuth 2.0 client credentials | Bulk requests only; no PATCH; no groups; no filtering; enterprise extension always sent |
| OneLogin | `https://{subdomain}.onelogin.com/scim/v2` | Bearer | `userName` is the email; no password; deprovision by deactivation |
| JumpCloud | `https://console.jumpcloud.com/api/v2/scim/v2` | Bearer | `userName` is the email; no password |
| Google Workspace | `https://www.googleapis.com/scim/v2` | OAuth 2.0 | Needs a SCIM gateway in front of the Directory API. Enter the gateway's base URL. |
| Salesforce | `https://{myDomain}.my.salesforce.com/services/scim/v2` | Bearer (OAuth access token) | `application/json`; no password; deprovision by deactivation |
| GitHub Enterprise Cloud | `https://api.github.com/scim/v2/organizations/{org}` | Bearer | No groups; no password; sends `X-GitHub-Api-Version` |
| Slack | `https://api.slack.com/scim/v1` | Bearer | SCIM 1.1; `application/json`; `DELETE` deactivates the member |
| Zoom | `https://api.zoom.us/scim2` | OAuth 2.0 (server-to-server) | `userName` is the email; no password; deprovision by deactivation |
| Atlassian Cloud | `https://api.atlassian.com/scim/directory/{directoryId}` | Bearer | `userName` is the email; no password; groups supported |

Next to the preset name the page shows a tag. **endpoint confirmed** marks a preset whose endpoint shape was confirmed against the vendor's documentation. **verify base URL with vendor** marks a starting point: tell the user to check the base URL in the vendor's admin console before enabling.

Vendor notes to pass on to the user:

- Okta: the target is an Okta org that accepts SCIM with an API token. Users are deactivated, never deleted.
- Microsoft Entra ID: API-driven inbound provisioning accepts only bulk payloads. Use a client-credentials app with the `SynchronizationData-User.Upload` permission.
- Salesforce: `userName` must be unique across all Salesforce orgs.
- GitHub: the organization needs SAML SSO, and the token needs `admin:org`.
- Slack: `userName` is the Slack handle. The email goes in `emails[]`.
- Zoom: use a server-to-server OAuth app with the `scim2` scope.
- Atlassian Cloud: the API key is issued when user provisioning is turned on for a directory.

## What a preset changes

| Quirk | Default | Effect when a preset overrides it |
|---|---|---|
| `update_method` | `put` | Sends a `PatchOp` instead of a full replacement |
| `supports_patch` | `true` | When false, updates always use a full write |
| `delete_strategy` | `delete` | `deactivate` sends `active: false` instead of `DELETE /Users/{id}` |
| `password_handling` | `generate` | `skip` leaves out the `password` attribute |
| `bearer_scheme` | `Bearer` | Okta's `SSWS` |
| `content_type` | `application/scim+json` | `application/json` for vendors that reject the SCIM media type |
| `filter_supported` | `true` | When false, lookups by `userName` are skipped |
| `supports_groups` | `true` | When false, **Push group changes** is ignored for this target |
| `bulk_only` | `false` | Everything is wrapped in a `BulkRequest` |
| `enterprise_schema` | `false` | Adds the enterprise user extension to every user |

## Setting keys in the Admin API

Keys of the `outbound` object that can be written:

| Key | Values |
|---|---|
| `enabled` | boolean |
| `preset` | Preset key, for example `okta`, `entra`, `onelogin`, `jumpcloud`, `google_workspace`, `salesforce`, `github` |
| `endpoint_url` | Public `https` URL |
| `auth_type` | `bearer`, `basic`, `oauth2` |
| `bearer_token`, `basic_username`, `basic_password` | Credentials. Secrets are write-only and returned redacted. |
| `oauth2_client_id`, `oauth2_client_secret`, `oauth2_token_url`, `oauth2_scope` | OAuth 2.0 client credentials. The token URL must be a public `https` URL. |
| `verify_tls`, `tls_certificate` | TLS verification and an optional CA certificate |
| `password_handling` | See the quirk table |
| `push_user_creates`, `push_user_updates`, `push_user_deletes`, `push_group_changes` | boolean |
| `sync_on_login` | boolean |
| `batch_sync_enabled` | boolean |
| `batch_sync_interval` | `hourly`, `daily`, `weekly` |
| `attribute_mapping` | Object from LumoAuth field to SCIM attribute |

Example: turn group pushes and a daily batch sync on for a target that is already configured.

```bash
export LUMO_ORG=acme-corp
lumo settings update scim \
  --set outbound.push_group_changes=true \
  --set outbound.batch_sync_enabled=true \
  --set outbound.batch_sync_interval=daily
```

The keys must be inside `outbound`. A key at the top level is ignored. Read the result back with `lumo settings get scim -o json`. Show the command to the user first: turning pushes on starts writes to the target system.

## Groups, login sync and batch sync

**Push group changes**: every change to a LumoAuth group is pushed in the background.

| Change in LumoAuth | Request to the target |
|---|---|
| Group created | `POST /Groups` with `displayName`, `externalId` (the LumoAuth group ID) and `members` |
| Group renamed | `PATCH /Groups/{id}`: `replace` `displayName` |
| Members added or removed | `PATCH /Groups/{id}`: `add` `members`, `remove` `members[value eq "..."]` |
| Group deleted | `DELETE /Groups/{id}` |

A member that the target does not have yet is pushed first when **Push user creations** is on. Otherwise the member is left out of the group until a later sync provisions it.

**Sync on user login** (needs **Push user updates**): each interactive sign-in queues a background update of that user on the target. The sign-in never waits for the target and never fails because of it.

**Batch sync** reconciles the whole organization with the target at the chosen interval (**Every hour**, **Daily**, **Weekly**). A run:

- updates every active user and creates any that the target lacks,
- sends `active: false` for deactivated or blocked users that the target already has,
- deprovisions users that were deleted in LumoAuth, only when **Push user deletions** is on and only users that LumoAuth itself pushed,
- with **Push group changes** on, makes every group's name and member list match.

Remote accounts that LumoAuth never created are never touched. **Sync now** on the page queues an immediate full run. Each run is audited as `scim_outbound.batch_sync_completed` or `scim_outbound.batch_sync_failed`. Rate limits and transient errors of the target are retried with backoff.

## OAuth 2.0 client credentials

With **Authentication type → OAuth 2.0 client credentials**, LumoAuth fetches an access token before a push and sends it as `Authorization: Bearer`. The client ID and secret are sent to the token endpoint with HTTP Basic. The token URL must be a public `https` URL, and redirects are not followed. A token endpoint that fails or returns no bearer token fails the push.

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| **Test connection** fails | Wrong base URL or credential | Check the base URL in the vendor's admin console; enter the credential again |
| Saving is refused after a URL change | The endpoint or token URL changed and the secret was not entered again | Enter the secret again |
| Groups are not pushed | The preset has no groups endpoint (Entra ID, GitHub organizations), or **Push group changes** is off | Use user pushes only for that target |
| A group lacks members on the target | The members were not pushed yet and **Push user creations** is off | Turn it on, or run a batch sync |
| Deleted users stay active on the target | **Push user deletions** is off, or the preset deprovisions by deactivation | Turn it on; expect `active: false` for those vendors |
| A push fails for a `secret://` reference | The secrets manager did not resolve the reference | Fix the reference (`lumoauth-integrations`) |

Docs: https://docs.lumoauth.dev/integrations/scim-presets
