---
name: lumoauth-mfa-passkeys
description: >-
  Configures multi-factor authentication (MFA) and passwordless sign-in for a
  LumoAuth organization, and adds step-up authentication to an app. Covers the
  MFA policy (requirement modes, allowed factors, tiers, grace period, trusted
  devices), passkeys (WebAuthn / FIDO2), push approval in the LumoAuth
  Authenticator app, TOTP, SMS and email codes, recovery codes, adaptive
  risk-based MFA, step-up with `acr_values` and `max_age` and the `acr` and
  `amr` claims, the MFA API (`/admin/policies/mfa`, `/me/authenticators`,
  `/mfa/challenges`, `X-MFA-Challenge`), and `lumo mfa`, `lumo users
  authenticators` and `lumo users tap`. Use when the user asks to require or
  enforce MFA or 2FA, enable passkeys or push sign-in, tune risk-based MFA,
  demand a stronger sign-in for a sensitive action, help a user who lost a
  phone, or issue a temporary access code. Not for the first sign-in step
  (password, magic link, social) or for SAML and OIDC enterprise SSO.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth MFA, passkeys and step-up

Set the organization's MFA policy, turn on passkeys and push sign-in, tune adaptive MFA, and make an app ask for a stronger sign-in before a sensitive action. The policy and the factors are configuration. The only app code is the step-up request and the check of the `acr` claim.

## When to use

- Require MFA for everyone, or change which factors are allowed.
- Turn on passkey sign-in or require the LumoAuth app (push).
- Make sign-ins that look risky ask for a second factor, or block them.
- Ask for a recent or stronger sign-in before a sensitive action in the app (step-up).
- Help a user who lost a device: remove one authenticator or issue a temporary access code.

Do not use this skill for:

- Password, magic link, email-first or social login: use `lumoauth-login-methods`.
- SAML, enterprise OIDC or LDAP: use `lumoauth-enterprise-sso`.
- An AI agent that waits for a human to approve an action on the phone: use `lumoauth-agent-approvals`.
- SMS or email delivery providers: use `lumoauth-integrations`.
- Token validation in an API: use `lumoauth-api-protection`.

## Before you start

Ask the user for any value that is missing. Do not guess.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`acme-corp` in the examples) | The portal URL: `/orgs/{orgId}/portal` |
| Admin access | A portal admin session, `lumo login --org acme-corp`, or an API key (`lmk_...`) from `/orgs/{orgId}/portal/settings/api-keys` |
| For step-up code: the app's client ID and redirect URI | The application page in the portal, or `lumo apps list` |

Scopes for an API key or CLI token:

| Task | Scope | Permission of the caller (or of the creator of the key) |
|---|---|---|
| Read the MFA policy | `admin:settings:read` | `settings.view` |
| Change the MFA policy, passkey and push settings | `admin:settings:write` | `settings.manage` |
| List a user's authenticators, read coverage | `admin:users:read` | `users.view` |
| Remove an authenticator, issue a temporary access code | `admin:users:write` | `users.edit` |

Keep the API key in an environment variable on a server or in the shell. Never put it in browser or mobile code. Show the user every command that changes the organization before you run it. A policy change applies at each user's next sign-in and can lock users out of their usual flow, so confirm the requirement mode and the grace period with the user first.

## Where each setting is configured

| Feature | Portal page | Admin API | CLI |
|---|---|---|---|
| MFA policy (requirement, allowed factors, tiers, grace period, trusted devices) | **Security → Sign-in settings**, `/orgs/{orgId}/portal/settings/authentication`, section **MFA policy** | `GET` / `PUT /admin/policies/mfa` | `lumo mfa policy get`, `lumo mfa policy set` |
| Enrollment coverage | Same section | `GET /admin/reports/mfa-coverage` | `lumo mfa coverage` |
| Passkey sign-in, FIDO-certified authenticators only | Same page, section **Identity methods** (**Passkeys & biometrics**) | `PATCH /admin/settings/authentication` (`passkey_enabled`, `passkeys`) | `lumo settings update authentication` |
| Require push for everyone, name shown in push notifications | Same section (**Require push authentication**) | `PATCH /admin/settings/authentication` (`push_auth_required`, `push_app_name`) | `lumo settings update authentication` |
| Risky sign-in by a user without MFA | Section **MFA policy** (**Risky sign-ins by users without MFA**) | `PATCH /admin/settings/authentication` (`no_mfa_action`) | `lumo settings update authentication` |
| Adaptive MFA (engine, thresholds, signals, trusted IP ranges, network guard) | **Security → Adaptive security**, `/orgs/{orgId}/portal/settings/adaptive-auth` | Portal only | None |
| Require MFA for one application | **Applications → the app → Security → Authentication → Require multi-factor authentication** | Portal only | None |
| A user's authenticators, temporary access code | **Users** → the user → **Two-step verification**, `/orgs/{orgId}/portal/users` | `/admin/users/{userId}/authenticators`, `/admin/users/{userId}/temporary-access-code` | `lumo users authenticators list`, `remove`; `lumo users tap` |
| Send a push activation code to a user | **Users** → the user → **Push authentication** → **Send activation code** | Portal only | None |

Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`. Users enroll and manage their own factors at `/account/security` (**Sign-in & security**).

## Steps

### 1. Read the current policy

```bash
export LUMO_ORG=acme-corp
lumo mfa policy get -o json
lumo mfa coverage
```

For the EU region, also set `LUMO_BASE_URL=https://eu.app.lumoauth.dev`.

### 2. Choose the requirement mode and the factors

| `requirement` | Users without a factor | Users with a factor |
|---|---|---|
| `off` | Never prompted | Not challenged at sign-in |
| `optional` | Invited to enroll after sign-in, with **Remind me later** | Challenged at sign-in unless the device is trusted or adaptive MFA skips a low-risk sign-in |
| `risk_based` (default) | Not prompted. A risky sign-in follows `no_mfa_action`. | Same as `optional` |
| `required` | Must enroll. They can defer during the grace period. | Same as `optional`. They cannot remove the last factor. |

Factors and tiers (tier 1 is strongest): `passkey` (1), `push` (2), `totp` (3), `sms_otp` (4), `email_otp` (4). An email code counts as a second factor only when `email_otp_counts_as_mfa` is on. `sms_otp` is effective only after an SMS provider is configured (`lumoauth-integrations`).

Set the policy. Only the flags that are passed change:

```bash
lumo mfa policy set --requirement required --grace-days 14
lumo mfa policy set --allowed-factors passkey,push,totp --min-tier-step-up 3
lumo mfa policy set --trusted-device-days 30
```

Flags of `lumo mfa policy set`: `--requirement`, `--allowed-factors`, `--grace-days`, `--trusted-device-days`, `--min-tier-login`, `--min-tier-step-up`, `--required-factors`, `--email-otp-counts`, `--passwordless-passkey`, `--block-voip`, `--data`. Boolean flags take `--flag` or `--flag=false`. Use `--data` with a JSON object for any other policy key.

The same change through the API. `PUT` accepts a partial body:

```bash
curl -sS -X PUT "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/policies/mfa" \
  -H "X-API-Key: $LUMO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requirement": "required", "grace_period_days": 14, "min_tier_step_up": 3}'
```

Numbers outside their range are clamped. Unknown keys are ignored. An invalid `requirement` returns `422`. Read [references/mfa-policy.md](references/mfa-policy.md) for every key, its range and its default.

### 3. Turn on passkey sign-in

In the portal, open **Security → Sign-in settings → Identity methods** and turn on **Passkeys & biometrics**. With the CLI:

```bash
lumo settings update authentication --set passkey_enabled=true
```

- `passkey_enabled` controls passkey sign-in on the login page. A passkey as a second factor is controlled by `allowed_factors` in the MFA policy.
- With the policy key `passwordless_passkey` on (the default), a passkey sign-in counts as both factors.
- User verification (biometric or PIN) is always required. It is not a setting.
- A passkey is bound to the organization and to the domain where it was created. After a move to a custom domain, users create a new passkey on that domain.

To accept only FIDO-certified authenticators, turn on **Require FIDO-certified authenticators** in the same section. Through the API send `{"passkeys": {"require_certified_authenticator": true}}`.

### 4. Push with the LumoAuth app

Push is in the default `allowed_factors`. Users enroll the app themselves from `/account/security` → **Add a sign-in method**: they scan a QR code and approve a test notification. Every push is number-matched: the user taps the number that the sign-in page shows. This cannot be turned off.

To require an enrolled phone for everyone:

```bash
lumo settings update authentication --set push_auth_required=true --set push_app_name=Acme
```

For a general "everyone must use MFA" rule, prefer `requirement: required` in the MFA policy. It lets each user choose any allowed factor. Read [references/passkeys-and-push.md](references/passkeys-and-push.md) for enrollment, lost devices and the limits of each factor.

### 5. Adaptive (risk-based) MFA

Adaptive MFA scores each sign-in and asks for a second factor only when the risk is elevated. It is configured in the portal only: **Security → Adaptive security** (`/orgs/{orgId}/portal/settings/adaptive-auth`). Tell the user to open that page, turn on **Enable the adaptive security engine**, and save. One related key is in the sign-in settings and can be set from the CLI:

```bash
lumo settings update authentication --set no_mfa_action=prompt
```

`no_mfa_action` decides what happens on a risky sign-in by a user who has no factor: `allow`, `prompt`, `email` or `block`. Read [references/adaptive-mfa.md](references/adaptive-mfa.md) for the settings, the signals and a safe rollout order.

### 6. Request step-up from the app

Add `acr_values` to the authorization request when the app needs a stronger sign-in. Add `max_age` (seconds) when it needs a recent sign-in. LumoAuth sends the user to a step-up page when the session does not meet the level, then returns to the app with new tokens.

| `acr_values` | Tier | Met by |
|---|---|---|
| `urn:lumoauth:acr:mfa:phr` | 1 | Passkey |
| `urn:lumoauth:acr:mfa:strong` | 2 | LumoAuth app push, or stronger |
| `urn:lumoauth:acr:mfa` | 3 | Authenticator app, or stronger |
| `urn:lumoauth:acr:mfa:basic` | 4 | SMS or email code, or stronger |

With `@lumoauth/client` in the browser:

```typescript
import { AuthModule } from '@lumoauth/client';

const auth = new AuthModule({
  baseUrl: 'https://app.lumoauth.dev',
  orgId: 'acme-corp',
  clientId: 'CLIENT_ID',
});

export async function stepUp(acr: string, maxAgeSeconds?: number): Promise<void> {
  const extraParams: Record<string, string> = { acr_values: acr };
  if (maxAgeSeconds !== undefined) {
    extraParams.max_age = String(maxAgeSeconds);
  }
  const { url, codeVerifier, state } = await auth.buildAuthorizationUrl({
    redirectUri: 'http://localhost:3000/callback',
    scope: 'openid profile email',
    extraParams,
  });
  sessionStorage.setItem('pkce_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);
  window.location.href = url;
}
```

With any other OIDC library, add the same two parameters to the authorization URL.

After the callback, check the result on the server. Never assume that the request was honoured. Run this on claims of a token whose signature, issuer and audience are already verified (`lumoauth-api-protection`):

```typescript
const ACR_TIER: Record<string, number> = {
  'urn:lumoauth:acr:mfa:phr': 1,
  'urn:lumoauth:acr:mfa:strong': 2,
  'urn:lumoauth:acr:mfa': 3,
  'urn:lumoauth:acr:mfa:basic': 4,
};

export interface VerifiedClaims {
  acr?: string;
  amr?: string[];
  auth_time?: number;
}

export function meetsStepUp(claims: VerifiedClaims, requiredTier: number, maxAgeSeconds?: number): boolean {
  const tier = claims.acr ? ACR_TIER[claims.acr] : undefined;
  if (tier === undefined || tier > requiredTier) {
    return false;
  }
  if (maxAgeSeconds !== undefined) {
    if (claims.auth_time === undefined) {
      return false;
    }
    return Date.now() / 1000 - claims.auth_time <= maxAgeSeconds;
  }
  return true;
}
```

Rules to keep in mind:

- `acr` is absent when no second factor was completed in the session. That includes a sign-in where a trusted device or a low-risk skip avoided the challenge.
- `acr_values` is a preference list. The weakest listed level is the one that is enforced. Send one value.
- With `prompt=none`, a session that does not meet the level returns `error=interaction_required`.
- A user with no factor is sent to enrollment first.
- A session that was restored from the remember-me cookie has no `auth_time` in its ID token. Send `max_age` when the app needs that claim.

For step-up inside an API call without a browser redirect (the `X-MFA-Challenge` header), read [references/mfa-api.md](references/mfa-api.md).

### 7. Help a locked-out user

Admins cannot switch MFA off for one user. Two actions exist:

```bash
lumo users authenticators list jane@example.com
lumo users authenticators remove USER_ID totp:12
lumo users tap jane@example.com --reason "Lost phone; identity verified by video call" --ttl 60
```

- `remove` deletes one authenticator, for example a lost phone. The authenticator ID has the form `type:number`. The command asks for confirmation; pass `--yes` in scripts.
- `tap` issues a temporary access code. `--reason` is required and audited. `--ttl` is in minutes. `--multi-use` allows more than one use. The code is shown once. Give it to the user over a channel that is trusted, never in a ticket or a log. The user signs in with it and can then only enroll a new factor.
- With a token from `lumo login`, `tap` needs the admin's own fresh MFA: pass `--mfa-challenge` with the ID of an approved step-up challenge. An organization API key is not subject to this.

## Verify

1. `lumo mfa policy get -o json` shows the new values. The response also lists `effective_allowed_factors`: the factors that the organization can deliver.
2. Sign in as a test user in a private browser window at `{base}/orgs/{orgId}/login`. Check that enrollment or the challenge appears as the mode predicts.
3. For step-up: run the flow, decode the new ID token, and check `acr`, `amr` and `auth_time`. `amr` contains `mfa` after a second factor.
4. Open **Security → Audit logs** and look for `mfa.policy.changed` and the `mfa.*` events of the test sign-in.
5. `lumo mfa coverage` shows how many users are enrolled and how many are in the grace period.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Users are locked out right after `requirement: required` | `grace_period_days` is 0 | Set a grace period and announce the change first |
| SMS is in `allowed_factors` but users cannot choose it | No SMS provider is configured, so it is not in `effective_allowed_factors` | Configure a provider (`lumoauth-integrations`) |
| The `acr` claim is missing after sign-in | The challenge was skipped (trusted device or low risk) or the user has no factor | Send `acr_values` on the request when the app needs a level |
| Step-up loops or returns `interaction_required` | `prompt=none` was sent with `acr_values` | Remove `prompt=none` for the step-up request |
| `403 step_up_required` from the API | The call needs a fresh verification | Send the ID of an approved `step_up` challenge in `X-MFA-Challenge` |
| `409 last_factor_required` | MFA is required and this is the user's last factor | Enroll another factor first |
| A passkey works on the platform address but not on the custom domain | A passkey is bound to the domain where it was created | The user creates a new passkey on the custom domain |
| "Sign-in failed" right after a touch on a security key | The key has no PIN, so user verification failed | Set a PIN on the key |
| `POST /admin/users/{userId}/mfa/reset` returns `410` | The endpoint was removed | Remove one authenticator or issue a temporary access code |
| High-risk sign-ins from a social provider are not blocked | A block cannot be enforced after the provider has authenticated the user. It becomes a mandatory MFA challenge. | Expected. Check the `adaptive_auth.decision` audit rows. |
| A push never arrives | The app is not enrolled, push is paused after repeated denials, or the app is out of date | The user picks **Try another way**, or **Use a code from the app instead** |

## Related skills

- `lumoauth-login-methods`: the first sign-in step.
- `lumoauth-oauth-oidc`: authorization request, callback, token handling.
- `lumoauth-api-protection`: verify tokens before reading `acr` and `amr`.
- `lumoauth-users-sessions`: users, sessions, account self-service.
- `lumoauth-integrations`: SMS and email delivery, risk and bot protection providers.
- `lumoauth-agent-approvals`: human approval of agent actions in the LumoAuth app.
- `lumoauth-audit-compliance`: audit log and `mfa.*` events.

## References

- [references/mfa-policy.md](references/mfa-policy.md): open when setting policy keys or explaining what happens at sign-in.
- [references/mfa-api.md](references/mfa-api.md): open when building enrollment or challenge UI, or step-up for API callers.
- [references/adaptive-mfa.md](references/adaptive-mfa.md): open when tuning risk-based MFA.
- [references/passkeys-and-push.md](references/passkeys-and-push.md): open for passkey and push details, lost devices and recovery.
- https://docs.lumoauth.dev/user-guide/authentication/mfa
- https://docs.lumoauth.dev/user-guide/authentication/adaptive-mfa
- https://docs.lumoauth.dev/user-guide/authentication/passkeys
- https://docs.lumoauth.dev/user-guide/authentication/push-auth
- https://docs.lumoauth.dev/api-reference/mfa
- https://docs.lumoauth.dev/oauth/authorize
