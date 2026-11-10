# Adaptive (risk-based) MFA

Adaptive MFA scores each sign-in from 0 to 100 and maps the score to a level. A low-risk sign-in proceeds. An elevated one gets an MFA challenge. A critical one is refused before a session exists.

## Where it is configured

Portal only: **Security → Adaptive security**

```text
/orgs/{orgId}/portal/settings/adaptive-auth
```

There is no CLI command and no Admin API endpoint that writes these settings. Give the user the page and the values to set. The caller needs the `settings.manage` permission to save the page.

One related setting is elsewhere: **Risky sign-ins by users without MFA** (`no_mfa_action`) is in the **MFA policy** section of **Security → Sign-in settings**, and it can be written with `lumo settings update authentication --set no_mfa_action=<value>`.

## Settings on the page

The page has the sections **Security engine**, **Risk thresholds**, **Adaptive MFA**, **Detection signals**, **Network guard**, **AI risk assessment** and **Trusted IP ranges**.

| Portal setting | Meaning | Default |
|---|---|---|
| **Enable the adaptive security engine** | Turns risk scoring on. The page title shows **Engine active** or **Engine off**. | Off |
| **Medium risk, MFA challenge** | Score at or above which an MFA challenge is required | 50 |
| **High risk, block and force MFA** | Score at or above which the high-risk action applies | 80 |
| **Skip MFA on trusted sign-ins** | Users who have MFA skip the second factor on a sign-in that is scored as low risk | Off |
| **MFA skip threshold** | Sign-ins that are scored below this skip the prompt. MFA is always enforced at or above the medium threshold. | 30 |
| **Trusted IP ranges** | Addresses or CIDR ranges that are always treated as low risk | None |
| **Block Tor exit nodes** | Refuse sign-ins from Tor exit nodes before scoring | On |
| **Block datacenter and VPN ranges** | Refuse sign-ins from VPN, proxy or hosting addresses before scoring | Off |

The two network guard switches act only on flags that an IP-intelligence provider reports. Without a provider they cannot be relied on. Providers are configured with `lumoauth-integrations`. Trusted IP ranges are exempt from the network guard.

Levels and default actions:

| Level | Default action |
|---|---|
| Low | Permit. MFA can be skipped when **Skip MFA on trusted sign-ins** is on. |
| Medium | MFA challenge |
| High | MFA challenge. All trusted devices of the user are revoked first. When the user holds a passkey or a push device, the challenge requires one of them. |
| Critical | Sign-in refused |

The action for a risky sign-in by a user without any factor is `no_mfa_action`:

| Value | Portal label | Result |
|---|---|---|
| `allow` (default) | **Allow** | The sign-in proceeds |
| `prompt` | **Prompt for MFA setup** | The user is sent to enrollment |
| `email` | **Email verification** | The user enters a code that was sent by email |
| `block` | **Block access** | The sign-in is refused |

## Detection signals

Each signal can be switched on or off in **Detection signals**. There are no weights to set.

| Portal label | Detects |
|---|---|
| **Impossible travel** | Two sign-ins whose locations cannot be reached in the time between them |
| **New country** | A country that the user has not signed in from before |
| **Device fingerprinting** | An unrecognized device or a changed browser fingerprint |
| **IP reputation** | Addresses that are known as malicious, proxy, VPN or Tor |
| **ISP / ASN anomaly** | An unexpected network |
| **Login time patterns** | A deviation from the user's normal behaviour |
| **Login velocity** | Unusually frequent sign-in attempts |
| **Failed login detection** | Recent failed attempts before a success |

Example: for users who travel often, switch **New country** off and keep **Device fingerprinting** and **IP reputation** on.

## AI risk assessment

The **AI risk assessment** section has a master switch (**Send login metadata to the AI provider**) and four switches for what is shared: precise geolocation, raw IP address, raw email address and user agent. Only the user agent switch is on by default. Tell the user to turn on only what the organization's privacy policy permits.

## Where a block is enforced

A block is applied before the sign-in completes on the organization's login form, passkey sign-in and inbound SAML. For a sign-in that an upstream provider has already authenticated (social login, inbound OIDC), a block is downgraded to a mandatory MFA challenge and the audit row carries `decision: block_unenforced`.

A refused sign-in shows a generic message that does not name the signal. The refusal is audited and raises a security alert.

## Interaction with trusted devices

| Risk level | Trusted device | Result |
|---|---|---|
| Low | Valid | Challenge skipped |
| Low | None | Skipped only when **Skip MFA on trusted sign-ins** is on and the score is below the skip threshold |
| Medium | Any | Challenged. Trust is ignored. |
| High or critical, not refused | Any | All trusted devices revoked, then challenged |

Users without any factor are never challenged. For them `no_mfa_action` applies. Step-up always requires a fresh verification, whatever the risk level.

## Audit events

| Event | Meaning |
|---|---|
| `adaptive_auth.decision` | One row per evaluated sign-in with `decision` (`permit`, `challenge`, `block`, `block_unenforced`), `risk_score`, `risk_level` and the contributing `signals` |
| `adaptive_auth.challenge`, `adaptive_auth.block` | A sign-in was challenged or refused |
| `adaptive_auth.error` | Scoring failed. The sign-in proceeded without a risk decision. |
| `adaptive_auth.ai_assessment` | The AI assessment ran |

View them in **Security → Audit logs** (`/orgs/{orgId}/portal/audit-logs`). To send them to another system, add a webhook (`lumoauth-webhooks`).

## Safe rollout

1. Turn the engine on with the default thresholds. Leave everything else as it is.
2. Add the office and VPN ranges of the organization to **Trusted IP ranges**.
3. Read the `adaptive_auth.decision` rows for a period of normal use. Check which signals raise the score for real users.
4. Switch off the signals that produce false alarms for this user base, or adjust the medium and high thresholds.
5. Set `no_mfa_action` to `prompt` so that users without a factor are asked to enroll on a risky sign-in.
6. Only then consider **Skip MFA on trusted sign-ins**.

Keep **Trust this device** enabled in the MFA policy. Users are still challenged at medium and high risk.

Docs: https://docs.lumoauth.dev/user-guide/authentication/adaptive-mfa
