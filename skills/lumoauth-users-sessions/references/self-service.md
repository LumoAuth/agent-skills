# Account self-service pages

Every user of an organization gets these pages without any work in the customer's app. Link to them from the app instead of rebuilding them.

The pages are under `/account/*` on the LumoAuth base URL. They are not prefixed with `/orgs/{orgId}/`. They need the user's LumoAuth browser session and a CSRF token, so an app cannot call their form actions with an access token or an API key.

## Pages

| Sidebar item | Purpose | URL |
|---|---|---|
| **Overview** | Account health with the next step to take, shortcuts, signed-in devices | `/dashboard` |
| **Personal info** | Name, email, phone, birthday, language, time zone, address, links | `/account/profile` |
| **Sign-in & security** | Password, two-step verification methods, recovery codes, devices and trusted browsers, linked social accounts | `/account/security` |
| **Privacy & data** | Data-use preferences, data download, privacy requests, consent history, cookie preferences, restrict processing, delete account | `/account/privacy` |
| **Authorized apps** | Apps that the user allowed, what each one can do, remove access | `/account/consents` |
| **Accounts agents can use** | Third-party accounts that the user lets the organization's AI agents use | `/account/connections` |
| **AI agents acting for you** | Agents that hold delegated authority for the user | `/account/my-agents` |
| **Your organizations** | Customer organizations that the user belongs to, with the role in each | `/account/organizations` |

Other pages: **Your devices** (`/account/sessions`), password reset (`/account/forgot-password`), profile completion for progressive profiling (`/account/complete-profile/`).

## What users can do

| Action | Where | Protection |
|---|---|---|
| Edit profile fields | `/account/profile` | - |
| Change email | **Change email** dialog in the **Contact** section | Current password (or a recent sign-in for an account without a password) and a fresh two-step verification when the user has one. The new address must be confirmed through an emailed link within one hour, in a signed-in session. Every other session is then signed out. |
| Change password | `/account/security`, **Change password** | Current password. A user with an MFA factor needs a recent verification, otherwise the user is sent to `/auth/step-up` first. |
| Reset a forgotten password | `/account/forgot-password` | Emailed, time-limited link. Other sessions and OAuth tokens are revoked. |
| Add a sign-in method (passkey, authenticator app, phone, LumoAuth app) | `/account/security`, **Add a sign-in method** | Recent sign-in for the first method; verification with an existing method for later ones |
| Rename a method, make it the default, remove it | **⋯** menu of the method | Removal needs verification with a different method. It is refused for the last method when the organization requires MFA. |
| Create new recovery codes | `/account/security`, **Recovery codes** | Fresh verification |
| See signed-in devices, sign out one, sign out all others | `/account/sessions` | - |
| Forget trusted browsers | `/account/security`, **Devices** | - |
| Link or unlink a social account | `/account/security`, **Linked accounts** | Unlink is refused when it is the only way left to sign in |
| Download own data (JSON or CSV), portable file | `/account/data-export` | Fresh verification, or a recent sign-in for an account without a second factor |
| Send a privacy request | `/account/dsr` | - |
| Review consent history, cookie preferences | `/account/consent-history`, `/account/consent/cookies` | - |
| Restrict processing, delete the account | **Restrict or delete** section of `/account/privacy` | Offered directly only when the organization enables self-service restriction or deletion in its GDPR settings. Otherwise the buttons send a privacy request. |

The privacy tools are described in `lumoauth-audit-compliance`.

## Sign-out

- A user signs out of LumoAuth through `/logout`, which requires a CSRF token. A bare `GET /logout` is refused.
- An app that signs users in through OAuth ends the LumoAuth session with the OIDC logout endpoint, not with a link to `/logout`. See `lumoauth-oauth-oidc`.

## A custom account UI

Do not post to the `/account/...` form actions from an app. For a custom security page, use the MFA API with the user's access token (`/orgs/{orgId}/api/v1/me/authenticators`, `/me/recovery-codes`, `/me/trusted-devices`); see `lumoauth-mfa-passkeys`. For the profile, read `GET /orgs/{orgId}/api/v1/me` and send the user to `/account/profile` to edit.

## Password policy

Admins set the policy on `/orgs/{orgId}/portal/settings/authentication`, in the **Password standards** and **Auth lifecycle** sections: a template (**Fair**, **Moderate**, **Strict** or **Custom**), minimum length, required character classes, the breached-password check and periodic password resets. The policy applies to every way of setting a password, including the Admin API.

## Reference

- https://docs.lumoauth.dev/user-guide/user-management/account-self-service
