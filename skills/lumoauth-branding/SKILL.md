---
name: lumoauth-branding
description: >-
  Customizes what users of a LumoAuth organization see: the hosted login page
  (logo, colours, background, layout, welcome text, legal links, custom CSS
  with the `.lumo-*` selectors, custom HTML layout), branding per application,
  AI-generated themes, drafts and publish, languages and wording of the
  sign-in pages (`ui_locales`), custom domains (DNS TXT and CNAME records,
  verification, the new issuer URL), and email templates (verification,
  password reset, magic link, invitation, MFA code) with `{{placeholders}}`.
  Covers the portal pages, the Admin API (`/admin/settings/branding`,
  `/admin/clients/{clientId}/branding`, `/admin/email-templates`) and `lumo
  settings update branding`. Use when the user asks to brand or white-label
  the login page, change logo or colours, add custom CSS, translate the
  sign-in pages, serve login from auth.example.com, fix an issuer mismatch
  after adding a custom domain, or edit an email template. Not for choosing
  sign-in methods or for email and SMS delivery providers.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth branding, custom domains and email templates

Make the hosted sign-in pages, the domain they are served from and the emails look like the user's product. LumoAuth renders the pages. The app keeps redirecting to the authorization endpoint and needs no UI code. Only a custom domain changes app configuration: the issuer URL.

## When to use

- Change logo, colours, layout, texts or legal links of the login page, for the organization or for one application.
- Add custom CSS or a custom HTML layout.
- Offer the sign-in pages in more languages, or reword a text.
- Serve the pages from the user's own domain, for example `auth.example.com`.
- Edit the emails that LumoAuth sends.

Do not use this skill for:

- Turning sign-in methods on or off (password, magic link, social): use `lumoauth-login-methods`.
- Email and SMS delivery providers and the From address: use `lumoauth-integrations`.
- A sign-in form that the app renders itself: use `lumoauth-login-methods` (custom login UI) and the framework skill.
- The organization's B2B customer portal and customer organizations: use `lumoauth-b2b-saas`.

## Before you start

Ask the user for any value that is missing. Do not guess.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`acme-corp` in the examples) | The portal URL: `/orgs/{orgId}/portal` |
| Brand assets | From the user: logo URL (`https://`, PNG or SVG), favicon URL, brand colour as hex, terms and privacy URLs |
| Admin access | A portal admin session, `lumo login --org acme-corp`, or an API key (`lmk_...`) from `/orgs/{orgId}/portal/settings/api-keys` |
| For a custom domain: the hostname and access to its DNS zone | The user |

Images are referenced by URL. There is no upload. The user hosts the logo and enters its `https://` address.

Where each feature is configured:

| Feature | Portal page | Admin API | CLI |
|---|---|---|---|
| Organization login page | **Settings → Login page & emails → Login page**, `/orgs/{orgId}/portal/settings/login-page` | `GET`, `PUT`, `PATCH /admin/settings/branding` | `lumo settings get branding`, `lumo settings update branding` |
| Drafts, preview, published versions, export and import | Same page, section **Preview & publish** | Portal only. The API writes the published settings directly. | None |
| Branding of one application (login and consent page) | Application → **Branding** tab, `/orgs/{orgId}/portal/applications/oidc/{clientId}` | `GET`, `PUT`, `PATCH /admin/clients/{clientId}/branding` | `lumo api` |
| AI theme | **Generate theme with AI** on the login page settings | Portal only | None |
| Languages and wording | Same page, section **Languages & text** | Keys `locales`, `default_locale`, `show_language_switcher`, `texts` of `/admin/settings/branding` | `lumo settings update branding` |
| Custom domains | **Settings → Custom domains**, `/orgs/{orgId}/portal/custom-domains` | Portal only | None |
| Email templates | **Settings → Login page & emails → Email templates**, `/orgs/{orgId}/portal/settings/email-templates` | `/admin/email-templates` | `lumo api` |

Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`.

| Task | Scope | Permission of the caller (or of the creator of the key) |
|---|---|---|
| Read organization branding | `admin:settings:read` | `branding.view` |
| Change organization branding | `admin:settings:write` | `branding.edit` |
| Read or change one application's branding | `admin:clients:read` / `admin:clients:write` | `branding.view` / `branding.edit` |
| Read email templates | `admin:settings:read` | `settings.view` |
| Change email templates | `admin:settings:write` | `settings.manage` and `users.delete` (a full admin) |

Custom CSS, the custom HTML layout, AI themes, removing the "Secured by LumoAuth" badge, custom email templates and custom domains: availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

Keep the API key in an environment variable. Show the user every command that changes the published login page, a template or a domain before running it. The API and the CLI change the live pages at once.

## Steps: brand the organization's login page

### 1. Read the current settings

```bash
export LUMO_ORG=acme-corp
lumo settings get branding -o json
```

For the EU region, also set `LUMO_BASE_URL=https://eu.app.lumoauth.dev`.

### 2. Apply the basic branding

`enabled` turns the custom login page on. While it is `false`, the visual settings are not applied to any page.

```bash
lumo settings update branding --data '{
  "enabled": true,
  "logo_url": "https://www.example.com/assets/logo.svg",
  "favicon_url": "https://www.example.com/favicon.png",
  "primary_color": "#0f766e",
  "welcome_title": "Welcome to Acme",
  "welcome_subtitle": "Sign in to continue",
  "layout": "centered",
  "theme": "auto",
  "terms_url": "https://www.example.com/terms",
  "privacy_url": "https://www.example.com/privacy"
}'
```

The same with `curl`:

```bash
curl -sS -X PATCH "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/settings/branding" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "primary_color": "#0f766e", "welcome_title": "Welcome to Acme"}'
```

Rules of the write:

- Only the keys that are sent change. Unknown keys are not stored.
- Every value is validated. Image and link fields accept `https://` and `http://` addresses only; a `data:` image is refused.
- The write goes to the published settings. It does not read or change a draft that someone keeps in the portal.
- `self_registration_enabled`, `magic_link_enabled`, `magic_link_only`, `magic_link_expiry` and `email_first_mode` are sign-in policy. Changing one needs `settings.manage` as well. Leave them out of branding changes.

For a careful rollout, tell the user to work in the portal instead: **Save draft**, check the real pages in **Preview & publish**, then **Publish**. Earlier published versions can be restored there.

Read [references/login-page-settings.md](references/login-page-settings.md) for every key and its allowed values, custom CSS, the custom HTML layout and the consent page.

### 3. Languages

The sign-in pages can be shown in English, Spanish, French, German, Portuguese (Brazil), Italian, Dutch, Japanese and Arabic. An organization offers English only until more are selected.

```bash
lumo settings update branding --data '{
  "locales": ["en", "fr", "de"],
  "default_locale": "en",
  "show_language_switcher": true
}'
```

Codes: `en`, `es`, `fr`, `de`, `pt_BR`, `it`, `nl`, `ja`, `ar`. An app can ask for a language on the authorization request with the standard `ui_locales` parameter, for example `ui_locales=fr`. To reword a text, send `texts`, keyed by language and by LumoAuth's English text: `{"texts": {"fr": {"Sign in": "Se connecter"}}}`. Languages and wording apply even when `enabled` is `false`. Emails follow the same language.

### 4. Brand one application

Use this when one organization serves several products.

```bash
lumo api PATCH /clients/CLIENT_ID/branding --data '{
  "login": {"enabled": true, "primary_color": "#0f62fe", "welcome_title": "Welcome to Acme Shop", "layout": "split-right"},
  "consent": {"enabled": true, "title": "Allow Acme Shop"}
}'
```

`CLIENT_ID` is the application's OAuth client ID. `login` takes the same keys as the organization's branding. An empty or `null` value means "same as the organization". `consent` takes `enabled`, `logo_url`, `primary_color`, `title`, `description` and `custom_css`. `PATCH` changes only the keys that are sent; `PUT` replaces each part that is sent. The response lists refused keys in `rejected`.

The application's branding is used on the login page and on the pages that follow in the same sign-in. The sign-in methods always come from the organization. An application can only hide the sign-up link (`"self_registration_enabled": false` in `login`).

### 5. App code

None for branding. Three standard parameters on the authorization request change what the hosted page shows:

| Parameter | Effect |
|---|---|
| `login_hint=<email>` | Pre-fills the email field |
| `prompt=create` | Opens the sign-up page |
| `ui_locales=<code>` | Asks for a page language |

## Custom domain

A custom domain serves the organization's pages and endpoints from the user's own hostname. It is set up in the portal only.

1. The user opens `/orgs/{orgId}/portal/custom-domains`, clicks **Add domain**, enters the hostname (for example `auth.example.com`, without `https://`) and picks **TXT record (recommended)**.
2. **DNS setup** on the domain's card shows the records. The user adds them at the DNS provider:
   - the TXT record `_lumoauth-verify.auth.example.com` with the value `lumoauth-verify=<token>` that the card shows,
   - a CNAME record from `auth.example.com` to the LumoAuth host of the region, for example `app.lumoauth.dev`.
3. The user chooses **Verify now** in the domain's actions menu. Verification needs two successful checks a short time apart. When the first one leaves the domain pending without an error, wait about a minute and choose **Verify now** again.
4. LumoAuth provisions the TLS certificate.

After activation, change the app configuration. The `/orgs/{orgId}` prefix disappears and the issuer becomes the bare domain:

| | Platform address | Custom domain |
|---|---|---|
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` | `https://auth.example.com` |
| Discovery | `https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/openid-configuration` | `https://auth.example.com/.well-known/openid-configuration` |
| Authorization endpoint | `.../orgs/acme-corp/api/v1/oauth/authorize` | `https://auth.example.com/api/v1/oauth/authorize` |

A token carries the issuer of the entry point that minted it. Use one entry point per application, read the issuer and the JWKS URL from its discovery document, and update every API that validates tokens at the same time. Passkeys are bound to the domain, so users create a new passkey on the custom domain. Read [references/custom-domains.md](references/custom-domains.md) before changing a production app.

## Email templates

There are nine template types: `email_verification`, `signup_link`, `password_reset`, `user_invitation`, `mfa_code`, `magic_link`, `org_invitation`, `password_changed`, `account_exists`.

```bash
# The placeholders that one template accepts
lumo api GET /email-templates/password_reset/variables

# Replace the template (subject and body_html are both required)
lumo api PUT /email-templates/password_reset --data '{
  "subject": "Reset your {{tenant_name}} password",
  "body_html": "<p>Hi {{user_name}},</p><p><a href=\"{{reset_url}}\">Choose a new password</a></p><p>This link expires in {{expires_in}}.</p>"
}'

# Back to the built-in default
lumo api DELETE /email-templates/password_reset
```

Placeholders are flat `{{snake_case}}` names. A link or code placeholder (`{{verify_url}}`, `{{reset_url}}`, `{{accept_url}}`, `{{magic_url}}`, `{{code}}`) may appear as text or as the whole `href` of a link, never inside another address. Scripts and inline event handlers are refused. A template can have a version for one language (`locale`) and for one application (`client_id`). Read [references/email-templates.md](references/email-templates.md) for the variables of each type, the variants and the preview call.

Without custom templates, the default emails already use the logo and button colour of the custom login page. Delivery (provider, From address) is configured at `/orgs/{orgId}/portal/integrations/email`; use `lumoauth-integrations`.

## Verify

1. `lumo settings get branding -o json` shows the new values. A value that failed validation is missing or unchanged.
2. Open `{base}/orgs/{orgId}/login` in a private browser window, in light and dark mode and at phone width. For one application, start a sign-in from that application.
3. In the portal, **Preview & publish** shows the real pages (login, sign-up, forgot password, consent) per language and per application client ID.
4. Custom domain: `curl -sS https://auth.example.com/.well-known/openid-configuration` returns `"issuer": "https://auth.example.com"`. Then run a full sign-in and check that the app accepts the token.
5. Email template: in the portal editor use **Preview**, or `POST /admin/email-templates/{type}/preview`. Then trigger the real email for a test user and check links and layout in a mail client.
6. **Security → Audit logs** records a publish from the portal as `branding.login_page_updated`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Colours and logo do not show | `enabled` is `false` | Send `"enabled": true` |
| A logo value is not saved | A `data:` image or a non-http address | Host the file and enter its `https://` URL |
| Part of the custom CSS disappears | The filter drops `@import`, `@font-face`, every `url()` and unknown functions | Use the logo and background image fields for images. Web fonts cannot be loaded. |
| The custom layout is saved but not used | It has no `{{ widget }}` placeholder | Add `{{ widget }}` exactly once |
| `403` with `rejected_keys` on `/settings/branding` | A sign-in policy key was changed without `settings.manage` | Remove those keys from the request |
| `403` on `custom_css` or `custom_html`, or the stylesheet has no effect | The plan does not include custom CSS and layouts | See the pricing matrix |
| A portal draft does not include an API change | The API writes the published settings, not the draft | Decide on one way of working: portal drafts or API |
| `iss` mismatch after adding a custom domain | The app started on one entry point and validates against the other | Use the custom domain everywhere in that app and read the issuer from discovery |
| Domain verification stays pending | The TXT record has not propagated, or only one of the two checks has passed | Check the record with `dig TXT _lumoauth-verify.auth.example.com`, then **Verify now** again |
| Passkeys stop working on the custom domain | A passkey is bound to the domain where it was created | Users create a new passkey on the custom domain |
| `422` on a template | A link or code placeholder inside another address, a script, or a missing `subject` or `body_html` | Use the placeholder as the whole `href` or as text |
| `403` when saving a template | The caller is not a full admin | Use a caller with `settings.manage` and `users.delete` |
| A reworded text does not change an email | `texts` applies to pages and the SMS code text, not to emails | Edit the email template |

## Related skills

- `lumoauth-login-methods`: which sign-in methods the page offers.
- `lumoauth-integrations`: email and SMS delivery providers.
- `lumoauth-oauth-oidc`: discovery, issuer and the authorization request parameters.
- `lumoauth-api-protection`: issuer and JWKS in token validation after a domain change.
- `lumoauth-mfa-passkeys`: passkeys and domains.
- `lumoauth-b2b-saas`: branding for customer organizations.
- `lumoauth-admin-api`: API keys and scopes.

## References

- [references/login-page-settings.md](references/login-page-settings.md): open for every branding key, custom CSS, custom HTML and the consent page.
- [references/custom-domains.md](references/custom-domains.md): open before adding a custom domain or changing an issuer.
- [references/email-templates.md](references/email-templates.md): open when editing an email template.
- https://docs.lumoauth.dev/user-guide/multi-tenancy/branding
- https://docs.lumoauth.dev/user-guide/multi-tenancy/custom-domains
- https://docs.lumoauth.dev/user-guide/integrations/email-templates
- https://docs.lumoauth.dev/api-reference/organization
- https://docs.lumoauth.dev/oauth/clients
- https://docs.lumoauth.dev/integrations/sms-and-email
