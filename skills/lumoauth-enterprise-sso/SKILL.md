---
name: lumoauth-enterprise-sso
description: >-
  Sets up enterprise single sign-on (SSO) in a LumoAuth organization: a SAML
  2.0 connection to a customer's identity provider (LumoAuth as service
  provider: SP metadata, entity ID, ACS URL, SLO, allowed email domains,
  just-in-time provisioning, attribute mapping), OpenID Connect connections
  (Okta, Microsoft Entra ID / Azure AD, Google Workspace, OneLogin, Ping,
  JumpCloud, Duo), LumoAuth as SAML identity provider for third-party SaaS
  (SAML applications, IdP metadata, NameID), LDAP / Active Directory, the SSO
  button and email-domain routing (home realm discovery), and linking or
  relinking federated identities with `lumo users identities`, `lumo
  identities legacy-saml` and the Admin API. Use when the user asks to add
  SAML or OIDC SSO for a customer, connect Okta, Entra ID or ADFS, make
  LumoAuth the IdP for Salesforce, Slack or AWS, fix a SAML error (invalid
  signature, audience mismatch, account not linked), or relink SAML or LDAP
  users. Not for social login or SCIM provisioning.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth enterprise SSO

Connect an organization to a corporate identity provider (IdP), or make LumoAuth the identity provider for SAML applications. Connections are created in the portal. The Admin API and the `lumo` CLI manage the links between users and their federated identities. The app itself needs no SAML or LDAP code: it keeps using the normal OAuth 2.0 / OIDC sign-in, and the hosted login page sends the user to the right IdP.

## When to use

- A customer or the user's own company wants sign-in through Okta, Microsoft Entra ID, ADFS, Google Workspace, OneLogin, Ping, JumpCloud or another SAML or OIDC provider.
- Users must sign in to a SAML application (Salesforce, Slack, AWS, a custom SP) with their LumoAuth account.
- Users sign in against an LDAP or Active Directory server.
- A SAML sign-in fails, or a user must be linked or relinked to an IdP.

Do not use this skill for:

- Google, GitHub, Microsoft and other social buttons: use `lumoauth-login-methods`.
- Creating, updating and removing users from the IdP automatically (SCIM): use `lumoauth-scim`.
- One SSO connection per customer organization in a B2B product: start with `lumoauth-b2b-saas`.
- AI agents and workloads that federate from Kubernetes, AWS or GitHub: use `lumoauth-agent-identity`.
- The OAuth code in the app: use the framework skill or `lumoauth-oauth-oidc`.

## Before you start

Decide the direction first. The two are often confused.

| Direction | LumoAuth is | Configure under |
|---|---|---|
| Users sign in to LumoAuth with a corporate IdP | SAML service provider (SP), or OIDC relying party | **Settings → Integrations**, sections **Enterprise SSO (SAML)** and **Enterprise SSO (OIDC)** |
| Users sign in to another product with LumoAuth | SAML identity provider (IdP) | **Applications → New application → SAML 2.0** |

Collect these values. Ask the user for any value that is missing. Do not guess.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`acme-corp` in the examples) | The portal URL: `/orgs/{orgId}/portal` |
| For a SAML connection: the IdP metadata URL (public `https://`), or the entity ID, SSO URL and signing certificate | The customer's IdP admin |
| For an OIDC connection: issuer URL (or vendor tenant/domain), client ID, client secret | The customer's IdP admin |
| The email domains of the customer (`example.com`) | The customer |
| For a SAML application: the SP entity ID and ACS URL (public `https://`) | The SaaS vendor's SSO settings |

What can be automated:

| Task | Portal | Admin API | CLI |
|---|---|---|---|
| Create or edit a SAML IdP connection | Yes | No | No |
| Create or edit an OIDC IdP connection | Yes | No | No |
| Create or edit an LDAP directory | Yes | No | No |
| Create or edit a SAML application (LumoAuth as IdP) | Yes | No | No |
| Read SP and IdP metadata | Yes | Public URLs | `curl` |
| List, link, unlink a user's SAML or LDAP identity | Yes | `/admin/users/{userId}/identities` | `lumo users identities` |
| Report and relink legacy SAML users | Yes | `/admin/identities/legacy-saml` | `lumo identities legacy-saml` |

Availability of SAML applications (LumoAuth as IdP) and LDAP directories depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

For the portal-only tasks, give the user the page to open and the exact values to enter. Do not invent an API call. Secrets (the OIDC client secret, the LDAP bind password) are typed into the portal by the user. Never ask the user to paste them into the chat, and never write them to a file.

## Steps: connect a customer's IdP with SAML

This is the main path. SAML connections create accounts on first sign-in.

### 1. Give the customer the SP values

The values are fixed per organization:

| Setting in the IdP | Value |
|---|---|
| SP metadata URL | `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/metadata` |
| SP entity ID (audience) | `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/metadata` |
| ACS URL (reply URL) | `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/acs` |
| SLO URL (optional) | `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/slo` |
| NameID format | `emailAddress` |

Check that the metadata is served:

```bash
curl -sS https://app.lumoauth.dev/orgs/acme-corp/saml/sp/metadata | head -c 400
```

Ask the customer to send the attributes `email`, `givenName` and `surname` (or `displayName`). LumoAuth maps the common attribute names automatically.

### 2. Add the IdP in the portal

Tell the user to:

1. Open `/orgs/{orgId}/portal/integrations` (**Settings → Integrations**) and find **Enterprise SSO (SAML)**.
2. Click **Add SAML IdP**.
3. Paste the IdP metadata URL under **Import from IdP metadata** and click **Fetch from metadata URL**. The form fills in the entity ID, SSO and SLO URLs, NameID format, certificate and fingerprint. When only a file exists, paste the raw XML.
4. Enter a **Display name**.
5. Set **Allowed email domains** to the customer's domains, for example `example.com`. Only addresses in these domains can be provisioned or linked through this IdP.
6. In **User provisioning**, keep **Just-in-time provisioning** on so that accounts are created on first sign-in. Turn on **Update user attributes on sign-in** to sync the profile on every sign-in.
7. In the **Login page** box, turn on **Show a button on the login page**, or **Send people with these email domains here** to route by email domain.
8. Click **Add identity provider**.

Keep **Require signed responses** on. Signed assertions are always required. Read [references/saml-sp.md](references/saml-sp.md) for every field, the account matching rules, vendor steps for Okta and Entra ID, and the error table.

### 3. Let the app use the connection

No SAML code is needed in the app. The app starts its normal authorization code + PKCE request (`lumoauth-oauth-oidc`). On the hosted login page the user then:

- types an address in one of the connection's email domains and is sent straight to the IdP (when domain routing is on), or
- clicks the button of the connection.

After the IdP confirms the user, LumoAuth returns to the app's redirect URI with an authorization code as usual. The app receives LumoAuth tokens, never the SAML assertion.

To pre-fill the email field, add the standard `login_hint` parameter with the address to the authorization request.

A direct start URL also exists: `GET /orgs/{orgId}/saml/sp/login` (or `/saml/sp/login/{idpId}` when several IdPs exist). Its optional `return_url` must be a path on the LumoAuth origin. Any other value is replaced by the portal dashboard. Use it for portal sign-in or tests, not as the entry point of an OAuth app.

### 4. Roles for the new users

Users who are provisioned through SAML start with no roles. Assign roles afterwards in the portal, through groups (`lumoauth-rbac`), or let the IdP manage groups through SCIM (`lumoauth-scim`). A connection can never make a user an admin.

## Other setups

### OIDC connection to an IdP

Portal: **Settings → Integrations → Enterprise SSO (OIDC)**. Use a vendor preset under **OIDC quick connect** or **Add OIDC IdP** for any other provider. Register the redirect URI that the form shows with the IdP:

```text
https://app.lumoauth.dev/orgs/acme-corp/oidc/rp/callback
```

With an issuer URL, LumoAuth reads the endpoints from the provider's discovery document.

Important limit: an OIDC connection signs in only a person whose account is already linked to that connection. It does not create an account on first sign-in and does not link an existing account by email address. A person without a link sees "Your account is not linked to this identity provider yet." When the customer needs accounts to be created on first sign-in, use a SAML connection. Read [references/oidc-and-ldap.md](references/oidc-and-ldap.md).

### LumoAuth as SAML IdP for a SaaS product

1. Tell the user to open **Applications**, click **New application** and choose **SAML 2.0**. The full form is at `/orgs/{orgId}/portal/applications/saml/create`.
2. Enter the **Application name**, the **Entity ID (issuer)** of the SP and its **Assertion Consumer Service (ACS) URL**. Both URLs (ACS and optional SLO) must be `https` on a public host.
3. Give the SaaS product the IdP metadata URL:

```text
https://app.lumoauth.dev/orgs/acme-corp/saml/idp/metadata
```

The SSO endpoint is `/orgs/{orgId}/saml/idp/sso` and the logout endpoint is `/orgs/{orgId}/saml/idp/slo`. LumoAuth requires signed AuthnRequests from the SP by default, so paste the **SP certificate (PEM)** in the form. Read [references/saml-idp.md](references/saml-idp.md) for NameID source, signing, encryption and attribute mapping.

### LDAP / Active Directory

Portal: **Settings → Integrations → Directory sync (LDAP/AD) → Add LDAP/AD directory**. The directory host must resolve to a public address, and STARTTLS or LDAPS is required. The server certificate is always verified. Read [references/oidc-and-ldap.md](references/oidc-and-ldap.md).

### Link, unlink or relink a user

A federated link decides which external identity signs in as an account. Every change signs the user out everywhere, emails the user and is audited. Show the user each command before running it.

```bash
export LUMO_ORG=acme-corp
lumo users identities list jane@example.com
lumo users identities link jane@example.com --saml-idp 7 --name-id jane@example.com
lumo users identities link jane@example.com --ldap-config 1 --dn "uid=jane,ou=people,dc=example,dc=com"
lumo users identities unlink jane@example.com --type saml --yes
```

Required: scope `admin:users:write` and permission `users.edit` (reads: `admin:users:read`, `users.view`). The caller cannot change the links of an account that holds permissions that the caller lacks. With a token from `lumo login`, pass `--mfa-challenge` with the ID of an approved step-up challenge; an organization API key is exempt. Read [references/identities.md](references/identities.md) for the API bodies, the bulk relink of legacy SAML users and the rule for changing where a connection points.

## Verify

1. Fetch the metadata: `curl -sS {base}/orgs/{orgId}/saml/sp/metadata` (SP) or `.../saml/idp/metadata` (IdP) returns XML with the expected `entityID`.
2. Open `{base}/orgs/{orgId}/saml/sp/login` in a private browser window. The browser goes to the IdP, and after sign-in lands in LumoAuth signed in.
3. Run the app's own sign-in with a test user of the customer. Check that the user is routed to the IdP and returns to the app with tokens. The `amr` claim contains `fed` for a federated sign-in.
4. Check the new account: `lumo users identities list <email>` shows the SAML link with the IdP.
5. Open **Security → Audit logs** and look for `saml_login_success`, or the failure event that names the cause.
6. For a SAML application: start sign-in from the SaaS product and check that it accepts the assertion.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid Signature" | The IdP certificate in the connection is not the one that signs | Import the metadata again, or paste the current certificate and fingerprint |
| "Audience Mismatch" | The audience in the IdP is not the SP entity ID | Set it to `{base}/orgs/{orgId}/saml/sp/metadata` exactly, with the right region host |
| "Assertion Expired" | The IdP's clock is off | Sync the IdP's clock |
| New users from the IdP are not created (`saml_jit_domain_mismatch`) | The email domain is not in **Allowed email domains** | Add the domain to that IdP |
| "Account already exists; please sign in with your existing method" | The account has a local password, a social provider or another SAML IdP. SAML never takes over such an account. | Link the account explicitly with `lumo users identities link` |
| "Account already exists but is not linked to this identity provider" | Several SAML IdPs exist and the account has an old link without an IdP | Relink with `lumo identities legacy-saml` |
| OIDC connection: "Your account is not linked to this identity provider yet" | OIDC connections do not create or link accounts on sign-in | Use SAML for this customer, or have the person sign in with the usual method |
| Logout at the IdP leaves the LumoAuth session active | The IdP sent an unsigned `LogoutRequest` | Turn on logout signing in the IdP, or do not configure SLO |
| Typing the email does not route to the IdP | The connection has no email domains, or routing is off | Set the domains and turn on **Send people with these email domains here** |
| `403` when changing the entity ID, SSO URL, certificate, issuer or LDAP server | The caller does not hold every permission that the bound accounts hold | The organization owner makes the change |
| The SaaS product's sign-in fails at LumoAuth with an error page | The SP sent an unsigned AuthnRequest | Add the SP certificate and have the SP sign requests |
| Metadata import is refused | The metadata URL is not a public `https://` address | Paste the XML instead |

## Related skills

- `lumoauth-scim`: provision and deprovision users and groups from the IdP.
- `lumoauth-b2b-saas`: SSO per customer organization.
- `lumoauth-login-methods`: social login and the other first-step methods.
- `lumoauth-mfa-passkeys`: MFA policy and step-up for admins who relink identities.
- `lumoauth-rbac`: roles and groups for provisioned users.
- `lumoauth-branding`: login page appearance and custom domains.
- `lumoauth-oauth-oidc`: the app's authorization request and callback.

## References

- [references/saml-sp.md](references/saml-sp.md): open when adding or debugging a SAML IdP connection.
- [references/saml-idp.md](references/saml-idp.md): open when registering a SAML application that uses LumoAuth as IdP.
- [references/oidc-and-ldap.md](references/oidc-and-ldap.md): open for OIDC connections and LDAP directories.
- [references/identities.md](references/identities.md): open when linking, unlinking or relinking users.
- https://docs.lumoauth.dev/user-guide/authentication/enterprise-sso
- https://docs.lumoauth.dev/federation
- https://docs.lumoauth.dev/saml
- https://docs.lumoauth.dev/saml/sp
- https://docs.lumoauth.dev/saml/idp
- https://docs.lumoauth.dev/saml/metadata
- https://docs.lumoauth.dev/user-guide/applications/saml
- https://docs.lumoauth.dev/cli/identities
