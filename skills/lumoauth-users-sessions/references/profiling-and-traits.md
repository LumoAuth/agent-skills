# Progressive profiling, sign-up fields and user traits

Three tools collect and store profile data beyond the standard fields:

- **User traits**: custom key-value attributes on a user.
- **Progressive profiling**: asks for one or two fields during sign-in, over several sessions. Answers are saved as traits.
- **Sign-up fields**: extra questions on the forms that create an account. Answers are saved as traits.

Availability of progressive profiling and sign-up fields depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## User traits

Trait types: string, number, boolean, JSON.

### Portal

1. Open `/orgs/{orgId}/portal/users`, open the **⋯** menu of a user and choose **Customer 360 view** (or go to `/orgs/{orgId}/portal/users/{userId}/360`).
2. In the **User traits** card click **Add trait**.
3. Enter the **Key**, choose the **Type**, enter the **Value** and click **Save trait**.

Existing traits are not edited in place, and a key that exists is refused. To change a value in the portal, delete the trait and add it again.

### API

```bash
# Set a trait
curl -s -X PUT "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/users/$USER_ID/attributes/plan_tier" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "gold"}'

# Read the attributes of the token's own user
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/abac/my-attributes" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

- Both endpoints take a user access token. An API key (`lmk_`) is not accepted on them.
- `PUT .../abac/users/{userId}/attributes/{attributeSlug}` needs the `abac:write` scope on the token, and the token's user must hold the `abac.manage` permission. `{userId}` is the user's UUID. The body is `{"value": <any JSON value>}`.
- `GET .../abac/my-attributes` needs the `abac:read` scope. It returns `{ "user_id": "...", "attributes": { ... } }` with the built-in identity attributes (`email`, `roles`, `groups`, `permissions`, `emailVerified`, `mfaEnabled` and others) plus the user's traits and the organization's custom attributes.
- These endpoints are part of the ABAC feature. Availability depends on the organization's plan.

Traits can be used in ABAC policies. Policy syntax belongs to `lumoauth-abac`.

## Progressive profiling

### Enable it

1. Open `/orgs/{orgId}/portal/settings/authentication` and select the **Progressive profiling** section.
2. Turn the **Enabled** switch on.
3. Click **Create rule**.
4. Choose the **Rule trigger**: **Continuous enrollment (every qualifying login)** or **Milestone based (after X login sessions)**.
5. Under **Attributes to capture**, add one row per field: **Display label**, **Internal key (ID)**, **Data type** (Short text, Long text, Number, Switch, Phone number, Date or Web address) and **Required**.
6. Click **Save rule**, then **Save changes** at the bottom of the page.

This is configured in the portal. There is no CLI command for it.

### Rules as JSON

The **JSON view** tab shows the same rules. Use it for a `select` field with `options`.

```json
[
  {
    "id": "rule_1",
    "trigger": "login_count >= 3",
    "fields": [
      { "key": "job_title", "label": "Job title", "type": "text", "required": true },
      { "key": "phone", "label": "Phone number", "type": "tel", "required": false }
    ]
  }
]
```

| Field | Description |
|---|---|
| `id` | Identifier of the rule (the rule editor generates it) |
| `trigger` | `always`, or a login-count condition such as `login_count >= 3` |
| `fields[].key` | The trait that the answer is saved as |
| `fields[].label` | The question shown to the user |
| `fields[].type` | `text`, `textarea`, `select` (with `options`), `checkbox`, `tel`, `date`, `url` or `number` |
| `fields[].required` | `true` when the user must answer |
| `fields[].help`, `fields[].placeholder` | Optional help line and placeholder |

### Behaviour

- After sign-in, LumoAuth checks the rules. When a rule matches, the user is sent to `/account/complete-profile/`, which shows only the fields of that rule and uses the branding of the sign-in pages.
- After the last question the user continues to the app that started the sign-in. The app needs no code for this.
- A rule is complete for a user when the user has answered each of its fields. An optional field that the user leaves empty counts as answered. A complete rule is not shown again.
- Use several rules to spread questions out: one rule with trigger `always` for a required field, another with `login_count >= 3` for a later question.

## Sign-up fields

1. Open `/orgs/{orgId}/portal/settings/authentication` and select the **Sign-up fields** section.
2. Enter the fields as JSON in **Fields (JSON)**.
3. Click **Save changes**.

```json
[
  { "key": "company", "label": "Company", "type": "text", "required": true },
  { "key": "role", "label": "Your role", "type": "select", "options": ["Engineering", "Sales", "Other"] }
]
```

| Property | Description |
|---|---|
| `key` | Trait name: lower case letters, digits and `_`. Names that the form already uses (`email`, `password`, `name` and similar) are ignored. |
| `label` | The question |
| `type` | `text`, `textarea`, `select`, `checkbox`, `tel`, `date`, `url` or `number` |
| `options` | Choices for `select` |
| `required`, `help`, `placeholder` | Optional |

The fields appear on the sign-up form and on the form that an invited user completes. A maximum of 20 fields can be defined.

## Verify

- Sign in as a test user that matches a rule. The profile step appears after the sign-in and before the redirect to the app.
- Open the user's **Customer 360 view**. The answers are listed in the **User traits** card.
- Sign in again. A completed rule does not appear a second time.

## Reference

- https://docs.lumoauth.dev/user-guide/user-management/progressive-profiling
