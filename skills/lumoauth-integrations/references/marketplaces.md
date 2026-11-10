# Marketplace and catalogue listings

Use this file when a user asks whether LumoAuth is "in the Okta Integration Network", "in the Entra gallery", "on AWS Marketplace" or similar, usually during a procurement or integration review.

## The short answer

LumoAuth is not listed in the identity catalogues or cloud marketplaces below. There is nothing to configure for them in the portal. A listing is not needed to connect: each of these products connects to LumoAuth through open standards, with a manual (custom app) setup.

Do not tell a user to "find LumoAuth in the gallery". Send them to the standards-based setup instead.

## How to connect without a listing

| Product | Connect with | Skill |
|---|---|---|
| Okta | A custom SAML 2.0 or OIDC app in Okta; SCIM 2.0 provisioning to `{base}/orgs/{orgId}/api/v1/scim2.0` | `lumoauth-enterprise-sso`, `lumoauth-scim` |
| Microsoft Entra ID | A non-gallery enterprise application with SAML or OIDC; SCIM provisioning with a bearer token | `lumoauth-enterprise-sso`, `lumoauth-scim` |
| Google Workspace | A custom SAML app in the Google Admin console | `lumoauth-enterprise-sso` |

## What LumoAuth provides that such integrations rely on

| Capability | Notes |
|---|---|
| SAML 2.0 service provider | Accepts an enterprise identity provider. SP-initiated and IdP-initiated sign-in, signed assertions, metadata URL. |
| SAML 2.0 identity provider | LumoAuth as the identity provider for downstream apps, with a metadata endpoint |
| OpenID Connect provider | Discovery document, authorization code with PKCE, pushed authorization requests, CIBA, device authorization, back-channel logout |
| OIDC federation | Sign-in through enterprise identity providers such as Okta, Entra, Google |
| SCIM 2.0 server | `/Users`, `/Groups`, `/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`, filtering, pagination, PATCH, soft delete through `active: false`. Bearer token per organization. |
| SCIM 2.0 client | Outbound provisioning to downstream apps |
| Dynamic client registration | For OAuth clients |
| Per-organization endpoints | Every URL contains `/orgs/{orgId}/`, so one external tenant maps to one LumoAuth organization |

## Cloud marketplaces

| Marketplace | Status |
|---|---|
| AWS Marketplace | Not available. An organization cannot be billed through AWS. |
| Azure Marketplace | Not available. An organization cannot be billed through Azure. |

Billing is through Stripe only, on the organization's Billing page (`/orgs/{orgId}/portal/billing`). See `billing.md` in this folder.

## Reference

- https://docs.lumoauth.dev/integrations/marketplaces
