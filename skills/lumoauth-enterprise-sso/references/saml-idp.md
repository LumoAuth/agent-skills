# SAML applications (LumoAuth as identity provider)

Reference for registering a SAML service provider (SP) such as Salesforce, Slack, AWS or a custom app that signs users in with their LumoAuth account.

SAML applications are created and edited in the portal only. There is no Admin API or CLI command for them.

## Endpoints

All paths are on the region host, for example `https://app.lumoauth.dev`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/orgs/{orgId}/saml/idp/metadata` | `GET` | IdP metadata XML. Give this URL to the SP. |
| `/orgs/{orgId}/saml/idp/sso` | `GET`, `POST` | Single sign-on. Receives the AuthnRequest (HTTP-Redirect or HTTP-POST binding). |
| `/orgs/{orgId}/saml/idp/slo` | `GET`, `POST` | Single logout |

```bash
curl -sS https://app.lumoauth.dev/orgs/acme-corp/saml/idp/metadata | head -c 400
```

The application's page in the portal lists the values to copy on its **Identity provider** tab: **IdP metadata URL**, **IdP entity ID**, **SSO URL**, **SLO URL** and the signing certificate.

## Register the application

1. Open **Applications** (`/orgs/{orgId}/portal/applications`), click **New application** and choose **SAML 2.0**. That short form asks for the application name, **Entity ID (issuer)** and **ACS URL**.
2. For every option, use the full form at `/orgs/{orgId}/portal/applications/saml/create` and finish with **Create SAML application**.

| Field | Description | Example |
|---|---|---|
| **Application name** | Display name | `Salesforce` |
| **Entity ID (issuer)** | The SP's SAML identifier, from its metadata | `https://saml.salesforce.com` |
| **Description** | Notes (optional) | |
| **Assertion Consumer Service (ACS) URL** | Where the SAML response is posted. Must be an `https` URL on a public host. | `https://sp.example.com/saml/acs` |
| **Single logout (SLO) URL** | Where logout messages are sent (optional). Must be an `https` URL on a public host. | `https://sp.example.com/saml/slo` |
| **Default relay state** | Where to go after SSO when the SP sends none (optional) | |
| **NameID format** | **Email address**, **Persistent**, **Transient** or **Unspecified** | |
| **NameID source** | The user field that fills the NameID: **User email**, **User ID** or **Username** | |
| **Sign SAML responses**, **Sign SAML assertions** | What LumoAuth signs. Both are on by default. | |
| **Require signed AuthnRequests** | The SP must sign its authentication requests | |
| **Encrypt assertions** | Encrypt the assertion to the SP certificate | |
| **SP certificate (PEM)** | The SP's X.509 certificate. Used to verify signed requests and as the encryption target. | |

Ask the user for the entity ID and ACS URL of the SaaS product. They come from the vendor's SSO settings page. Do not guess them.

## Signed AuthnRequests

LumoAuth requires the SP's AuthnRequest to be signed by default. Paste the SP certificate and keep **Require signed AuthnRequests** on. Accepting unsigned requests is a deprecated opt-out, and every unsigned request that it accepts is audited.

A request is also refused with an error page when it carries no `IssueInstant`, is too old, or is dated in the future.

## Assertion encryption

With **Encrypt assertions** on, LumoAuth signs the assertion, then encrypts it to the SP certificate, then signs the response. The SP certificate must be an X.509 certificate with an RSA key of at least 2048 bits.

Encryption fails closed. Saving an application with **Encrypt assertions** on and no SP certificate is rejected. If the certificate is removed later, SSO for that SP fails with an error and a `saml_response_error` audit entry. LumoAuth never falls back to a plaintext assertion.

## Attributes in the assertion

Each application has an outbound attribute mapping from a SAML attribute name to a LumoAuth user field. The user fields are:

| User field | Content |
|---|---|
| `email` | Email address |
| `name` | Full display name |
| `username` | Login identifier |
| `id` | User ID |
| `roles` | Role assignments (multi-valued) |

The portal form has no mapping editor. An application that is created there uses the default mapping:

| SAML attribute name | User field |
|---|---|
| `urn:oid:0.9.2342.19200300.100.1.3` | `email` |
| `urn:oid:2.5.4.42` | `name` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `email` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name` | `name` |

When the SP needs other attribute names (for example a `groups` attribute from `roles`), tell the user that the portal form cannot set them, and configure the SP to read the default names where it allows that.

## Sign-in flow

1. The user opens the SP. The SP sends an AuthnRequest to `/saml/idp/sso`.
2. A user without a LumoAuth session sees the organization's login page. Every sign-in method and the MFA policy of the organization apply.
3. With `ForceAuthn="true"` in the request, LumoAuth ends the existing session and the user signs in again.
4. LumoAuth posts the signed response to the SP's ACS URL. The assertion's `AuthnInstant` is the time when the user signed in.

## Single logout

An SP ends the user's LumoAuth session with a `LogoutRequest` to `/saml/idp/slo`. LumoAuth accepts it when:

- the issuer is a registered, active SAML application of the organization,
- the request is signed with the certificate that is registered for that application (an unsigned or wrongly signed request gets `400`),
- its timestamps are valid,
- the `NameID` is the value that LumoAuth gave this application for the signed-in user. With a **NameID source** other than the email, the SP must send that value, not the email address.

LumoAuth then sends a signed `LogoutResponse` to the application's SLO URL.

## Signing certificate

LumoAuth generates one SAML signing certificate per organization the first time it is needed. The same certificate is used in IdP and SP mode and is published in both metadata documents. There is no portal page or API to rotate or import it. Note the expiry date in the metadata, and plan a new exchange of metadata with the SP applications before that date.

Prefer the metadata URL over copied values in the SP, so that the SP reads the current certificate.

## Common SP values

These are starting points. Confirm each value in the vendor's own SSO settings.

| Product | Entity ID | NameID |
|---|---|---|
| Salesforce | The My Domain URL of the Salesforce org | `emailAddress` (Federation ID) |
| AWS | `urn:amazon:webservices` | `persistent` |
| Slack | `https://slack.com` | `emailAddress` |
| Box | `box.net` | `emailAddress` |

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| Error page at LumoAuth right after the SP redirects | Unsigned AuthnRequest, or a request with a bad timestamp | Add the SP certificate and turn on request signing in the SP. Check the SP's clock. |
| The SP rejects the response signature | The SP holds an old LumoAuth certificate | Give the SP the metadata URL again |
| The SP cannot find the user | NameID format or source does not match what the SP expects | Set **NameID format** and **NameID source** to the SP's identifier |
| SSO fails after turning on encryption | No usable SP certificate | Paste the SP's RSA certificate (2048 bits or more) |
| Saving is refused for the ACS or SLO URL | The URL is not `https` on a public host | Use the SP's public `https` URL |
| Logout from the SP does not end the LumoAuth session | The `LogoutRequest` is unsigned or its NameID differs | Sign the request and send the NameID that LumoAuth issued |

Docs: https://docs.lumoauth.dev/saml/idp and https://docs.lumoauth.dev/user-guide/applications/saml
