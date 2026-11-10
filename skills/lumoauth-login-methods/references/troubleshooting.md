# Login troubleshooting

Open this file when a sign-in fails. Start with the three checks below, then find the symptom in the tables.

## First checks

1. Run a clean sign-in. In the portal open **Test login** (under **Applications & developer tools**) and click **Start test login**. When this works, the organization is configured correctly and the fault is in the app's request.
2. Read the audit log. Open **Security → Audit logs** and filter by the user or by status. A failed attempt is recorded with a reason that the login page never shows. With the CLI: `lumo logs list --help` lists the filters.
3. Compare the issuer. Decode the token in the portal's **JWT inspector** and compare its `iss` with the issuer on **Endpoints & metadata**. They must be equal, including the region host and the organization slug.

Never paste a real token, password or client secret into a chat, an issue or a log while debugging.

## Sign-in page symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| "Invalid credentials" right after asking for a sign-up link | The account does not exist until the form behind the emailed link is submitted. The message is the same as for a wrong password. | Open the sign-up email and finish the form, or use **Send a new link** under the login error. |
| A sign-up link says that it is not valid | The link expired or was mistyped | Enter the address on the sign-up page again |
| "Invalid credentials" for an existing user | Wrong password, a blocked or deactivated account, or an account that is locked after repeated failures | Use **Forgot password**. When the page shows **Account temporarily locked**, wait and try again later. An admin can check the audit log. |
| The user is asked to verify the email on sign-in | LumoAuth treated the sign-in as unusual (new device or location) | Enter the code from the email. Letters are not case-sensitive. |
| The verification code does not arrive | Mail delivery delay or the spam folder | Wait, check spam, then choose **Resend** |
| The magic link opens a confirmation page | By design. The page stops mail scanners from using up the link. | Click **Sign in** on that page |
| The magic link no longer works | The link expired, was already used, or **Magic link login** was turned off after it was sent | Request a new link. Raise **Link expiry** when mail is slow. |
| Nothing happens after the email is entered | JavaScript is blocked | Enable JavaScript, or use the plain form that the page shows without scripts |
| No password field on the login page | **Hide password login and show the magic link form only** is on | Turn it off in **Sign-in settings → Login flow** |
| No **Create one** link, or sign-up offers social buttons only | Self-registration is off for the organization or for the application's login page | Create or invite users instead (`lumoauth-users-sessions`), or turn self-registration on |
| A deactivated user cannot sign in with a social provider | Expected. A social sign-in runs the same account checks as a password sign-in. | Reactivate the user when this is not intended |

## Social login symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| The provider shows a redirect URI error | The redirect URI in the provider console differs from the generated callback URL | Copy `{base}/orgs/{orgId}/auth/social/{provider}/callback` exactly |
| "An account with this email already exists. Please sign in with your original method to link this provider." | The existing account has a password, a role, portal access, a second factor, a passkey or another sign-in source | The user signs in with the usual method and links the provider at `/account/security` |
| "Check your email to finish setting up your account" | The provider did not confirm the email address | The user opens the emailed link and continues with the provider or a password |
| A Microsoft work account always gets the email step | The ID token has no `xms_edov` claim | Add `xms_edov` as an optional claim to the app registration in Entra |
| "That provider account has a different email address" | The user opened a sign-up link and then signed in at the provider with another address | Open the link again and use the account for the address that received it |
| Linking fails with "different email address" | The provider returned an email that differs from the account's email | Change one of them, or sign in with the provider as a separate user |
| Google users outside one domain are refused | **Hosted domain** is set and enforced | Remove or change `providerConfig.hosted_domain` |
| `403` when changing endpoints, issuer or the Microsoft tenant ID | The change decides who can sign in as the bound accounts, and the caller does not hold every permission that those accounts hold | Ask an organization owner to make the change |
| Role "X" cannot be used as a default role | The role is a system role or holds LumoAuth permissions | Use a role with application permissions only |

## OAuth and OIDC errors in the app

| Error | Meaning | Fix |
|---|---|---|
| `redirect_uri` mismatch or "invalid redirect URI" | The URI in the request is not an exact match with one that is registered on the application | Register the exact URI: scheme, host, port, path and trailing slash |
| `invalid_client` | Wrong client ID or secret, a disabled client, or a client of another organization | Check the credentials and the organization slug in the URL. Regenerate the secret when it was lost. |
| `invalid_grant` | The authorization code was used twice or expired, the PKCE verifier does not match, or the refresh token was revoked | Start the sign-in again. Use each code once, at once. |
| `access_denied` | The user declined consent, or a policy blocked the request | Ask the user to retry, or check the application's access policy |
| `state` mismatch in the app | The stored `state` differs from the returned one | Generate a new `state` for each sign-in and keep it in the user's session, not in a global variable |
| `403` on the Admin API with a user token | The token carries only `openid profile email` | Use an API key with the scopes that the call needs (`lumoauth-admin-api`) |
| `403` on a bare `/logout` request | The hosted sign-out link carries a CSRF token | Sign out through the OpenID Connect `end_session_endpoint` (`lumoauth-oauth-oidc`) |

For the code that builds the authorization request and handles the callback, use the framework skill or `lumoauth-oauth-oidc`.

Docs: https://docs.lumoauth.dev/user-guide/authentication/troubleshooting and https://docs.lumoauth.dev/api-reference/errors
