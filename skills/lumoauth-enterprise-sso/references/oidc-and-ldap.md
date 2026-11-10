# OIDC connections and LDAP directories

Reference for the two other ways to sign users in with a corporate identity. Both are configured in the portal only: `/orgs/{orgId}/portal/integrations` (**Settings → Integrations**). There is no Admin API or CLI command that creates or edits these connections.

## OIDC connection (LumoAuth as relying party)

### Who can sign in

Read this before choosing OIDC.

An OIDC connection signs in only a person whose account is already linked to that connection. It does not create an account on first sign-in. It does not link an existing account by email address. A person without a link sees:

> Your account is not linked to this identity provider yet. Sign in with your usual method, or ask your administrator for access.

The attempt is audited as `oidc_login_unlinked_identity_refused`. The link commands in the portal, the Admin API and the CLI cover SAML and LDAP identities, not OIDC connections. For a customer whose users must be created on first sign-in, use a SAML connection.

Every sign-in through a deactivated connection is refused, including one that started before the deactivation.

### Add the connection

Section **Enterprise SSO (OIDC)**. Use a vendor tile under **OIDC quick connect**, or **Add OIDC IdP** for any other OpenID Connect provider.

Register this redirect URI with the IdP. The form shows it:

```text
https://app.lumoauth.dev/orgs/acme-corp/oidc/rp/callback
```

| Field | Description |
|---|---|
| **Display name** | Name of the IdP in the portal and on the login button |
| **Issuer URL** | The provider's issuer, for example `https://accounts.google.com` |
| **Client ID** | From the IdP |
| **Client secret** | From the IdP. The user types it into the portal. |
| **Scopes** | For example `openid profile email` |
| **Endpoints** (optional) | Leave blank. LumoAuth reads them from `{issuer}/.well-known/openid-configuration`. |
| **Email domains** (in the **Login page** box) | Comma-separated. The email domains that people from this IdP use. Needed for domain routing. |

The **User provisioning** section has **Update user attributes on sign-in**, which syncs the profile of a linked account on every sign-in.

### Vendor presets

Each preset asks only for the vendor-specific fields and derives the issuer.

| Connector | Fields to ask the user for | Issuer that is derived |
|---|---|---|
| Microsoft Entra ID | Directory (tenant) ID | `https://login.microsoftonline.com/{tenant}/v2.0` |
| Okta | Okta domain (optionally with `/oauth2/default`) | `https://{domain}` |
| Google Workspace | Workspace domain (optional; restricts the `hd` claim) | `https://accounts.google.com` |
| OneLogin | OneLogin subdomain | `https://{subdomain}.onelogin.com/oidc/2` |
| Ping Identity | PingOne environment ID and auth domain | `https://{auth domain}/{env id}/as` |
| JumpCloud | None | `https://oauth.id.jumpcloud.com` |
| Cisco Duo SSO | Duo SSO subdomain | `https://sso-{id}.sso.duosecurity.com/oidc/{client_id}` |

Each connector page shows the redirect URI and the vendor's own setup steps.

### Login page

The **Login page** box works as for SAML: **Show a button on the login page** adds a button, and **Send people with these email domains here** routes by the email domain that the person types. Routing needs the **Email domains** field.

The sign-in start URL of one connection is `GET /orgs/{orgId}/oidc/rp/login/{idpId}`.

## LDAP / Active Directory

LumoAuth can check a typed password against an LDAP or Active Directory server and create the account on first sign-in.

### Add the directory

Section **Directory sync (LDAP/AD)** → **Add LDAP/AD directory**.

| Field | Description |
|---|---|
| **Display name** | Name of the directory in the portal |
| **LDAP server URL** | Hostname or IP, with or without the protocol. Must resolve to a public address. |
| **Port** | 389 for LDAP with STARTTLS, 636 for LDAPS |
| **Base DN** | Base distinguished name for user searches |
| **User search base** | Optional sub-tree under the base DN |
| **Bind DN** | DN of the service account for searches |
| **Bind password** | Password of the service account. Stored encrypted and never shown again. Leave blank on edit to keep it. |
| **User search filter** | For example `(sAMAccountName={username})` |
| **Use TLS (STARTTLS)** / **Use SSL (LDAPS)** | One of them is required |
| **Just-in-time provisioning** | Create an account on the first directory sign-in |

Attribute fields name the LDAP attribute to read:

| Field | Typical attribute |
|---|---|
| **Username attribute** | `sAMAccountName` or `uid` |
| **Email attribute** | `mail` |
| **Name attribute** | `displayName` |
| **Given name attribute** | `givenName` |
| **Surname attribute** | `sn` |

Group membership and phone numbers are not read from the directory. LDAP assigns no roles on provisioning.

Use the form's **Test connection** button after saving. It reports a generic error on failure.

### Connection rules

These rules apply on every save and on every sign-in. They cannot be switched off.

| Rule | Consequence for setup |
|---|---|
| The host must be a public, resolvable hostname or IP | A directory behind a firewall needs a public endpoint, or a tunnel with a public address |
| The TLS certificate of the server is always verified | Use a certificate from a public certificate authority. There is no "skip verification" option. |
| Plain LDAP without STARTTLS or LDAPS is refused unless **Allow unencrypted transport** is ticked | Keep it off. Its use is recorded in the audit log. |
| An empty password is refused before any bind | Nothing to configure |
| When the server URL, port, bind DN or a TLS switch changes, the bind password must be entered again | Have the password at hand when editing |

### Which passwords go to the directory

LumoAuth sends the typed password to the directory only when it can be a directory password: no local account has the typed identifier, the account is linked to a directory entry, or the account has no local password. For every other account the password is checked locally and the directory is not contacted. A local account with a password can therefore sign in while the directory is unreachable.

### How an LDAP user is matched to an account

An LDAP account is linked to its entry by directory connection and DN. An email change in the directory does not create a second account.

When no account is linked to the DN yet, LumoAuth adopts the account with the same email only when nothing else owns it. Otherwise the sign-in fails like a wrong password and is audited as `ldap.account_link_refused` with a `reason`:

| `reason` | The account |
|---|---|
| `bound_to_different_dn` | is already linked to another DN |
| `bound_to_different_directory` | is linked to another LDAP connection |
| `federated_account` | is linked to a social provider |
| `different_auth_source` | comes from another sign-in source such as SAML or SCIM |
| `local_password` | has its own local password |
| `ambiguous_email` | is one of several accounts whose address differs only in letter case |

To let a refused user in, link the account to the directory entry explicitly:

```bash
lumo users identities link jane@example.com --ldap-config 1 --dn "uid=jane,ou=people,dc=example,dc=com"
```

Leave out `--dn` to let the server look the entry up by the user's email, then username. Add `--ldap-only` to disable the local password.

### LDAP problems

| Symptom | Cause | Fix |
|---|---|---|
| Saving is refused for the server URL | The host resolves to a private or loopback address | Use a public endpoint |
| "Could not start TLS with the LDAP server" | The certificate is not trusted or does not match the host | Install a certificate from a public certificate authority |
| A directory user gets "Invalid credentials" | The account with that email is owned by another source (see the table above) | Read the `ldap.account_link_refused` audit row and link the account |
| A directory user signs in to the wrong local account by username | A directory `uid` equals the username of another local account that has a password | The directory user signs in with the email address |
| `422 directory_lookup_failed` on link | The directory search found nothing | Pass `--dn` |

Docs: https://docs.lumoauth.dev/user-guide/authentication/enterprise-sso and https://docs.lumoauth.dev/federation
