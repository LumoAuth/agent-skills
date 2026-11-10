---
name: lumoauth-scim
description: >-
  Sets up and uses SCIM 2.0 provisioning with a LumoAuth organization: inbound
  provisioning from an identity provider such as Okta or Microsoft Entra ID
  (base URL `/orgs/{orgId}/api/v1/scim2.0`, provisioning bearer token,
  `/Users`, `/Groups`, filters, PATCH, `/Bulk`, `/.search`, `/Me`,
  `/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`), the provisioning
  policy (allow create, update, delete, group operations, protected
  attributes, deprovisioning action), outbound SCIM to SaaS targets with
  vendor presets (Okta, Entra ID, OneLogin, JumpCloud, Google Workspace,
  Salesforce, GitHub, Slack, Zoom, Atlassian), and HRIS sync for joiners,
  movers and leavers (Merge, Finch, BambooHR, Rippling, HiBob, Personio,
  Workday). Use when the user asks to enable SCIM, sync or deprovision users
  and groups from an IdP, script user provisioning, fix a SCIM 401, 403 or
  invalidFilter error, push users to a downstream app, or make an HR system
  the source of truth. Not for SAML or OIDC sign-in.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth SCIM provisioning

Keep users and groups in sync between a LumoAuth organization and other systems. Three features are covered:

| Feature | Direction | Use it when |
|---|---|---|
| Inbound SCIM | IdP → LumoAuth | An identity provider creates, updates and deactivates LumoAuth users and groups |
| Outbound SCIM | LumoAuth → SaaS target | LumoAuth pushes its users and groups to a downstream application |
| HRIS sync | HR system → LumoAuth | The HR system decides who has an account (joiner, mover, leaver) |

## When to use

- Connect Okta, Entra ID, OneLogin or another SCIM client to the organization.
- Write or debug a script that calls the SCIM API.
- Decide what the IdP may do (create, update, delete, groups) and what happens on deprovisioning.
- Push users to a downstream application, or connect an HR system.

Do not use this skill for:

- Sign-in through the IdP (SAML, OIDC): use `lumoauth-enterprise-sso`. SCIM manages accounts, not sign-in. Most customers need both.
- Managing users with the Admin API or the portal: use `lumoauth-users-sessions`.
- Designing roles and permissions: use `lumoauth-rbac`.
- SCIM for each customer organization of a B2B product: start with `lumoauth-b2b-saas`.

## Before you start

Ask the user for any value that is missing. Do not guess.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`acme-corp` in the examples) | The portal URL: `/orgs/{orgId}/portal` |
| SCIM base URL | `{base}/orgs/{orgId}/api/v1/scim2.0`. The **Endpoint** card on the Inbound SCIM page shows it. |
| SCIM provisioning token | Generated in the portal at `/orgs/{orgId}/portal/integrations/scim`. Shown once. |
| Admin access for settings | A portal admin session, `lumo login --org acme-corp`, or an API key (`lmk_...`) |

The provisioning token gives write access to every user of the organization. Treat it like a password:

- The user generates it in the portal and pastes it into the IdP. Do not ask the user to paste it into the chat.
- For a script, read it from an environment variable such as `SCIM_TOKEN`. Never commit it, log it or put it in browser or mobile code.
- Show the user every SCIM call or command that creates, changes or deletes users or groups before running it. A `DELETE` deprovisions a real account.

Where each feature is configured:

| Feature | Portal page | Admin API | CLI |
|---|---|---|---|
| Inbound SCIM: token, enable switch | `/orgs/{orgId}/portal/integrations/scim` | Token and switch can be written through `PATCH /admin/settings/scim`, but generate the token in the portal | See step 3 |
| Inbound provisioning policy | Same page, sections **Provisioning**, **Attribute protection**, **Provisioning behavior** | `GET` / `PATCH /admin/settings/scim` (object `inbound`) | `lumo settings get scim`, `lumo settings update scim` |
| Outbound SCIM | `/orgs/{orgId}/portal/integrations/scim-outbound` | `PATCH /admin/settings/scim` (object `outbound`) | `lumo settings update scim` |
| HRIS sync | `/orgs/{orgId}/portal/integrations/hris` | Portal only | None |

Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`. Reading `/admin/settings/scim` needs the scope `admin:settings:read` and the permission `scim.view`. Writing needs `admin:settings:write` and `scim.edit`. There is no dedicated `lumo scim` command.

## Steps: inbound SCIM from an IdP

### 1. Generate the token and turn SCIM on

Tell the user to:

1. Open `/orgs/{orgId}/portal/integrations`, find **SCIM provisioning** and click **Set up** on the **Inbound SCIM** card.
2. Under **Bearer token**, click **Generate bearer token** and copy the token. It is shown once. LumoAuth stores only a hash.
3. Under **Provisioning**, switch **Enable SCIM provisioning** on and click **Save changes**.

Saving other SCIM settings later does not clear the token. **Regenerate token** replaces it; the old one stops working.

### 2. Configure the IdP

| Setting in the IdP | Value |
|---|---|
| SCIM base URL (tenant URL) | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/scim2.0` |
| Authentication | HTTP header, bearer token: the token from step 1 |
| Unique identifier | `userName` (the email address) |

- **Okta**: application → **Provisioning** → **Configure API Integration** → tick **Enable API integration**, paste the base URL and token, **Test API Credentials**, save. Under **To App** enable *Create Users*, *Update User Attributes* and *Deactivate Users*. Use the **Push Groups** tab for group sync.
- **Microsoft Entra ID**: **Enterprise applications** → the app → **Provisioning** → mode **Automatic**. Tenant URL = base URL, Secret Token = the token. **Test Connection**, save, assign users or groups, turn provisioning **On**.

Tell the IdP admin not to send passwords. A password that fails the organization's password policy makes the call fail with `400 invalidValue`.

### 3. Set the provisioning policy

The policy is enforced on every SCIM call. A call that the policy does not allow is refused with `403` and nothing changes.

| Setting | Key | Default |
|---|---|---|
| **Allow user creation** | `allow_user_creation` | on |
| **Allow user updates** | `allow_user_updates` | on |
| **Allow user deletion** | `allow_user_deletion` | on |
| **Allow group operations** | `allow_group_operations` | on |
| **Auto-activate new users** | `auto_activate_users` | on |
| **Protect email address / name / active status** | `protected_attributes.email`, `.name`, `.active` | off |
| **Deprovisioning action** | `deprovisioning_action`: `soft_delete`, `deactivate`, `hard_delete` | `soft_delete` |

The API takes these keys inside an `inbound` object. With the CLI, use dotted keys so that the body is nested correctly:

```bash
export LUMO_ORG=acme-corp
lumo settings get scim -o json
lumo settings update scim \
  --set inbound.allow_user_deletion=false \
  --set inbound.deprovisioning_action=deactivate
```

Send `protected_attributes` as a complete object, because the update replaces the whole object:

```bash
lumo settings update scim --data '{"inbound":{"protected_attributes":{"email":true,"name":false,"active":false,"roles":true,"permissions":true}}}'
```

A key that is sent at the top level, outside `inbound`, is ignored. Read the settings back to confirm the change.

Choose the deprovisioning action with the user:

| Value | `DELETE /Users/{id}` does |
|---|---|
| `soft_delete` | Marks the user deleted. Hidden from lists, sessions end, an admin can restore the account. |
| `deactivate` | Sets `active: false` and blocks sign-in. The IdP can enable the user again with `active: true`. |
| `hard_delete` | Removes the user at once |

### 4. Groups

A SCIM group is an organization role. Adding a member grants the role; removing a member revokes it. A group can never grant admin rights: a write on a group is refused with `403` when its role is a system role or holds any of LumoAuth's own permissions, view-only ones included. Use IdP-managed groups for the application's own roles and assign admins in the portal. `roles` and `permissions` are never writable on the User resource.

### 5. Call the API from a script

```bash
BASE="https://app.lumoauth.dev/orgs/acme-corp/api/v1/scim2.0"

# Create a user
curl -sS -X POST "$BASE/Users" \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "alice@example.com",
    "name": {"givenName": "Alice", "familyName": "Smith"},
    "emails": [{"value": "alice@example.com", "primary": true, "type": "work"}],
    "active": true,
    "externalId": "hr-1001"
  }'

# Find a user by userName
curl -sS -G "$BASE/Users" \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Accept: application/scim+json" \
  --data-urlencode 'filter=userName eq "alice@example.com"'

# Deactivate with PATCH (replace 123 with the id from the lookup)
curl -sS -X PATCH "$BASE/Users/123" \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [{"op": "replace", "path": "active", "value": false}]
  }'
```

Rules for a client:

- Send `Content-Type: application/scim+json` on `POST`, `PUT` and `PATCH`.
- `count` is at most 200 per page. Page with `startIndex` (1-based).
- An unsupported filter returns `400 invalidFilter`. It never returns every user.
- On `429`, wait for the time in `Retry-After`.
- `externalId` cannot be changed after it is set.

Read [references/inbound-api.md](references/inbound-api.md) for the other credentials (OAuth access token with the `scim` scope), every endpoint, the filter grammar, PATCH rules, `/Bulk`, `/.search`, `/Me` and the error table.

## Other setups

### Outbound SCIM to a SaaS target

Portal: **Integrations → SCIM provisioning → Outbound SCIM** (`/orgs/{orgId}/portal/integrations/scim-outbound`). The user picks a **Target preset** for the vendor, fills in the placeholders (subdomain, directory ID), enters the credential, clicks **Save configuration** and **Test connection**, then turns on **Enable outbound SCIM provisioning** and the events to push. The target endpoint must be a public `https` URL. Read [references/outbound-scim.md](references/outbound-scim.md) for the presets, the options and the setting keys.

### HRIS sync

Portal only: **Integrations → HR & directory sync** (`/orgs/{orgId}/portal/integrations/hris`). The user connects a provider, presses **Test connection**, runs **Sync now** with **Dry run only** on, reads the report, and only then turns dry run off and enables the schedule. Read [references/hris-sync.md](references/hris-sync.md).

Availability of outbound SCIM and HRIS sync depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Verify

1. Discovery needs no token. A `200` with JSON proves the base URL:

   ```bash
   curl -sS https://app.lumoauth.dev/orgs/acme-corp/api/v1/scim2.0/ServiceProviderConfig
   ```

2. An authenticated read proves the token: `GET $BASE/Users?count=1` returns `200` with a `ListResponse`.
3. Create one test user with the `POST` above. `201` means the token, the URL and **Allow user creation** all work. Remove the test user afterwards, with the user's agreement.
4. In the IdP, run its connection test, then assign one test user and check that the account appears under **Users** in the portal.
5. Open **Security → Audit logs** and look for `scim.user.create` and the other `scim.*` events. Reads are not audited.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `401` on the IdP's connection test | Wrong or regenerated token, or **Enable SCIM provisioning** is off | Paste the current token; check the switch |
| `401` with an OAuth token from the app | An ID token, or an access token without the `scim` scope | Use the provisioning token, or request the `scim` scope for a user who holds `scim.manage` |
| `401 Invalid credentials` with Basic auth and a correct password | The account has MFA. Basic auth is refused for it. | Use the provisioning token |
| `403 ... disabled by this organization's SCIM provisioning policy` | The matching policy switch is off | Turn it on, or accept the limit |
| `403` on one group only | The group's role is a system role or holds a LumoAuth permission | Keep admin roles out of IdP-managed groups |
| `400 invalidValue` on create or update | A password that fails the policy, or a group name that maps to a reserved role slug such as `admin` | Stop sending passwords; rename the group |
| `400 invalidFilter` | The filter uses an attribute or operator that is not supported. `GET /Groups` accepts only a few forms. | Use a supported filter (reference file) |
| `409 uniqueness` on `POST /Users` | The `userName` or email exists, possibly on a soft-deleted account | Look the user up first; restore or erase the retained account |
| `501` on `/Me` | The provisioning token has no user | Use `/Users/{id}` |
| Email or name changes from the IdP do not apply | The attribute is protected. The update succeeds and keeps the local value. | Turn the protection off |
| New users arrive inactive | **Auto-activate new users** is off and the IdP does not send `active` | Turn it on, or map `active` in the IdP |
| `lumo settings update scim --set allow_user_deletion=false` changes nothing | The key must be inside `inbound` | Use `--set inbound.allow_user_deletion=false` |
| A user was signed out after a sync | The IdP changed the user's primary email or password | Expected. Both revoke sessions and tokens. |

## Related skills

- `lumoauth-enterprise-sso`: sign-in through the same IdP with SAML or OIDC.
- `lumoauth-users-sessions`: users, invitations and sessions outside SCIM.
- `lumoauth-rbac`: the roles that SCIM groups map to.
- `lumoauth-b2b-saas`: SSO and SCIM per customer organization.
- `lumoauth-integrations`: secrets managers for outbound credentials, and other third-party integrations.
- `lumoauth-audit-compliance`: the `scim.*` audit events, GDPR erasure.
- `lumoauth-admin-api`: API keys and scopes for the settings calls.

## References

- [references/inbound-api.md](references/inbound-api.md): open when writing or debugging SCIM calls against LumoAuth.
- [references/outbound-scim.md](references/outbound-scim.md): open when LumoAuth pushes users to another system.
- [references/hris-sync.md](references/hris-sync.md): open when an HR system is the source of truth.
- https://docs.lumoauth.dev/scim
- https://docs.lumoauth.dev/scim/users
- https://docs.lumoauth.dev/scim/groups
- https://docs.lumoauth.dev/scim/bulk
- https://docs.lumoauth.dev/scim/discovery
- https://docs.lumoauth.dev/user-guide/integrations/scim
- https://docs.lumoauth.dev/integrations/scim-presets
- https://docs.lumoauth.dev/integrations/hris-sync
