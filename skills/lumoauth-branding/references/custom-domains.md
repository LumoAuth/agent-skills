# Custom domains

A custom domain serves an organization's sign-in pages and OAuth endpoints from the user's own hostname, for example `https://auth.example.com/login` instead of `https://app.lumoauth.dev/orgs/acme-corp/login`.

Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Where it is configured

Portal only: **Settings → Custom domains**

```text
/orgs/{orgId}/portal/custom-domains
```

There is no Admin API and no CLI command for custom domains. The actions need a signed-in admin with the `settings.manage` permission. Give the user the page and the DNS records to create. An agent with access to the user's DNS provider may create the records, after showing them to the user.

## Set up

### 1. Add the domain

1. **Add domain**.
2. **Domain name**: the hostname only, for example `auth.example.com`. No `https://`, no trailing slash.
3. **Verification method**: **TXT record (recommended)**. It does not affect how the domain resolves.
4. **Add domain**.

### 2. Create the DNS records

Open **DNS setup** on the domain's card. Copy the records from there. For the TXT method they have this shape:

| Type | Name | Value |
|---|---|---|
| `TXT` | `_lumoauth-verify.auth.example.com` | `lumoauth-verify=<token from the DNS setup card>` |
| `CNAME` | `auth.example.com` | The LumoAuth host of the region: the host in the address of the portal, for example `app.lumoauth.dev` |

The TXT record proves control of the zone. The CNAME record sends traffic to LumoAuth. The token is different for every domain entry. Never reuse a token from another entry.

With the **CNAME record** verification method, the card shows the records for that method. The ownership TXT record is still needed for the first verification.

Check propagation before verifying:

```bash
dig +short TXT _lumoauth-verify.auth.example.com
dig +short CNAME auth.example.com
```

### 3. Verify

Choose **Verify now** in the domain's actions menu. Verification needs two successful checks a short time apart. When the first check passes, the domain can still show as pending. Wait about a minute and choose **Verify now** again. A failed check restarts the cycle.

After verification LumoAuth activates the domain and provisions the TLS certificate.

### 4. Manage

All in the domain's actions menu:

| Action | Effect |
|---|---|
| **Verify now** | Check the DNS records |
| **Set primary** | Make this domain the primary domain |
| **Enable** / **Disable** | Turn the domain on or off without removing it |
| **Remove** | Delete the mapping |

An organization can have several custom domains. One is the primary domain. For a request that arrives on a verified domain, the issuer is that domain. The primary domain is the issuer of tokens that are minted outside a request. Keep applications on the primary domain.

## What changes for applications

On the custom domain the `/orgs/{orgId}` prefix is dropped. The endpoints keep their `/api/v1/...` paths. The issuer is the bare domain with no path.

| | Platform address | Custom domain |
|---|---|---|
| Login page | `https://app.lumoauth.dev/orgs/acme-corp/login` | `https://auth.example.com/login` |
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` | `https://auth.example.com` |
| Discovery | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/openid-configuration` | `https://auth.example.com/.well-known/openid-configuration` |
| Authorization server metadata | | `https://auth.example.com/.well-known/oauth-authorization-server` |
| Authorization endpoint | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize` | `https://auth.example.com/api/v1/oauth/authorize` |
| Token endpoint | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token` | `https://auth.example.com/api/v1/oauth/token` |
| JWKS | | `https://auth.example.com/api/v1/.well-known/jwks.json` |
| SCIM base URL | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/scim2.0` | `https://auth.example.com/api/v1/scim2.0` |

The platform address keeps working next to the custom domain.

### Issuer rule

Every token that is minted for a request on the custom domain carries `"iss": "https://auth.example.com"`. Every token that is minted on the organization path carries `"iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1"`. The `iss` parameter of authorization responses and the `iss` of introspection responses follow the same rule. The issuer is whatever the discovery document of the entry point says.

Migration checklist for an existing app:

1. Pick one entry point per application: the custom domain, after it is verified.
2. Change the SDK or library configuration to the custom domain. Read `issuer` and `jwks_uri` from the discovery document. Do not hard-code them.
3. Update every API and service that validates tokens of this application to accept the new issuer. Deploy them before or together with the app. See `lumoauth-api-protection`.
4. Never mix entry points in one application. A code that was obtained on `auth.example.com` and redeemed on the `/orgs/acme-corp/` path yields a token whose `iss` the app rejects. That rejection is correct.
5. Tokens that were issued before the switch keep their old issuer until they expire. Plan the switch so that APIs accept both issuers for that period, or sign users in again.
6. Redirect URIs of the app do not change. They point to the app, not to LumoAuth.
7. Integrations that were configured with platform URLs (SAML metadata, social provider callback URLs, the SCIM base URL in an IdP) keep working on the platform address. Leave them unchanged unless the user asks for the custom domain there too, and test one integration before changing a production one.

The SDK configuration key for the base URL differs by SDK. Use the framework skill of the app to change it.

### Passkeys

A passkey is created for the domain it was made on. A passkey that was made on the custom domain signs in there. A passkey that was made on the platform address signs in on the platform address only. Tell the user that people who switch to the custom domain create a new passkey on it.

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| Verification fails | The TXT record is missing, has another token, or has not propagated | Compare the `dig` output with the **DNS setup** card |
| Verification passes once and the domain stays pending | The second check has not run | Choose **Verify now** again after about a minute |
| The browser shows a certificate error | DNS has not propagated or the CNAME does not point to the region host | Fix the CNAME, wait for propagation, verify again |
| Discovery returns the old URLs | A cache in the app or a proxy | Clear it. The discovery document changes at once. |
| Token validation fails after the switch | The app or an API still expects the old issuer | Set the issuer to the bare domain, or read it from discovery |
| `iss` mismatch in the OIDC library | The flow started on one entry point and is validated against the other | Use one entry point per application |
| A passkey does not work on the custom domain | It was created on the platform address | Create a new passkey on the custom domain |
| The domain cannot be added | The hostname has a scheme or a path, or is not allowed | Enter the bare hostname of a domain that the user controls |

Docs: https://docs.lumoauth.dev/user-guide/multi-tenancy/custom-domains
