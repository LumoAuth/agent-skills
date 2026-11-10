# MFA API

Open this file when the app builds its own enrollment or challenge screens, needs step-up inside an API call, or manages users' factors from a backend. The hosted pages (`/account/security`, the MFA challenge page, the step-up page) already do all of this. Prefer them unless the user asks for custom UI.

All paths are relative to `{base}/orgs/{orgId}/api/v1`.

## Contents

- [Credentials and scopes](#credentials-and-scopes)
- [Self-service endpoints](#self-service-endpoints)
- [Challenges](#challenges)
- [Step-up for API callers](#step-up-for-api-callers)
- [Admin endpoints](#admin-endpoints)
- [Errors](#errors)

## Credentials and scopes

| Endpoints | Credential |
|---|---|
| `/me/*` and `/mfa/challenges*` | The user's OAuth access token (`Authorization: Bearer ...`) with a scope from the next table |
| `/admin/*` | An API key (`X-API-Key: lmk_...`) or a Bearer token with an admin scope, plus the permission |

A user token with only `openid profile email` gets `403`. Request the scope that the call needs:

| Endpoints | Scope |
|---|---|
| `GET /me/authenticators`, `GET /me/recovery-codes`, `GET /me/trusted-devices` | `mfa:read` or `mfa:manage` |
| Every other `/me/authenticators*`, `/me/recovery-codes` and `/me/trusted-devices/{id}` call | `mfa:manage` |
| `/mfa/challenges*` | `mfa:challenge` or `mfa:manage` |

`POST /me/authenticators/{type}/enroll` and `POST /me/recovery-codes` also need a recent sign-in. When the token's `auth_time` is too old, the API answers `401` with `error="insufficient_user_authentication"` and a `max_age` value in the `WWW-Authenticate` header. Send the user through the authorization endpoint again with that `max_age` (or `prompt=login`) and retry with the new token.

Never log an access token, a TOTP secret, a recovery code or a temporary access code.

## Self-service endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me/authenticators` | List the user's factors, with `status`, `allowed_types` and `recommended_type` |
| `POST` | `/me/authenticators/{type}/enroll` | Start enrollment. `type` is `totp`, `sms_otp`, `email_otp`, `push` or `passkey`. Returns `201` with a pending authenticator. |
| `POST` | `/me/authenticators/{id}/verify` | Finish enrollment |
| `PATCH` | `/me/authenticators/{id}` | Rename (`display_name`) or make default (`is_default`) |
| `DELETE` | `/me/authenticators/{id}` | Remove. Needs step-up with a different factor where the user has one. Returns `204`. |
| `GET` | `/me/recovery-codes` | Count of remaining codes |
| `POST` | `/me/recovery-codes` | Generate a new set. Shown once. The old set stops working. |
| `GET` | `/me/trusted-devices` | List trusted browsers |
| `DELETE` | `/me/trusted-devices/{id}` | Revoke one |

What `enroll` returns and what `verify` expects:

| Type | Enroll body | Enroll response (besides `id`, `state`) | Verify body |
|---|---|---|---|
| `totp` | none | `otpauth_uri`, `secret`, `secret_grouped`, `qr_data_uri`, `expires_at` | `{"code": "123456"}` |
| `sms_otp` | `{"phone": "+14155551234", "country": "US"}` | `masked_phone`, `resend_after` | `{"code": "123456"}` |
| `email_otp` | none | `masked_email` | `{"code": "123456"}` |
| `push` | none | `qr_data_uri`, `deep_link`, `activation_code`, `expires_at`. The `id` has the form `push_enrollment:<token>`. | `{}`; poll until `status` is `active` |
| `passkey` | none | `public_key`: the options for `navigator.credentials.create()`. The `id` is `passkey:pending`. | `{"credential": { ...PublicKeyCredential JSON... }}` |

Push enrollment states from `verify`: `pending` (the app has not connected), `awaiting_test` (show `number_match` so the user can tap it in the app), `test_denied`, `test_expired`, `active`, `expired`, `cancelled`, `failed`.

A pending enrollment that is not verified expires. A user's first factor can be added shortly after sign-in. Every later one needs step-up.

Minimal TOTP enrollment from a backend that holds the user's access token:

```typescript
const base = 'https://app.lumoauth.dev/orgs/acme-corp/api/v1';

export async function startTotp(accessToken: string): Promise<{ id: string; qrDataUri: string }> {
  const res = await fetch(`${base}/me/authenticators/totp/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`TOTP enrollment failed: ${res.status}`);
  }
  const body = (await res.json()) as { id: string; qr_data_uri: string };
  return { id: body.id, qrDataUri: body.qr_data_uri };
}

export async function verifyTotp(accessToken: string, id: string, code: string): Promise<boolean> {
  const res = await fetch(`${base}/me/authenticators/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return res.ok;
}
```

## Challenges

A challenge is one request to prove possession of an authenticator.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mfa/challenges` | Start a challenge. The factor is delivered at once. Returns `201`. |
| `GET` | `/mfa/challenges/{id}` | Poll (for push) until `status` is `approved`, `denied` or `expired` |
| `POST` | `/mfa/challenges/{id}/verify` | Answer with a code or a passkey assertion |

Request body of `POST /mfa/challenges`:

| Field | Default | Description |
|---|---|---|
| `purpose` | `step_up` | `step_up` or `login` |
| `authenticator_id` | the user's default | Challenge one specific factor, for example `"sms_otp:13"` |
| `min_tier` | from the policy | Integer 1 to 4. Require a factor at least this strong. An app can ask for a stronger factor than the policy, never a weaker one. |
| `action_description` | none | Text that the LumoAuth app shows for a push step-up. 255 characters at most. |

Response fields: `id`, `purpose`, `status` (`issued`, `approved`, `denied`, `expired`, `failed`), `authenticator`, `alternatives` (other factors that are strong enough), `expires_at`, `attempts_remaining`, `delivery` and, for push, `number_match`.

| `delivery` | What the client does |
|---|---|
| `push_sent` | Show `number_match`. Poll the challenge. |
| `sms_sent`, `email_sent`, `code_expected` | Ask for the code. Post `{"code": "..."}` to `/verify`. |
| `webauthn` | Pass `public_key` to `navigator.credentials.get()`. Post `{"credential": { ... }}` to `/verify`. |

For a push challenge, `/verify` with `{"code": "..."}` accepts the offline code from the LumoAuth app when the phone cannot receive the push.

Binding: a challenge is bound to the browser session or to the exact access token that created it. Use the same token for create, poll and verify. Another token gets `403 challenge_binding_mismatch`. Starting a new challenge expires the previous open one.

Creating and answering challenges count against a per-user budget that is shared with the hosted challenge page. Over it, the API answers `429` with a `Retry-After` header. Respect it. Do not retry in a loop.

## Step-up for API callers

These calls need a fresh verification:

| Operation | Rule |
|---|---|
| `POST /me/authenticators/{type}/enroll` | Only when the user already has a factor |
| `DELETE /me/authenticators/{id}` | With a different factor where the user has one |
| `POST /me/recovery-codes` | When replacing a set, and for a first set unless a sign-in method was added a short time ago |
| `POST /admin/users/{userId}/temporary-access-code` | For admins who call with their own user token. API keys are exempt. |

The caller sends the ID of an approved challenge of the same user in the `X-MFA-Challenge` header. Only a challenge with `purpose: "step_up"` counts, and only when it was answered with a factor at or above the policy's `min_tier_step_up`, within `step_up_max_age_seconds`.

```bash
BASE="https://app.lumoauth.dev/orgs/acme-corp/api/v1"

# 1. Start a step-up challenge. The default factor is delivered.
CH=$(curl -sS -X POST "$BASE/mfa/challenges" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"purpose":"step_up"}' | jq -r .id)

# 2. Answer it with the code that the user typed.
curl -sS -X POST "$BASE/mfa/challenges/$CH/verify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}"

# 3. Call the sensitive endpoint with the approved challenge ID.
curl -sS -X POST "$BASE/me/recovery-codes" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-MFA-Challenge: $CH"
```

Without it the API answers:

```json
{ "error": "step_up_required", "message": "Verify with a different sign-in method first.", "header": "X-MFA-Challenge" }
```

A user without any second factor cannot step up. For those users the session must be recent; otherwise they sign in again.

To finish a hosted sign-in from a custom form that runs on the LumoAuth domain: when JSON login returns `mfa_required`, the browser session may start a challenge with `"purpose": "login"`, verify it, and then continue to the authorization endpoint. An approved `login` challenge never satisfies step-up.

## Admin endpoints

| Method | Path | Permission | Scope |
|---|---|---|---|
| `GET` | `/admin/users/{userId}/authenticators` | `users.view` | `admin:users:read` |
| `DELETE` | `/admin/users/{userId}/authenticators/{authenticatorId}` | `users.edit` | `admin:users:write` |
| `POST` | `/admin/users/{userId}/temporary-access-code` | `users.edit` | `admin:users:write` |
| `GET` | `/admin/policies/mfa` | `settings.view` | `admin:settings:read` |
| `PUT` | `/admin/policies/mfa` | `settings.manage` | `admin:settings:write` |
| `GET` | `/admin/reports/mfa-coverage` | `users.view` | `admin:users:read` |

- `{userId}` accepts the user ID or the email address.
- `{authenticatorId}` has the form `type:number`, for example `totp:12`.
- Removing an authenticator and issuing a temporary access code also require that the caller holds every permission that the target user holds. Otherwise the API answers `403`.
- `POST /admin/users/{userId}/mfa/reset` was removed and answers `410`.

Temporary access code body:

| Field | Default | Description |
|---|---|---|
| `reason` | required | Stored in the audit log. `422` when missing. |
| `ttl_minutes` | 60 | Clamped to 5 to 10080 |
| `single_use` | `true` | `false` lets the code be used until it expires |

```bash
curl -sS -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/users/$USER_ID/temporary-access-code" \
  -H "X-API-Key: $LUMO_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason": "Lost phone; identity verified by video call", "ttl_minutes": 60}'
```

The code is returned once. Only one live code exists per user. The user is emailed, and the event is audited as `mfa.tap.issued`. Show the user this command before running it, and never write the returned code to a log or a file.

CLI equivalents: `lumo users authenticators list <user-id-or-email>`, `lumo users authenticators remove <user-id> <authenticator-id> [--yes]`, `lumo users tap <user-id-or-email> --reason "..." [--ttl <minutes>] [--multi-use] [--mfa-challenge <id>]`, `lumo mfa policy get`, `lumo mfa policy set`, `lumo mfa coverage`.

## Errors

| `error` | Status | Meaning |
|---|---|---|
| `authenticator_not_found` | 404 (410 for an expired setup) | Unknown ID, not the caller's, or no factor meets the requested tier |
| `factor_not_allowed` | 403 (400 for a passkey that is not FIDO-certified) | The organization does not allow this factor type |
| `step_up_required` | 403 | A fresh verification is needed |
| `insufficient_tier` | 403 | The approved factor is weaker than the sign-in required |
| `last_factor_required` | 409 | MFA is required and this would leave too few factors |
| `invalid_code` | 400 (410 when the challenge is exhausted) | Wrong code or credential |
| `challenge_expired` | 410 | The challenge or setup expired or was already used |
| `challenge_binding_mismatch` | 403 | The challenge belongs to another session or token |
| `mfa_locked` | 429 | MFA is paused for the account after repeated failures. `retry_after` gives the seconds. |
| `rate_limited` | 429 | Too many pushes, text messages or challenge calls |
| `push_suspended` | 429 | Push is paused after repeated denials |
| `invalid_input` | 422 (409 in some cases) | Invalid phone number, name too long, missing reason |
| `delivery_failed` | 503 | The text message could not be sent |
| `insufficient_user_authentication` | 401 | The token's sign-in is too old for this call |

Docs: https://docs.lumoauth.dev/api-reference/mfa
