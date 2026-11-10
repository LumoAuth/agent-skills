# Login page settings

Reference for the organization's login page settings, per-application branding, custom CSS and the custom HTML layout.

## Contents

- [Which pages the settings cover](#which-pages-the-settings-cover)
- [Setting keys](#setting-keys)
- [Portal sections](#portal-sections)
- [Per-application branding](#per-application-branding)
- [Custom CSS](#custom-css)
- [Custom HTML layout](#custom-html-layout)
- [Drafts, preview and versions](#drafts-preview-and-versions)
- [AI theme](#ai-theme)
- ["Secured by LumoAuth" badge](#secured-by-lumoauth-badge)

## Which pages the settings cover

Every application signs people in on the organization's login page, `/orgs/{orgId}/login`. The settings apply to the whole sign-in journey: sign-in, password reset, email verification and two-step verification. Three switches decide about other pages:

| Key | Portal switch | Pages |
|---|---|---|
| `apply_to_registration` | **Apply branding to the registration page** | Sign-up |
| `apply_to_consent` | **Apply branding to the OAuth consent page** | Consent page and the device flow pages |
| `apply_to_account` | **Apply branding to the account pages and the customer portal** | Account pages and the B2B customer portal. They show logo, button colour and favicon only. Custom CSS and layouts are never used there. |

All three are on by default. Error pages and the short "Signing you in" page keep the LumoAuth look.

Three things apply even while `enabled` is `false`: `self_registration_enabled`, the legal links and sign-up consents, and the languages and wording.

## Setting keys

Read and write through `GET`, `PUT`, `PATCH {base}/orgs/{orgId}/api/v1/admin/settings/branding`, or `lumo settings get branding` / `lumo settings update branding`.

General and layout:

| Key | Values | Portal label |
|---|---|---|
| `enabled` | boolean | **Enable custom login page** |
| `theme` | `auto`, `light`, `dark` | **Theme preference**. `light` or `dark` fixes the theme and removes the theme toggle. |
| `layout` | `centered`, `split-left`, `split-right` | **Page layout** |
| `input_style` | `rounded`, `square`, `pill` | **Style variants** |
| `button_style` | `filled`, `outline`, `pill` | **Style variants** |
| `form_card_style` | `card`, `flat`, `glass` | **Style variants** |
| `social_position` | `below` (default), `above` | Position of the social buttons relative to the email form |
| `social_order` | List or comma-separated string of provider names, first one first | Order of the social buttons |

Brand and content:

| Key | Values | Portal label |
|---|---|---|
| `logo_url`, `favicon_url` | `https://` or `http://` URL | **Logo URL**, **Favicon URL**. PNG or SVG with a transparent background works best for the logo. |
| `primary_color` | Colour, for example `#0f766e` | **Button color**. Used for the sign-in button, links and focus rings. The label colour is chosen automatically for contrast. |
| `button_text` | Plain text, 60 characters at most | **Button text** |
| `welcome_title` | Plain text, 120 characters at most | **Welcome title** |
| `welcome_subtitle` | Text with bold, italics and links | **Welcome subtitle** |
| `show_tenant_name` | boolean | **Show organization name** |
| `show_tenant_in_subtitle` | boolean | **Show org name in subtitle** |
| `split_panel_title`, `split_panel_subtitle`, `split_panel_image_url` | Text, text, URL | Panel of the split layouts |

Background:

| Key | Values |
|---|---|
| `background_type` | `solid`, `gradient`, `image`, `pattern` |
| `background_color` | Colour |
| `background_gradient` | A `linear-gradient()`, `radial-gradient()` or `conic-gradient()` value |
| `background_image_url` | URL |
| `background_overlay_opacity` | Number. Darkens an image so that text stays readable. |
| `show_background_pattern` | boolean |
| `background_pattern_style` | `hexagonal`, `diamond`, `crosshatch`, `isometric`, `concentric` |

Legal and footer:

| Key | Values | Notes |
|---|---|---|
| `terms_url`, `privacy_url` | URL | Shown on the sign-in pages and in the agreement line of sign-up and invitation forms |
| `footer_text` | Text with bold, italics and links | **Custom footer text** |
| `require_terms_acceptance` | boolean | Adds a required checkbox to sign-up and invitation forms. Needs `terms_url` or `privacy_url`. |
| `marketing_opt_in` | boolean | Adds an optional marketing checkbox |
| `marketing_opt_in_label` | Plain text, 200 characters at most | Text of that checkbox |
| `show_powered_by` | boolean | The "Secured by LumoAuth" badge |

Languages:

| Key | Values |
|---|---|
| `locales` | List of `en`, `es`, `fr`, `de`, `pt_BR`, `it`, `nl`, `ja`, `ar` (`pt-BR` is accepted too) |
| `default_locale` | One of the codes. Default `en`. |
| `show_language_switcher` | boolean. The menu appears only when more than one language is offered. |
| `texts` | Object per language, keyed by LumoAuth's English text: `{"fr": {"Sign in": "Se connecter"}}`. Plain text. A key that is not one of LumoAuth's texts is not stored. `{{ ... }}` placeholders are removed from the values. Keep placeholders such as `%name%` where the original has them. |

The page language is the first of these that the organization offers: the choice in the language menu, `ui_locales` from the application, the language that the person used before, the browser language, the default language. Arabic pages are shown right to left.

Advanced:

| Key | Values |
|---|---|
| `custom_css` | Stylesheet text. See [Custom CSS](#custom-css). |
| `custom_html` | Layout markup. See [Custom HTML layout](#custom-html-layout). |
| `custom_html_pages` | Pages that use the layout: any of `login`, `register`, `password`, `mfa`, `verify`, `consent`, `other`. Default `["login"]`. |

Sign-in policy keys in the same object: `self_registration_enabled`, `magic_link_enabled`, `magic_link_only`, `magic_link_expiry`, `email_first_mode`. They need the `settings.manage` permission and belong to `lumoauth-login-methods`.

Behaviour of a write: only known keys are stored; every value is validated and validated again when a page is rendered; `primary_color`, `background_color` and `background_gradient` are `null` until set, and the pages then use the default colours.

## Portal sections

`/orgs/{orgId}/portal/settings/login-page` is one form with the sections **Preview & publish**, **General**, **Layout**, **Background**, **Branding & content**, **Style variants**, **Legal & footer**, **Languages & text**, **Other pages** and **Advanced**. A **Live preview** beside the form sketches the structured settings. **Open login page** at the top opens the real page.

## Per-application branding

Portal: `/orgs/{orgId}/portal/applications/oidc/{clientId}` → **Branding** tab.

- **Login page** section: turn on **Enable custom login page**, set the values, open **More settings (empty = same as the organization)** for the rest, then **Save login page**.
- **Consent page** section: turn on **Enable custom consent page**, set **Page title**, **Description**, **Logo URL**, colours and **Custom CSS**, then **Save consent page**.

A SAML application has the same login branding on its **Branding** tab (**Use this application's own login branding**).

API: `GET`, `PUT`, `PATCH {base}/orgs/{orgId}/api/v1/admin/clients/{clientId}/branding` (scope `admin:clients:read` / `admin:clients:write`, permission `branding.view` / `branding.edit`). `{clientId}` is the OAuth client ID.

```json
{
  "login": {"enabled": true, "primary_color": "#0f62fe", "welcome_title": "Welcome to Acme Shop", "layout": "split-right"},
  "consent": {"enabled": true, "title": "Allow Acme Shop"}
}
```

- `login` takes the organization's branding keys. An empty or `null` value means "same as the organization". `"self_registration_enabled": false` hides the sign-up link for this application. It never opens sign-up that the organization has closed.
- `consent` takes `enabled`, `logo_url`, `primary_color`, `title`, `description`, `custom_css`.
- `PUT` replaces each part that is sent. `PATCH` changes only the keys that are sent.
- The response returns both parts in `data` and lists refused keys in `rejected`.

An application cannot add or remove a sign-in method. The custom layout of an application is used on the pages that the organization selected in `custom_html_pages`.

The consent page also shows links to the application's privacy policy and terms of service. Those are the application's own `policy_uri` and `tos_uri` (**Configuration → Application metadata**).

## Custom CSS

Add the stylesheet in **Advanced → Custom CSS**, or send `custom_css`. It is loaded after the other settings, on the organization's sign-in pages only. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

Stable selectors:

| Selector | Element |
|---|---|
| `.lumo-auth` | The page. Carries `data-auth-layout`, `data-auth-input`, `data-auth-button` and `data-auth-card` with the chosen variants. |
| `.lumo-auth-header`, `.lumo-auth-main`, `.lumo-auth-footer` | Top bar, the area around the form, the footer |
| `.lumo-auth-panel`, `.lumo-auth-panel-title`, `.lumo-auth-panel-subtitle` | The side panel of the split layouts |
| `.lumo-auth-logo`, `.lumo-auth-title`, `.lumo-auth-subtitle`, `.lumo-auth-signup` | Logo, heading, the line under it, the "Create one" line |
| `.lumo-card` | The form card |
| `.lumo-input` | Text fields |
| `.lumo-button`, `.lumo-button-primary`, `.lumo-button-secondary` | Buttons |

Use only these. Other class names on the page can change between releases.

```css
.lumo-card {
  border-radius: 20px;
  border: 2px solid #16a34a;
}

.lumo-auth-title { font-size: 2rem; }
.lumo-button-primary { letter-spacing: 0.02em; }

@media (max-width: 480px) {
  .lumo-auth-footer { font-size: 11px; }
}
```

The stylesheet is parsed and rebuilt from the parts that the filter recognises. Everything else is dropped.

| Kept | Details |
|---|---|
| Style rules | Class, element and attribute selectors, combinators, common pseudo-classes and pseudo-elements, nesting |
| `@media`, `@supports`, `@container`, `@layer`, `@keyframes` | With their nested rules. An `@layer` named `theme`, `base`, `components`, `utilities` or `properties`, or starting with `lumo`, is dropped. |
| Declarations | Standard and custom (`--name`) properties; colour, gradient, transform, filter, shape, timing and math functions; `var()`, `calc()`, `attr()`, `env()` |

| Dropped | Consequence |
|---|---|
| `@import`, `@font-face`, `@namespace` and every other at-rule | Web fonts cannot be loaded from custom CSS |
| Every `url()`, also `image-set()`, `image()`, `src()`, `cross-fade()`, `element()` | No images from CSS. Use the logo and background image fields. |
| `expression()`, `behavior`, `-moz-binding`, `javascript:` | |
| Functions that are not on the allow-list, and backslash escapes outside quoted strings | |
| HTML such as `</style>` or `<script>` | |

A declaration with a dropped part is removed as a whole. The rest of the rule stays. The stylesheet can be up to 64 KB.

Some elements stay visible whatever the stylesheet says: the cookie banner, the footer with its legal links, and the "Secured by LumoAuth" badge while it is shown. Their colours, borders and spacing can still be styled.

## Custom HTML layout

**Advanced → Custom layout (HTML)**, or `custom_html`. The layout is the markup around the page's form. LumoAuth always renders the forms itself, so a layout cannot change how credentials are collected. It needs the same plan as custom CSS.

```html
<section class="acme-login">
  <header class="acme-top">
    {{ logo }}
    {{ title }}
  </header>
  <p class="acme-tagline">Everything your team needs, behind one sign-in.</p>
  {{ widget }}
  {{ signup_link }}
  <footer class="acme-bottom">
    {{ legal_links }}
    {{ language_switcher }}
  </footer>
</section>
```

Style it from the custom CSS with the layout's own class names.

| Placeholder | What is put there |
|---|---|
| `{{ widget }}` | The page's own form. Required, exactly once. |
| `{{ logo }}` | The logo |
| `{{ org_name }}` | The organization's name |
| `{{ app_name }}`, `{{ app_logo }}` | Name and logo of the application, when there is one |
| `{{ legal_links }}` | Links to terms of service and privacy policy |
| `{{ footer_text }}` | The custom footer text |
| `{{ language_switcher }}` | The language menu, when more than one language is offered |
| `{{ title }}`, `{{ subtitle }}` | Login page only: the welcome title and subtitle |
| `{{ signup_link }}` | Login page only: the "Create one" line, when self registration is on |
| `{{ social }}` | Login page only: the social buttons outside the form. They are then no longer part of `{{ widget }}`. |

A layout without `{{ widget }}` is saved but not used. Each placeholder is used once and only between tags. A placeholder inside an attribute is removed.

| Kept | Details |
|---|---|
| Elements | `div`, `span`, `p`, `h1` to `h6`, `a`, `img`, `br`, `hr`, `ul`, `ol`, `li`, `section`, `article`, `header`, `footer`, `nav`, `main`, `aside`, `blockquote`, `figure`, `figcaption`, `strong`, `b`, `em`, `i`, `u`, `small` |
| Attributes | `class`, `role`, `aria-label`, `aria-hidden`, `lang`, `dir`; on `a`: `href`, `target`, `title`; on `img`: `src`, `alt`, `width`, `height` |
| Link schemes | `https`, `http` (rewritten to `https`), `mailto` |
| Image sources | `https` |

Everything else is dropped: `script`, `style`, `iframe`, `form`, `input`, `button`, `link`, `meta`, `svg`, comments, inline `style` attributes, event handlers, and the `id`, `name` and `data-*` attributes. The layout can be up to 20 KB.

The sign-in pages never run JavaScript that an organization supplies. When the user needs behaviour that the hosted page does not offer, the app must render its own sign-in UI.

## Drafts, preview and versions

Portal only.

- **Save draft** keeps changes off the live pages. **Discard draft** removes the draft.
- **Publish** makes the changes live.
- The preview in **Preview & publish** shows the real pages. Choose **Page** (Login, Sign-up, Forgot password, Consent), **Version** (draft or published), **Language** and an optional **Application client ID**.
- **Published versions** keeps earlier versions. **Restore to draft** copies one into the draft.
- **Export published settings**, **Export draft** and **Import into draft** move the settings as a JSON file. An export holds branding, texts and languages, never the sign-in methods.

The Admin API and `lumo settings update branding` change the published settings directly and do not touch a draft.

Audit events: `branding.login_page_updated`, `branding.login_page_restored_to_draft`, `branding.login_page_imported_to_draft`.

## AI theme

Portal only: on the login page settings, **Generate theme with AI** (shown when the feature is available), enter the public website URL, **Generate**, then preview and apply or adjust. The feature reads the site's public home page. Availability depends on the organization's plan.

## "Secured by LumoAuth" badge

`show_powered_by` (**Show "Secured by LumoAuth" badge** under **Legal & footer**). Whether it can be turned off depends on the organization's plan. The same setting controls the footer of default emails ("Sent by LumoAuth on behalf of ..." or "Sent by ..."), the LumoAuth mark on account pages and the customer portal, and how the push step names the app.

Docs: https://docs.lumoauth.dev/user-guide/multi-tenancy/branding and https://docs.lumoauth.dev/api-reference/organization
