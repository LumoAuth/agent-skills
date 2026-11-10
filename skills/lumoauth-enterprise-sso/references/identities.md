# Federated identities: list, link, unlink, relink

A federated identity is the external identity that signs in as a LumoAuth account: a SAML IdP plus NameID, an LDAP directory plus DN, or a social provider. This file covers the Admin API and the `lumo` commands that manage those links.

## Rules that apply to every change

- A link decides who can sign in as the account. LumoAuth treats a change like a credential change.
- Reading needs the permission `users.view` (scope `admin:users:read`). Changing needs `users.edit` (scope `admin:users:write`).
- The caller cannot change the links of an account that holds permissions that the caller does not hold (`403`).
- A caller with a user token (for example from `lumo login`) must have passed MFA a short time ago. Otherwise the API answers `403 step_up_required`. Retry with the ID of an approved step-up challenge in the `X-MFA-Challenge` header (`--mfa-challenge` in the CLI). An organization API key is not subject to step-up. See `lumoauth-mfa-passkeys` for the challenge API.
- The user's sessions and tokens are revoked. The user receives an email with a "This wasn't me" link.
- Each change is audited: `identity.link.created`, `identity.link.removed`, `identity.link.bulk_relinked`.
- An account signs in through one federated source at a time. Linking SAML is refused (`409 identity_conflict`) while the account is linked to LDAP or a social provider. Linking LDAP is refused while it is linked to SAML. Unlink the other source first.

Show the user each command that links, unlinks or relinks before running it, and name the user who will be signed out.

## CLI

```bash
export LUMO_ORG=acme-corp

# List
lumo users identities list jane@example.com

# Link a SAML identity: the IdP's config ID and the NameID that the IdP asserts
lumo users identities link jane@example.com --saml-idp 7 --name-id jane@example.com

# Link an LDAP identity
lumo users identities link jane@example.com --ldap-config 1 --dn "uid=jane,ou=people,dc=example,dc=com"

# Unlink
lumo users identities unlink jane@example.com --type ldap --yes
```

| Command | Flags |
|---|---|
| `lumo users identities list <user-id-or-email>` | none |
| `lumo users identities link <user-id-or-email>` | `--saml-idp <id>` with `--name-id <nameid>`; or `--ldap-config <id>` with optional `--dn <dn>` and `--ldap-only`; `--mfa-challenge <id>` |
| `lumo users identities unlink <user-id-or-email>` | `--type saml\|ldap\|social` (required), `--yes`, `--mfa-challenge <id>` |
| `lumo identities legacy-saml` | `--idp <id>`, `--relink`, `--user <id>` (repeatable), `--dry-run`, `--yes`, `--mfa-challenge <id>` |

Notes:

- `list` prints the type, the source (IdP or directory name and ID), the identity and notes such as *legacy*, *LDAP only* or *orphaned* (the IdP or directory was deleted). `-o json` passes the API response through.
- A new link replaces the user's existing link of the same type.
- `link` fails without calling the server when the flags are incomplete or mix SAML and LDAP.
- `unlink` asks for confirmation on a terminal. Without a terminal and without `--yes` it stops and sends nothing.
- Unlinking LDAP also turns off **Directory sign-in only**. The user then needs a password reset to sign in with a local password.
- The numeric ID of a SAML IdP or LDAP directory is shown in the output of `lumo users identities list` for a linked user (`idp_id`, `ldap_config_id`) and in the URL of the connection's edit page in the portal.

## Admin API

Paths are relative to `{base}/orgs/{orgId}/api/v1`. `{userId}` is the user ID or the email address.

| Method | Path | Permission | Scope |
|---|---|---|---|
| `GET` | `/admin/users/{userId}/identities` | `users.view` | `admin:users:read` |
| `POST` | `/admin/users/{userId}/identities` | `users.edit` | `admin:users:write` |
| `DELETE` | `/admin/users/{userId}/identities/{type}` | `users.edit` | `admin:users:write` |
| `GET` | `/admin/identities/legacy-saml` | `users.view` | `admin:users:read` |
| `POST` | `/admin/identities/legacy-saml` | `users.edit` | `admin:users:write` |

List response:

```json
{
  "data": {
    "auth_source": "saml",
    "ldap_only": false,
    "bindings": [
      {
        "type": "saml",
        "idp_id": 7,
        "idp_name": "Okta",
        "name_id": "jane@example.com",
        "binding_key": "saml:7:jane@example.com",
        "hashed": false,
        "legacy": false,
        "orphaned": false
      }
    ]
  }
}
```

`type` is `saml`, `ldap` (with `ldap_config_id`, `ldap_config_name`, `dn`, `ldap_only`, `last_sync_at`), `social` (with `provider`, `subject`) or `social_account` (a provider that the user linked from the account page; read-only here).

Link request body:

| Field | Type | Description |
|---|---|---|
| `type` | string | Required. `saml` or `ldap`. |
| `idp_id` | integer | SAML: the ID of the SAML IdP connection |
| `name_id` | string | SAML: the NameID that the IdP asserts for this user |
| `ldap_config_id` | integer | LDAP: the ID of the directory connection |
| `dn` | string | LDAP: the distinguished name. Leave out to look the entry up by the user's email, then username. |
| `ldap_only` | boolean | LDAP: also disable the local password. Default `false`. |

```bash
curl -sS -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/users/$USER_ID/identities" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "saml", "idp_id": 7, "name_id": "jane@example.com"}'
```

The call returns `201` with the new binding in `data`.

Unlink: `DELETE /admin/users/{userId}/identities/{type}` with `type` = `saml`, `ldap` or `social`.

| Status | `error` | When |
|---|---|---|
| `403` | `forbidden` | The account holds permissions that the caller lacks |
| `403` | `step_up_required` | A user token without fresh MFA |
| `409` | `identity_conflict` | Another user already holds that identity, or the user is linked to a different federated source |
| `422` | `directory_lookup_failed` | The directory search found nothing or failed. Pass `dn`. |
| `422` | invalid input | `type` is not `saml` or `ldap`, or a required field is missing |

## Legacy SAML users

Older SAML accounts store a bare NameID without the IdP.

- An organization with one SAML IdP is migrated automatically. A remaining row is upgraded on the user's next sign-in.
- In an organization with several SAML IdPs, LumoAuth cannot tell which IdP issued the NameID. Those users are refused at SAML sign-in with "Account already exists but is not linked to this identity provider" and audited as `saml_legacy_binding_ambiguous`.

Fix:

1. Set **Allowed email domains** on every SAML IdP in the portal, so that LumoAuth can suggest the IdP for each user.
2. Read the report:

   ```bash
   lumo identities legacy-saml
   ```

3. Preview the relink for one IdP. This changes nothing:

   ```bash
   lumo identities legacy-saml --idp 7 --relink --dry-run
   ```

4. Show the plan to the user. After confirmation, apply it:

   ```bash
   lumo identities legacy-saml --idp 7 --relink --yes
   ```

Without `--user`, `--relink` covers every legacy user that the IdP's email domains claim. Relinking keeps the NameID and binds it to the chosen IdP. Each relinked user is signed out and emailed. Two kinds of entries are skipped and listed with the reason: users who hold permissions that the caller lacks, and NameIDs that are already linked to someone else at that IdP.

The same through the API: `GET /admin/identities/legacy-saml` returns the report with `suggested_idp_id` per user. `POST` the same path with `{"idp_id": 7, "all_matching_domains": true, "dry_run": true}` (or `"user_ids": [...]`) to preview, then with `"dry_run": false` to apply.

In the portal: **Integrations → SAML IdP → Edit** shows a **Legacy users** panel when the organization has more than one SAML IdP and legacy users exist. **Preview relink to ...** is the dry run, then **Relink N users**.

## Changing where a connection points

Some settings of a connection decide who can sign in as every account that is bound to it:

| Connection | Settings |
|---|---|
| SAML IdP | Entity ID, SSO URL and certificate |
| LDAP directory | Server URL, port, base DN, user search base, bind DN, and turning TLS off |
| OIDC IdP | Issuer, token endpoint, userinfo endpoint, JWKS URI and the claim that identifies the user |
| Social login provider | Provider type, token URL, userinfo URL, issuer, JWKS URI and the Microsoft tenant ID |

To change one of these, the caller must hold every permission that the bound accounts hold. Otherwise the save is refused with `403`, the message gives the number of accounts that hold more, and the audit log records `identity.connection.trust_anchor_change_refused`. The organization's owner can always make the change.

Other settings are not affected: display name, button text, email domains, attribute mapping, scopes, client ID and secret, and activation.

For an agent this means: when a certificate rotation or an issuer change is refused with `403`, do not retry with another credential. Tell the user that the organization owner must save the change.

Docs: https://docs.lumoauth.dev/cli/identities and https://docs.lumoauth.dev/api-reference/users
