# MFA policy reference

The MFA policy is one object per organization. Read it with `GET /orgs/{orgId}/api/v1/admin/policies/mfa` or `lumo mfa policy get`. Change it with `PUT` on the same path (partial body) or `lumo mfa policy set`. In the portal it is the **MFA policy** section of **Security → Sign-in settings** (`/orgs/{orgId}/portal/settings/authentication`).

The policy is organization-wide. There are no overrides per group. One application can only add "require MFA" (see the end of this file).

## Policy keys

| Key | Portal label | Values | Default | `lumo mfa policy set` flag |
|---|---|---|---|---|
| `requirement` | Requirement | `off`, `optional`, `risk_based`, `required` | `risk_based` | `--requirement` |
| `allowed_factors` | Allowed factors | Any of `passkey`, `push`, `totp`, `sms_otp`, `email_otp` | `passkey`, `push`, `totp`, `sms_otp` | `--allowed-factors` |
| `min_tier_login` | Minimum strength at sign-in | 1 to 4 | 4 | `--min-tier-login` |
| `min_tier_step_up` | Minimum strength for sensitive actions | 1 to 4 | 3 | `--min-tier-step-up` |
| `passwordless_passkey` | A passkey counts as both factors | `true` / `false` | `true` | `--passwordless-passkey` |
| `required_factor_count` | Factors each user must have | 1 or 2 | 1 | `--required-factors` |
| `grace_period_days` | Enrollment grace period (days) | 0 to 90 | 14 | `--grace-days` |
| `remind_interval_days` | Re-prompt after "Remind me later" (days) | 1 to 90 | 7 | `--data` |
| `trusted_device_days` | "Trust this device" period (days) | 0 to 180 (0 turns it off) | 30 | `--trusted-device-days` |
| `email_otp_counts_as_mfa` | Email codes count as a second factor | `true` / `false` | `false` | `--email-otp-counts` |
| `sms_block_voip` | Block internet (VoIP) phone numbers | `true` / `false` | `false` | `--block-voip` |
| `sms_country_allowlist` | SMS: only these countries | ISO 3166 alpha-2 codes; empty means all | `[]` | `--data` |
| `sms_country_denylist` | SMS: never these countries | ISO 3166 alpha-2 codes | `[]` | `--data` |
| `nudge_interval_days` | API only | 1 to 365 | 30 | `--data` |
| `step_up_max_age_seconds` | API only | 60 to 3600 | 600 | `--data` |
| `required_since` | Read-only | Time when the requirement last switched to `required` | `null` | none |

Behaviour of a write:

- Values outside a range are clamped to it.
- Unknown keys are ignored. Unknown factor types are dropped. An empty `allowed_factors` falls back to the default.
- An invalid `requirement` returns `422`.
- The response contains the full policy under `data`, plus `effective_allowed_factors`: the allowed factors that the organization can deliver. `sms_otp` is removed from that list while no SMS provider is configured.
- Changes apply at each user's next sign-in. Existing sessions are not ended. Each change is audited as `mfa.policy.changed`.

Example with keys that have no flag:

```bash
lumo mfa policy set --data '{"remind_interval_days": 14, "step_up_max_age_seconds": 300}'
```

## Legacy keys in the sign-in settings

`PATCH /admin/settings/authentication` still accepts `mfa_required`, `mfa_sms_enabled` and a partial `mfa_policy` object. They are not stored as sent. The server applies them as a change to the MFA policy: `mfa_required: true` sets `requirement` to `required`, `false` sets it to `risk_based` when it was `required`; `mfa_sms_enabled` adds or removes `sms_otp` in `allowed_factors`. Use the policy endpoint for new work.

## Factors and tiers

| Tier | Label | Factor type | What the user does | `amr` values |
|---|---|---|---|---|
| 1 | Strongest | `passkey` | Confirms with fingerprint, face, screen lock or security key | `hwk`, `user` |
| 2 | Strong | `push` | Taps the matching number in the LumoAuth app | `swk`, `user` |
| 3 | Standard | `totp` | Types the code from an authenticator app | `otp` |
| 4 | Basic | `sms_otp` | Types a code that was sent by text message | `sms` |
| 4 | Basic | `email_otp` | Types a code that was sent by email | `otp` |
| Recovery | Recovery | `recovery_code` | Types a single-use recovery code | `otp` |

Rules:

- An email code does not count as a second factor unless `email_otp_counts_as_mfa` is on.
- A recovery code never satisfies a sign-in policy on its own. Using one starts account recovery.
- A passkey counts as both factors while `passwordless_passkey` is on.
- LumoAuth challenges the user's default factor. When the default is weaker than the required tier, it picks the user's strongest factor that meets the tier.
- An authenticator is addressed as `{type}:{id}`, for example `totp:12`, `passkey:7`, `push:5`.

## Requirement modes

| Mode | Users without a factor | Users with a factor |
|---|---|---|
| `off` | Never prompted | Not challenged at sign-in, even when they set one up |
| `optional` | Shown **Secure your account** after sign-in, with **Remind me later** (prompted again after `remind_interval_days`) | Challenged at sign-in unless the device is trusted or adaptive MFA grants a low-risk skip. Medium and high risk always challenge. |
| `risk_based` | Not prompted at sign-in. They can add a factor at any time. A risky sign-in follows `no_mfa_action` (`allow`, `prompt`, `email`, `block`). | Same as `optional` |
| `required` | Must enroll. During the grace period they can choose **Remind me later**. After it, sign-in does not complete until a factor is enrolled. | Same as `optional`. They cannot remove the last factor. |

Notes:

- The grace period of each user counts from the later of the account creation and the moment when the organization switched to `required`.
- With `grace_period_days` 0, sign-in is blocked at once for users without a factor.
- `required_factor_count` 2 sends users with one factor back to enrollment after sign-in until they add a second one.

## What happens at sign-in

Password, magic link, social, passkey and push sign-ins run the same decision after the first step:

1. A user who recovered the account must enroll a new factor first.
2. A passkey sign-in with user verification counts as both factors when `passwordless_passkey` is on and passkeys are allowed.
3. A number-matched push approval counts as MFA.
4. A high or critical risk level revokes all trusted devices of the user. When the user holds a passkey or a push device, the challenge requires one of those.
5. Policy `off`, or no factor yet: no challenge. The enrollment rules apply, and for a risky sign-in `no_mfa_action`.
6. A valid trusted device skips the challenge, unless risk is medium or high.
7. Adaptive MFA may skip the challenge for a low-risk sign-in.
8. Otherwise the user is sent to the MFA challenge.

## Trusted devices

After a challenge, a user can tick **Trust this device for N days**. N is `trusted_device_days`. The current value applies to devices that were trusted earlier too. Trust is revoked when the user changes the password, removes a sign-in method, recovers the account, or signs in at high risk. Medium or high risk always challenges, and step-up always asks again.

## ACR values in tokens

Tokens that are issued after a challenge carry `amr` (first-step method, the factor, and `mfa`) and `acr` for the strongest tier that was completed in the session.

| `acr` | Tier | Met by |
|---|---|---|
| `urn:lumoauth:acr:mfa:phr` | 1 | Passkey |
| `urn:lumoauth:acr:mfa:strong` | 2 | Push, or stronger |
| `urn:lumoauth:acr:mfa` | 3 | Authenticator app, or stronger |
| `urn:lumoauth:acr:mfa:basic` | 4 | SMS or email code, or stronger |

First-step `amr` values: `pwd` password, `mail` magic link, `fed` social or federated login, `hwk` passkey, `swk` push.

The discovery document lists these values in `acr_values_supported`, plus `urn:lumoauth:acr:pwd`. That value stands for a sign-in with one factor. Any signed-in session meets it, and it never appears in the `acr` claim.

In `acr_values` the server also accepts the short forms `phr` and `phrh` (tier 1), `mfa` (tier 3) and `http://schemas.openid.net/pape/policies/2007/06/multi-factor` (tier 3). Other values are ignored. A client can also be registered with `default_acr_values` through dynamic client registration (`lumoauth-oauth-oidc`).

## Require MFA for one application

Portal only: **Applications → the app → Security → Authentication → Require multi-factor authentication**, saved with **Save auth settings**.

With the switch on, the authorization endpoint issues a code for that application only when the session passed a second factor. A verified factor, a trusted device and an adaptive low-risk skip all count. Otherwise the user is sent to step-up, which offers enrollment when the user has no factor. With `prompt=none` the application gets `interaction_required`. When the organization policy is `required`, the switch is on and locked.

## What the product does not include

State these limits when the user asks for them. Do not promise them.

- No voice-call delivery of codes.
- No self-service recovery by email plus phone. Recovery is a recovery code or a temporary access code from an admin.
- No approval of a temporary access code by a second admin.
- No per-group or per-application policy overrides.
- Push approvals are handled by the LumoAuth app only. An organization's own app cannot approve them.

Docs: https://docs.lumoauth.dev/user-guide/authentication/mfa
