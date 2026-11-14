# Email templates

LumoAuth sends transactional emails for sign-up, verification, password reset, invitations, one-time codes and security notices. Each can be replaced by a custom template.

Custom templates, including their variants, depend on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Where they are configured

Portal: **Settings → Login page & emails → Email templates**

```text
/orgs/{orgId}/portal/settings/email-templates
```

Each row shows the template, its subject, whether it is the built-in **Default** or customised, and when it was last updated. **Customise** opens the editor. The editor lists the placeholders under **Available placeholders**, has a **Preview** button and a **Revert to default** action.

Admin API, relative to `{base}/orgs/{orgId}/api/v1`:

| Method | Path | Permission | Scope |
|---|---|---|---|
| `GET` | `/admin/email-templates` | `settings.manage` and `users.delete` | `admin:settings:read` |
| `GET` | `/admin/email-templates/{type}` | `settings.manage` and `users.delete` | `admin:settings:read` |
| `GET` | `/admin/email-templates/{type}/variables` | `settings.manage` and `users.delete` | `admin:settings:read` |
| `PUT` | `/admin/email-templates/{type}` | `settings.manage` and `users.delete` | `admin:settings:write` |
| `DELETE` | `/admin/email-templates/{type}` | `settings.manage` and `users.delete` | `admin:settings:write` |
| `POST` | `/admin/email-templates/{type}/preview` | `settings.manage` and `users.delete` | `admin:settings:write` |

Writing or previewing a template is reserved for a full admin, because a template carries every user's reset, sign-in and invitation link. With an API key, the creator of the key must hold both permissions. Otherwise the API answers `403`.

There is no dedicated CLI command. Use `lumo api` with these paths.

## Template types and placeholders

Placeholders are flat `{{snake_case}}` names, not dotted paths. Each type accepts only its own set. Read the set from the API before writing a template:

```bash
lumo api GET /email-templates/magic_link/variables
```

| Type | Sent when | Placeholders |
|---|---|---|
| `email_verification` | An existing account must verify its address | `{{user_name}}`, `{{verify_url}}`, `{{tenant_name}}` |
| `signup_link` | Someone asks to sign up | `{{user_name}}` (holds the email address, because no account exists yet), `{{verify_url}}`, `{{tenant_name}}` |
| `password_reset` | A password reset is requested | `{{user_name}}`, `{{reset_url}}`, `{{expires_in}}`, `{{tenant_name}}` |
| `user_invitation` | An admin invites a user | `{{inviter_name}}`, `{{tenant_name}}`, `{{accept_url}}`, `{{expires_at}}`, `{{message}}` |
| `mfa_code` | A one-time code is sent by email | `{{user_name}}`, `{{code}}`, `{{tenant_name}}` |
| `magic_link` | A passwordless sign-in link is requested | `{{user_name}}`, `{{magic_url}}`, `{{expires_in}}`, `{{tenant_name}}` |
| `org_invitation` | A user is invited to a customer organization | `{{inviter_name}}`, `{{org_name}}`, `{{tenant_name}}`, `{{accept_url}}`, `{{expires_at}}`, `{{message}}` |
| `password_changed` | The password of an existing account changed | `{{user_name}}`, `{{changed_at}}`, `{{changed_by}}`, `{{reset_url}}`, `{{tenant_name}}` |
| `account_exists` | Someone signs up with an address that already has an account | `{{user_name}}`, `{{login_url}}`, `{{reset_url}}`, `{{tenant_name}}` |

Notes per type:

- `signup_link`: when it is not customised, a customised `email_verification` template is used instead. The person who asked for the link can be anyone, so tell the reader that the email can be ignored when they did not ask for it.
- `password_changed`: sent after every password change of an existing account, whatever the path. `{{changed_at}}` is in UTC. `{{changed_by}}` is a phrase such as "you, while signed in to your account" or "an administrator". `{{reset_url}}` is the forgot-password page.
- `account_exists`: this email is how the real owner learns of a sign-up attempt, because the sign-up page gives the same answer for every address.
- `{{message}}` in the invitation templates can be empty.

## Rules for the body

- `subject` and `body_html` are both required. The subject can be up to 255 characters.
- A link or code placeholder (`{{verify_url}}`, `{{reset_url}}`, `{{accept_url}}`, `{{magic_url}}`, `{{code}}`) can appear as text, or as the whole `href` of a link. A template that puts one of them inside another address is refused. That includes an address written as plain text, such as `https://example.com/{{code}}`.
- Script elements and inline event handlers are refused.
- The body is the user's to style: put the logo, colours and footer in the template. Use inline styles and table layout, as for any HTML email.
- Keep the required link or code in every template. A password reset email without `{{reset_url}}` is useless to its reader.

A refused body returns `422` with the reason after `body_html:`.

## Write, preview, revert

```bash
export LUMO_ORG=acme-corp

# Read the current template (default or custom)
lumo api GET /email-templates/email_verification

# Replace it
lumo api PUT /email-templates/email_verification --data '{
  "subject": "Confirm your email for {{tenant_name}}",
  "body_html": "<h1>Welcome to {{tenant_name}}</h1><p>Hi {{user_name}},</p><p>Please confirm your email address.</p><p><a href=\"{{verify_url}}\">Verify email</a></p><p>If you did not create this account, ignore this email.</p>"
}'

# Render with sample data. A subject and body_html in the request override the stored ones.
lumo api POST /email-templates/email_verification/preview --data '{}'

# Back to the built-in default
lumo api DELETE /email-templates/email_verification
```

The preview response contains `type`, `subject` and `html`.

With `curl`:

```bash
curl -sS -X PUT "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/email-templates/password_reset" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Reset your {{tenant_name}} password",
    "body_html": "<p>Hi {{user_name}},</p><p><a href=\"{{reset_url}}\">Choose a new password</a></p><p>This link expires in {{expires_in}}.</p>"
  }'
```

For a long template, keep the HTML in a file in the project and build the JSON body from it, so that the template is reviewed like code:

```bash
jq -n --arg subject "Reset your {{tenant_name}} password" --rawfile body emails/password_reset.html \
  '{subject: $subject, body_html: $body}' > /tmp/password_reset.json
lumo api PUT /email-templates/password_reset --data "$(cat /tmp/password_reset.json)"
```

Show the user the template and the command before running it. The change applies to the next email that is sent.

## Variants per language and per application

A custom template can have a separate version for one language, for one application, or for both. Two optional values select the version:

| Value | Meaning |
|---|---|
| `locale` | Language of the version as a BCP 47 tag, for example `fr` or `pt-BR`. Leave out for the version that is used in every language. |
| `client_id` | OAuth client ID of the application. Leave out for the version that is used by every application. |

Send them in the query string for `GET` and `DELETE`, and in the body or the query string for `PUT`. A language that LumoAuth does not offer, or a client ID from outside the organization, returns `422`.

```bash
lumo api PUT /email-templates/password_reset --data '{
  "locale": "fr",
  "subject": "Réinitialisez votre mot de passe {{tenant_name}}",
  "body_html": "<p>Bonjour {{user_name}},</p><p><a href=\"{{reset_url}}\">Choisir un nouveau mot de passe</a></p>"
}'

lumo api DELETE /email-templates/password_reset --query locale=fr
```

LumoAuth sends the most specific version that exists:

1. This application in this language
2. This application
3. This language
4. The default

An email is sent in the language that the person used on the sign-in pages, or in the organization's default language.

In the portal editor: choose a **Language** (or **Every language**) and an **Application** (or **Every application**), click **Edit this version**, edit, then **Save template**.

## Default emails and branding

Without a custom template, the default emails use the look of the sign-in pages. When the custom login page is on, they show the organization's logo and use its button colour. The footer follows the "Secured by LumoAuth" badge setting: "Sent by LumoAuth on behalf of *organization*." or "Sent by *organization*."

The wording that an organization sets for the sign-in pages (`texts` in the branding settings) does not change emails. To change an email, edit its template.

## Delivery

By default LumoAuth sends mail through the platform mailer from a LumoAuth address. To send from the organization's own domain, the user configures an email provider at `/orgs/{orgId}/portal/integrations/email` (section **SMS & email delivery** of **Integrations**). That page sets the provider, the **From address** and **From name**, and has a **Send test email** button. Use `lumoauth-integrations` for it.

## Problems

| Symptom | Cause | Fix |
|---|---|---|
| `403` on `PUT` or `DELETE` | The caller lacks `settings.manage` or `users.delete` | Use a full admin, or an API key that a full admin created |
| `404` with `valid_types` | Unknown template type | Use one of the nine types |
| `422 subject is required` / `body_html is required` | A field is missing or empty | Send both |
| `422 body_html: ...` | A script, an event handler, or a link or code placeholder inside another address | Use the placeholder as the whole `href` or as text |
| `422` on `locale` or `client_id` | A language that is not offered, or a client of another organization | Use a supported language tag and a client ID of this organization |
| A placeholder shows up as literal text in the email | The placeholder is not in the set of this type, or is misspelled | Read `/variables` for the type |
| The email still looks like the default | A more specific version exists for the application or language, or the template was saved for another variant | List the versions on the **Email templates** page |
| Emails do not arrive | Delivery, not the template | Check the email provider and its test send (`lumoauth-integrations`) |

Docs: https://docs.lumoauth.dev/user-guide/integrations/email-templates
