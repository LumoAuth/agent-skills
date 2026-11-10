# SAML connection to a customer's IdP (LumoAuth as service provider)

Reference for adding and debugging a SAML IdP connection. The main path is in `SKILL.md`.

## Contents

- [Endpoints](#endpoints)
- [Connection form](#connection-form)
- [Metadata import](#metadata-import)
- [Security settings](#security-settings)
- [Provisioning and attribute mapping](#provisioning-and-attribute-mapping)
- [How a SAML user is matched to an account](#how-a-saml-user-is-matched-to-an-account)
- [Login page button and domain routing](#login-page-button-and-domain-routing)
- [Single logout](#single-logout)
- [Vendor steps](#vendor-steps)
- [Errors](#errors)

## Endpoints

All paths are on the region host, for example `https://app.lumoauth.dev`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/orgs/{orgId}/saml/sp/metadata` | `GET` | SP metadata XML. Also the SP entity ID. |
| `/orgs/{orgId}/saml/sp/login` | `GET` | Start SSO with the organization's IdP |
| `/orgs/{orgId}/saml/sp/login/{idpId}` | `GET` | Start SSO with one IdP when several exist |
| `/orgs/{orgId}/saml/sp/acs` | `POST` | Assertion Consumer Service. Receives the SAML response. Never call it directly. |
| `/orgs/{orgId}/saml/sp/slo` | `GET`, `POST` | Single logout |

`/saml/sp/login` accepts an optional `return_url`. It must be a path on the same origin. An off-site URL is rejected and the organization's dashboard is used.

The SP metadata document is signed with the organization's SAML certificate. It advertises `AuthnRequestsSigned="false"` and `WantAssertionsSigned="false"` because both are decided per IdP at runtime. LumoAuth always requires signed assertions.

## Connection form

Portal: `/orgs/{orgId}/portal/integrations` → **Enterprise SSO (SAML)** → **Add SAML IdP**. The section also shows the SP metadata URL with a **Copy SP metadata URL** button. There is no Admin API or CLI command that creates or edits a SAML IdP connection.

| Field | Description |
|---|---|
| **Display name** | Name of the IdP in the portal and on the login button |
| **Entity ID (issuer)** | The IdP's entity ID |
| **SSO URL** | The IdP's single sign-on endpoint |
| **SLO URL** | The IdP's single logout endpoint (optional) |
| **X.509 certificate (PEM)** | The IdP's signing certificate |
| **Certificate fingerprint (SHA-256)** | Must match the certificate. Filled in by the metadata import. |
| **NameID format** | Email address, persistent, transient or unspecified |
| **Allowed email domains** | Comma-separated, for example `example.com, example.co.uk`. Sub-domains are included. Only addresses in these domains can be provisioned or linked through this IdP. |

To compute a fingerprint from a PEM file:

```bash
openssl x509 -in idp-cert.pem -noout -fingerprint -sha256
```

## Metadata import

In the **Import from IdP metadata** card, paste the metadata URL and click **Fetch from metadata URL**, or paste the raw XML.

- The metadata URL must be a public `https://` endpoint. Private and internal addresses are rejected.
- When the metadata lists several signing certificates (key rollover), the certificate that expires last is selected and a warning shows the others.
- An expired IdP certificate is imported with a warning. Sign-ins fail until the IdP presents a valid certificate.
- Each import is audited as `saml.metadata_imported`.

To read values from a metadata file by hand:

```bash
curl -sS https://idp.example.com/metadata | xmllint --xpath "/*/@entityID" - 2>/dev/null
curl -sS https://idp.example.com/metadata | xmllint --xpath "//*[local-name()='SingleSignOnService']/@Location" - 2>/dev/null
```

## Security settings

| Setting | Default | Description |
|---|---|---|
| **Require signed responses** | On | Verify that the SAML response envelope is signed by the IdP |
| **Require signed assertions** | On, cannot be turned off | Verify that the assertion inside the response is signed |
| **Sign authentication requests** | Off | Sign the authentication and logout requests that LumoAuth sends to the IdP |

LumoAuth also checks the audience, the timestamps (with a small fixed tolerance for clock differences) and replay of assertions. These checks cannot be turned off.

## Provisioning and attribute mapping

| Setting | Description |
|---|---|
| **Just-in-time provisioning** | Create an account on the user's first SAML sign-in |
| **Update user attributes on sign-in** | Sync the profile from the assertion on every sign-in |

SAML attributes are mapped to user fields automatically. The friendly names below, their WS-Federation claim URIs (`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/...`) and their LDAP object identifiers (`urn:oid:...`) are all recognised.

| SAML attribute | User field |
|---|---|
| `email`, `mail`, `emailAddress` | Email |
| `displayName`, `name`, `cn` | Display name |
| `givenName` | First name |
| `surname`, `sn` | Last name |

There is no editor for the inbound mapping. Ask the customer to send attributes under one of the recognised names.

Provisioned users start without roles. The portal has no default-roles field for a SAML IdP. Assign roles in the portal, through groups, or through SCIM groups.

## How a SAML user is matched to an account

A SAML user is bound to the IdP that issued the NameID. The binding is stored as `saml:{idpConfigId}:{nameId}`. A NameID from one IdP never matches a user of another IdP.

On sign-in LumoAuth looks for, in this order:

1. The account that is bound to this IdP and NameID.
2. An existing account with the asserted email. This is used only when the IdP asserts `email_verified` and is authoritative for the email's domain. The account is never taken over when it has a local password, a social provider or a different SAML IdP.
3. A new account (just-in-time provisioning), only for domains that the IdP is authoritative for. Otherwise the sign-in is refused and audited as `saml_jit_domain_mismatch`.

An IdP is authoritative for a domain when the domain is in its **Allowed email domains**. With that list empty, LumoAuth falls back to the host of the entity ID (an IdP at `https://idp.example.com` covers `@example.com`). For linking to existing accounts, the fallback applies only when this is the organization's only SAML IdP.

Recommendation: always set **Allowed email domains**. It is required for linking when the organization has more than one SAML IdP, and domain routing on the login page depends on it.

To attach an existing account (for example one with a password) to the IdP, link it explicitly. See the identities reference file.

## Login page button and domain routing

The connection form has a **Login page** box.

| Setting | Result |
|---|---|
| **Show a button on the login page** | Adds a button for this IdP next to the social buttons. **Button text** sets the label. The default is "Sign in with *name*". |
| **Send people with these email domains here** | When someone types an address in one of the connection's email domains on the login page, the browser goes straight to this IdP instead of the password step |

Routing depends only on the domain that the person types. It never depends on whether an account exists. For a SAML connection the domains are its **Allowed email domains**.

A custom login form can read the route from `POST /orgs/{orgId}/check-email`: the JSON response carries `sso_url` when a connection claims the domain. Send the browser to that URL.

## Single logout

Logout messages must be signed by the IdP. At `/saml/sp/slo` LumoAuth always verifies the signature of an inbound `LogoutRequest` or `LogoutResponse`, whatever the **Require signed responses** setting says. An unsigned logout message is rejected. A `LogoutRequest` ends the browser's session only when its NameID is the one that the session signed in with.

Turn on logout signing in the IdP (Okta: **Sign SAML logout requests**; Entra ID: certificate signing on the app), or do not configure SLO at all. Sign-in is not affected by this.

## Vendor steps

Replace the host for the EU region and `acme-corp` with the organization slug.

### Okta

1. Okta Admin → **Applications → Create App Integration → SAML 2.0**.
2. **Single sign-on URL**: `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/acs`.
3. **Audience URI (SP Entity ID)**: `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/metadata`.
4. Add attribute statements for `email`, `givenName` and `surname`.
5. Copy the IdP metadata URL from the **Sign On** tab and import it in LumoAuth.

### Microsoft Entra ID (Azure AD)

1. Azure portal → **Enterprise applications → New application → Create your own application** (non-gallery).
2. **Set up single sign-on → SAML**.
3. **Identifier (Entity ID)**: `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/metadata`.
4. **Reply URL (ACS)**: `https://app.lumoauth.dev/orgs/acme-corp/saml/sp/acs`.
5. Copy the **App Federation Metadata Url**, or download the Federation Metadata XML, and import it in LumoAuth.

### OneLogin

1. **Applications → Add App → SAML Custom Connector**.
2. Set the ACS URL and the audience to the values above.
3. Import the IdP metadata in LumoAuth.

## Errors

| Error or symptom | Cause | Fix |
|---|---|---|
| **Invalid Signature** | IdP certificate mismatch | Update the certificate and fingerprint in the connection |
| **Audience Mismatch** | The audience in the IdP is not the SP entity ID | Set the audience to the SP metadata URL |
| **Assertion Expired** | Clock difference between the IdP and LumoAuth | Sync the IdP's clock |
| **No IdP Configured** | The organization has no SAML IdP | Add the connection |
| **Missing NameID** | The IdP sends no NameID | Configure NameID in the IdP's application |
| "Account already exists but is not linked to this identity provider" | Several SAML IdPs exist and the account's link has no IdP (`saml_legacy_binding_ambiguous`) | Relink the account to the right IdP |
| "Account already exists; please sign in with your existing method" | The account has a local password, a social provider or another SAML IdP | Expected. Link the account explicitly when the customer wants SSO for it. |
| New users from a second IdP are not created | The email domain is not in that IdP's **Allowed email domains** (`saml_jit_domain_mismatch`) | Add the domain |
| Logout fails and the session stays active | The IdP sent an unsigned `LogoutRequest` | Turn on logout signing in the IdP |
| A high-risk SAML sign-in is refused | Adaptive security blocked it | See `lumoauth-mfa-passkeys` |

Find the audit event for a failed attempt in **Security → Audit logs**.

Docs: https://docs.lumoauth.dev/saml/sp and https://docs.lumoauth.dev/saml/metadata
