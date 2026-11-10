# Risk and bot protection

Three layers protect the sign-in flows. All are configured per organization in the portal. There is no API or CLI for the providers.

| Layer | What it does | Applies to |
|---|---|---|
| IP intelligence | Geolocation, proxy / VPN / Tor / hosting flags and an abuse score for the sign-in IP | The risk score of adaptive authentication |
| Breached passwords | Rejects passwords that appear in known breaches | Registration, password reset, forced change; optionally sign-in |
| CAPTCHA | Human verification before credentials are processed | Sign-in, registration, forgot password, magic link |

## IP intelligence

- Page: `/orgs/{orgId}/portal/integrations/ip-intelligence` (**Integrations → Risk & bot protection**, **Configure** on a provider card)
- Permission: `settings.manage`

| Provider | The user must supply | Returns |
|---|---|---|
| **MaxMind GeoIP2** | Account ID and license key; choice of the **Insights** (recommended) or **City** web service | City-level location, ISP and ASN. Insights adds anonymous VPN, Tor exit node, proxy and hosting flags. |
| **IPQualityScore** | Private API key; optional strictness 0 to 3 | Location, ISP and ASN, proxy / VPN / Tor flags, a 0 to 100 fraud score |
| **AbuseIPDB** | API v2 key; report window in days | Country, ISP, Tor flag, hosting usage type, a 0 to 100 abuse-confidence score |

- Several providers can be added. They are tried in priority order (lowest number first) and the first successful answer is used.
- A successful result is cached for one hour per IP.
- **Test with a sample IP** on a saved provider runs an uncached lookup.
- AbuseIPDB returns signals but no detailed location. Pair it with MaxMind or IPQualityScore.
- Depending on the organization's plan, the page also shows a **Managed IP reputation** panel: LumoAuth then looks up sign-in IPs without a provider account of the organization. The organization's own providers take precedence over it.

What uses the result:

- The IP reputation, new country, geo-velocity and ASN signals of adaptive authentication (`/orgs/{orgId}/portal/settings/adaptive-auth`).
- The **Block Tor exit nodes** and **Block datacenter and VPN ranges** switches under **Network guard** on the same page. They depend on provider flags. Without a provider (or the managed feed) that returns those flags, the switches cannot be relied on.

A blocked sign-in is audited as `security.ip_blocked` and raises a high alert. Adaptive authentication is covered in `lumoauth-mfa-passkeys`.

## Breached passwords (Have I Been Pwned)

- Setting: `/orgs/{orgId}/portal/settings/authentication`, section **Auth lifecycle**. The **Configure** button on the **Have I Been Pwned** card of the Integrations page opens it.
- No API key is needed. Only a short prefix of the password's hash is sent to the service; the match is done locally.

| Setting | Default | Effect |
|---|---|---|
| **Reject passwords found in known breaches** | On | Applied at registration, password reset and forced change, and when an admin sets a password |
| **Minimum breach count** | 1 | A password counts as breached when it appears this many times or more |
| **Also check at sign-in** | Off | After a successful password sign-in, a breached password raises the risk score and forces a password change on the next page. Audited as `password.breached_at_login`. |

If the service cannot be reached, the password is accepted and `password.breach_check_unavailable` is written to the audit log.

For an app that creates users through the Admin API: a `password` in `POST /admin/users` goes through the same check and can be refused with `400`.

## CAPTCHA

- Page: `/orgs/{orgId}/portal/integrations/captcha` (**CAPTCHA & bot protection**)
- One provider per organization.

| Provider | The user must supply |
|---|---|
| **Cloudflare Turnstile** | Site key and secret |
| **hCaptcha** | Site key and secret |
| **reCAPTCHA Enterprise** | Score-based site key, Google Cloud API key, project ID, minimum score |

Setup:

1. Create the widget or key at the provider. Add the host names that serve the login page: the LumoAuth base URL host and the organization's custom domain when it has one.
2. Open the page, pick the provider, enter the keys and save.
3. Under **Live preview & verify test**, check that the widget renders, and run **Verify test token** against the saved secret.
4. Choose the placements, then enable.

Placements:

| Placement | Covers |
|---|---|
| **Sign-in** | The password step, the email-first account check, push-approval completion, and the JSON login endpoint |
| **Registration** | The email step of self-service sign-up (`/orgs/{orgId}/register`) |
| **Forgot password** | The reset-link request |
| **Magic link** | The magic-link request form |

Passkey sign-in is never challenged.

**When the provider is unreachable**:

- **Strict — fail closed (block the request)** is the default.
- **Lenient — fail open and write an audit entry** lets the request through and writes `captcha.bypassed`.

A token that the provider rejects always fails, in both modes.

### Effect on an app with its own sign-in form

An app that uses the hosted login page needs no change. An app that posts to the JSON login endpoint (see `lumoauth-oauth-oidc`) must render the provider's widget with the same site key and send the token in the field `captcha_token`. Without a valid token the endpoint answers:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"status": "captcha_required", "message": "..."}
```

Automated tests that sign in through the form need the provider's test keys in a test organization, or a placement that is off there.

## Audit events

| Event | When |
|---|---|
| `risk_provider.created`, `risk_provider.updated`, `risk_provider.toggled`, `risk_provider.deleted` | IP intelligence provider changes |
| `captcha.created`, `captcha.updated`, `captcha.deleted` | CAPTCHA configuration changes |
| `captcha.login_rejected` | A sign-in was blocked by a failed CAPTCHA before the credential check |
| `captcha.bypassed` | A provider outage let a request through in lenient mode |
| `password.breached_at_login`, `password.breach_check_unavailable` | Breached-password checks |

## Reference

- https://docs.lumoauth.dev/integrations/risk-and-bot-protection
