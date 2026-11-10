# Passkeys, push and account recovery

Details for the two strongest factors and for recovery. The main path is in `SKILL.md`.

## Contents

- [Passkeys](#passkeys)
- [Push with the LumoAuth app](#push-with-the-lumoauth-app)
- [Hosted pages that users see](#hosted-pages-that-users-see)
- [Step-up on the hosted pages](#step-up-on-the-hosted-pages)
- [Recovery](#recovery)

## Passkeys

A passkey is a WebAuthn / FIDO2 credential. The private key stays on the user's device. LumoAuth stores the public key and verifies a signed challenge.

### Settings

| Setting | Key | Where |
|---|---|---|
| **Passkeys & biometrics** | `passkey_enabled` | **Security → Sign-in settings → Identity methods**; `PATCH /admin/settings/authentication`; `lumo settings update authentication --set passkey_enabled=true` |
| **Require FIDO-certified authenticators** | `passkeys.require_certified_authenticator` | Same section; through the API send the whole `passkeys` object: `{"passkeys": {"require_certified_authenticator": true}}` |
| A passkey counts as both factors | `passwordless_passkey` in the MFA policy | `lumo mfa policy set --passwordless-passkey` or `--passwordless-passkey=false` |
| Passkey allowed as a second factor | `passkey` in `allowed_factors` of the MFA policy | `lumo mfa policy set --allowed-factors ...` |

How the two switches differ:

- `passkey_enabled` off: passkey sign-in on the login page is refused, not only hidden. New passkeys cannot be added on the account page unless the MFA policy allows `passkey` as a factor.
- `passkey` removed from `allowed_factors`: passkeys are not offered for enrollment and do not count at sign-in.
- Turning passkey sign-in off does not lock out users who verify with a passkey as the second step.

### Fixed behaviour

- User verification is always required, on registration and on every sign-in. A security key without a PIN asks the user to set one. A client cannot lower this.
- Passkeys are created as discoverable credentials. The login page shows **Sign in with a passkey** without asking for an identifier first.
- A passkey belongs to the organization in which it was registered. It does not sign in to another organization.
- A passkey belongs to the domain on which it was created. A passkey that was created on the platform address signs in there. A passkey that was created on a custom domain signs in on that domain. After a switch to a custom domain (`lumoauth-branding`), each user creates a new passkey.

### Tokens

With `passwordless_passkey` on, a passkey sign-in yields `amr: ["hwk", "user", "mfa"]` and `acr: urn:lumoauth:acr:mfa:phr`. To demand a passkey from the app, send `acr_values=urn:lumoauth:acr:mfa:phr` on the authorization request and check `acr` in the returned token.

### App code

No WebAuthn code is needed in the app. The hosted login page and the account page call the browser API. The app only redirects to the authorization endpoint. To build custom enrollment UI, use `POST /me/authenticators/passkey/enroll` and `/verify` from the MFA API reference file.

### Browser support

Passkeys work in current versions of Chrome, Safari, Firefox and Edge. In a browser without support, the passkey option does not appear and the user signs in with another method.

### Passkey problems

| Symptom | Cause | Fix |
|---|---|---|
| "Sign-in failed" right after a touch on a security key | The key has no PIN, so user verification failed | Set a PIN on the key |
| The registration prompt asks to create a PIN | Expected for a key without one | Create the PIN |
| "Passkey sign-in is not enabled for your organization" | `passkey_enabled` is off | Turn it on |
| `403 passkeys_disabled` when adding a passkey | Passkey sign-in is off and the MFA policy does not allow `passkey` | Turn one of them on |
| `400` "This authenticator is not FIDO certified" | **Require FIDO-certified authenticators** is on | Use a certified authenticator, or turn the requirement off |
| Works in one organization or domain but not another | Passkeys are bound to the organization and the domain | Register a passkey in each |

## Push with the LumoAuth app

Push is a tier 2 factor. It works as a second factor after a password, as a step-up factor, and as a passwordless sign-in (email, then push). The login page offers push only for an address whose account has an active push device.

### Number matching

Every sign-in, step-up and enrollment test is number-matched. The page shows a number. The app shows several numbers, and the user taps the one that matches, then confirms with the phone's biometrics or passcode. A wrong number counts as a denial. This is mandatory.

An old version of the app that approves without a number is refused with `number_match_required`. Ask users to update the app.

### Enrollment by the user

1. The user opens `/account/security` → **Add a sign-in method**, or is sent to **Secure your account** after sign-in.
2. On a computer, the user scans the QR code with the app. On a phone, the user taps **Open the LumoAuth app**. The activation code under the QR code can be typed instead.
3. LumoAuth sends a test notification. The user taps the matching number and approves.
4. The device becomes usable only after the test is approved.

The QR code, the link and the activation code are single-use and expire after a short time. Adding a device needs a recent sign-in for the first factor, and a fresh verification with an existing factor for later ones.

### Enrollment started by an admin

Portal only: **Users** (`/orgs/{orgId}/portal/users`) → open the user → **Push authentication** → **Send activation code**. The user receives the code by email.

### Require push for everyone

| Setting | Key | Where |
|---|---|---|
| **Require push authentication** | `push_auth_required` | **Security → Sign-in settings → Identity methods**; `lumo settings update authentication --set push_auth_required=true` |
| **Name shown in push notifications** | `push_app_name` | Same section; `--set push_app_name=Acme`. Empty means the organization name. |

Users without an active device are sent to an enrollment page after sign-in and cannot continue until they finish.

### Step-up text on the phone

For a push step-up through the MFA API, the app can pass `action_description` (255 characters at most) to `POST /mfa/challenges`, for example a short description of the action that is approved. The LumoAuth app shows it on the approval screen. Do not put secrets or full account numbers in it.

### "Deny – this wasn't me"

When the user did not start the sign-in, **Deny – this wasn't me** denies the request, audits `mfa.push.denied` and `mfa.push.reported_fraud`, and emails the user. A plain **Deny** audits `mfa.push.denied` only. Repeated denials pause push for the user for a while. During the pause the user signs in with another factor.

### Lost or new phone

- New phone: the user enrolls the new phone first, then removes the old one at `/account/security`.
- Lost phone, other factor available: the user signs in with the other factor or a recovery code and removes the device.
- Lost phone, no other factor: an admin removes the device and issues a temporary access code (see [Recovery](#recovery)).

Push approvals are handled by the LumoAuth app only. For approval of AI agent actions on the phone, use `lumoauth-agent-approvals`.

## Hosted pages that users see

| Page | Path | Purpose |
|---|---|---|
| **Sign-in & security** | `/account/security` | Add, rename, set default and remove sign-in methods; recovery codes; trusted browsers |
| **Secure your account** | `/auth/secure-account` | Enrollment after sign-in. Shows one recommended factor and the others under **Other ways**. |
| MFA challenge | `/login/mfa-challenge` | Second factor at sign-in. Starts the user's factor automatically. **Try another way** lists the others. |
| Step-up | `/auth/step-up` | Fresh verification before a sensitive action |

The enrollment screen recommends a passkey when the browser reports a platform authenticator, then the LumoAuth app, then an authenticator app, then text message, then email code. Factors that the organization does not allow or cannot deliver are not shown.

## Step-up on the hosted pages

These actions ask for a fresh verification even when the user is signed in: adding a sign-in method when one exists, removing one, generating new recovery codes, changing the password or the email address, deleting the account, downloading a personal data export, and in the portal: creating or rotating an API key, regenerating a client secret, and setting a user's password.

The freshness window is `step_up_max_age_seconds` in the MFA policy and the required strength is `min_tier_step_up`. A trusted device, a low-risk skip and a temporary access code satisfy a sign-in, never step-up. A user without a second factor must have signed in a short time ago; otherwise the user signs in again.

For an agent this matters in one case: a portal action that issues a credential can stop and ask the admin for MFA. Tell the user to complete it in the browser.

## Recovery

When a user cannot use the usual factor, the options are, in order:

1. Another enrolled factor: **Try another way** on the challenge page.
2. A recovery code: **Use a recovery code**. Each code works once. Generating a new set invalidates the old one.
3. A temporary access code from an admin.

Admins cannot switch MFA off for a user. An admin can:

- Remove one authenticator: portal **Users** → the user → **Two-step verification** → **Remove**; or `lumo users authenticators remove <user-id> <authenticator-id>`.
- Issue a temporary access code: same portal section (**Reason**, **Valid for**, **Single use**, **Issue code**); or `lumo users tap <user-id-or-email> --reason "..."`.

After a sign-in with a recovery code or a temporary access code, LumoAuth signs out every other session, revokes all trusted devices, emails the user, and limits the session to setting up a new sign-in method and saving new recovery codes. The events `mfa.recovery.started` and `mfa.recovery.completed` are audited.

The user selects **I have a temporary access code from my admin** on the challenge page to enter the code.

Docs: https://docs.lumoauth.dev/user-guide/authentication/passkeys and https://docs.lumoauth.dev/user-guide/authentication/push-auth
