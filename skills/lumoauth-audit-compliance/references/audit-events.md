# Audit event names

Use these names exactly as the value of the `eventType` filter. `a` / `b` in one cell stands for two events. Most events can end in success or failure; the `status` field of the detail entry says which.

This file lists the events that are most often needed. For the names that an organization has recorded, call `GET /admin/audit-logs/actions`. The complete catalogue is at https://docs.lumoauth.dev/user-guide/compliance/audit-logs.

Two families are written automatically, whatever screen, API or command made the change:

- **Record changes**: `<type>.created`, `<type>.updated`, `<type>.deleted` with the before and after values in `changes`. Covers users, the organization, roles, permissions, applications, social login providers, linked identities, agents and webhooks.
- **Grants and memberships**: `role.assigned` / `role.removed`, `permission.granted` / `permission.revoked`, `group.member_added` / `group.member_removed`.

## Sign-in and sessions

| Event | Recorded when |
|---|---|
| `user.login` | A browser session was created after a successful sign-in |
| `auth.login` | A sign-in through the hosted login form or the JSON login endpoint succeeded or failed (`channel`, `reason`) |
| `login.failed` | A password, passkey, magic-link or push sign-in failed (`method`, `reason`) |
| `auth.failed` | A machine credential failed: API key, Bearer token, SCIM token (`auth_method`) |
| `access.denied` | A `403` was returned to an authenticated caller |
| `account.locked` | An account was locked after repeated failed sign-ins |
| `magic_link_login` | A user signed in with a magic link |
| `captcha.login_rejected` | CAPTCHA verification failed before the password was checked |
| `password.breached_at_login` | The password used to sign in appears in a known breach |
| `adaptive_auth.decision` | Adaptive authentication scored a sign-in (`decision`, `risk_score`) |
| `security.ip_blocked` | A sign-in was rejected by a network block |
| `password_reset.requested` | A password reset was requested (`requested_by`) |
| `password_reset_completed` | A password reset link was used |
| `user.password_changed` | A password was changed (`source`) |
| `user.password.set_by_admin` | An admin set a user's password in the portal |
| `email_verified` | An email verification link was used |
| `user.signup_completed` | A person finished signing up through a mailed link |
| `session.revoked` | One session was ended (sign-out, or revoked by the user or an admin) |
| `session.revoked_all` | All sessions of a user, or of the organization, were revoked (`count`) |

## Social, enterprise SSO and LDAP

| Event | Recorded when |
|---|---|
| `oauth.social_login_initiated` / `oauth.social_login_success` | A social sign-in started / completed |
| `oidc_login_initiated` / `oidc_login_success` | A sign-in through an OIDC identity provider started / completed |
| `oidc_callback_error` | The OIDC provider returned an error |
| `saml_login_success` | A SAML sign-in completed |
| `saml_login_error` / `saml_acs_error` | Starting a SAML sign-in / processing the SAML response failed |
| `saml_user_provisioned` | A user was created from a SAML sign-in |
| `saml_response_issued` / `saml_response_error` | LumoAuth, as SAML IdP, issued / failed to issue a response to an application |
| `ldap.bind.success` / `ldap.bind.failed` | An LDAP bind with the user's credentials succeeded / failed |
| `ldap.user_provisioned` | A user was created from the directory at first LDAP sign-in |

## MFA

| Event | Recorded when |
|---|---|
| `mfa.enroll.started` / `mfa.enroll.completed` / `mfa.enroll.failed` | A factor enrollment started, became active, or a code was rejected |
| `mfa.challenge.issued` / `mfa.challenge.succeeded` / `mfa.challenge.failed` | A challenge was issued, passed or failed |
| `mfa.push.denied` | A push request was denied in the LumoAuth app |
| `mfa.push.reported_fraud` | The user chose "this wasn't me" |
| `mfa.factor.removed` | A factor was removed (`source`: `user` or `admin`) |
| `mfa.recovery_codes.generated` / `mfa.recovery_code.used` | Recovery codes were generated / one was used |
| `mfa.recovery.started` / `mfa.recovery.completed` | Account recovery started / finished |
| `mfa.tap.issued` | An admin issued a temporary access code |
| `mfa.locked` | MFA was locked after repeated failures |
| `mfa.policy.changed` | The MFA policy changed |

## Users, organizations, access

| Event | Recorded when |
|---|---|
| `user.created` / `user.updated` / `user.deleted` | A user account was created, changed or deleted, from any surface |
| `user.blocked` | An admin blocked a user |
| `user.roles.updated` | An admin changed a user's roles in the portal |
| `user.email_change_requested` / `user.email_changed` | A user asked to change the email / confirmed it |
| `user.invitation.sent` / `user.invitation.resent` / `user.invitation.revoked` / `user.invitation.accepted` | Invitation lifecycle |
| `identity.link.created` / `identity.link.removed` | An admin linked or unlinked a user's SAML, LDAP or social identity |
| `organization.created` / `organization.updated` / `organization.deleted` | A customer organization was created, changed or deleted |
| `organization.invitation.accepted` | A user accepted an invitation to a customer organization |
| `role.created` / `role.updated` / `role.deleted` | A role changed |
| `role.assigned` / `role.removed` | A role was added to or removed from a user or group |
| `permission.granted` / `permission.revoked` | A permission was granted to or removed from a user or role |
| `group.created` / `group.updated` / `group.deleted` | A group changed |
| `group.member_added` / `group.member_removed` | A user joined or left a group |
| `abac.policy_created` / `abac.policy_updated` / `abac.policy_deleted` | An ABAC policy changed in the portal |
| `zanzibar.tuple_created` / `zanzibar.tuple_deleted` | A relationship tuple was written or deleted in the portal |
| `permission_check`, `abac_check`, `zanzibar_check` | An authorization check was answered |

## Machine credentials, applications, tokens

| Event | Recorded when |
|---|---|
| `api_key.created` / `api_key.rotated` / `api_key.revoked` / `api_key.deleted` | API key lifecycle |
| `api_key.scopes_updated` | The scopes of a key changed (`old_scopes`, `new_scopes`) |
| `api_key.used` | A request authenticated with an API key |
| `scim.token_generated` / `scim.token_regenerated` | A SCIM bearer token was created / replaced |
| `client.created` | An OAuth client was registered |
| `client.secret_rotated` | A client secret was rotated |
| `oauth.authorization_issued` | A user completed authorization and the application received its response |
| `oauth.access_token_issued` | OAuth tokens were issued |
| `oauth.security.code_reuse_detected` | An authorization code was replayed |
| `token.revoked` | An admin revoked OAuth tokens |
| `signing_key.generated`, `signing_key.rotated`, `signing_key.primary_set`, `signing_key.imported`, `signing_key.revoked`, `signing_key.deleted` | Signing key lifecycle |
| `webhook.created` / `webhook.updated` / `webhook.deleted` | A webhook endpoint changed |
| `log_sink.created` / `log_sink.updated` / `log_sink.enabled` / `log_sink.disabled` / `log_sink.deleted` | A log sink changed |

## Agents

| Event | Recorded when |
|---|---|
| `agent.created` / `agent.updated` / `agent.deleted` | Agent registry changes |
| `agent.scopes_changed` | The capabilities of an agent changed |
| `agent.status_changed`, `agent.activated`, `agent.suspended`, `agent.revoked` | Agent lifecycle and kill switch |
| `agent.token_issued`, `agent.key_rotated`, `agent.key_revoked`, `agent.credentials_rotated` | Agent credentials were issued or rotated through the Admin API |

## Compliance

| Event | Recorded when |
|---|---|
| `data.exported` | An organization data export, or a user's personal data export |
| `audit.exported` | The audit log was exported (portal CSV or API) |
| `gdpr.dsr.created` / `gdpr.dsr.updated` | A data subject request was opened / changed status |
| `gdpr.erasure.completed` / `gdpr.erasure.failed` | A user was erased / erasure failed |
| `gdpr.portability.transmitted` | Personal data was sent to another service |
| `gdpr.restriction.applied` / `gdpr.restriction.lifted` | Processing restriction for a user was applied / lifted |
| `gdpr.consent.granted` / `gdpr.consent.withdrawn` / `gdpr.consent.expired` | A processing consent was given, withdrawn or expired (`purpose`) |
| `gdpr.breach.created` | A breach incident was opened |
| `gdpr.ropa.updated` / `gdpr.ropa.deactivated` | A processing activity was edited / deactivated |
| `gdpr.settings.updated` | Privacy settings changed |
| `security.audit_log_retention_deletion` | Audit rows older than the retention period were deleted (`deleted_count`, `retention_days`) |

## Risk levels

High and critical events are pushed to the organization's alert channels as they are written (see `lumoauth-integrations`). An event that is not in this table counts as `critical` when its severity is critical, `medium` when it failed or has severity `warning` or `error`, and `low` otherwise.

| Risk | Events |
|---|---|
| critical | `signing_key.imported`, `signing_key.revoked`, `signing_key.deleted`, `security.consent_integrity_violation` |
| high | `account.locked`, `oauth.security.code_reuse_detected`, `role.assigned`, `user.roles.updated`, `permission.granted`, `signing_key.generated`, `signing_key.rotated`, `signing_key.primary_set`, `agent.scopes_changed`, `data.exported`, `audit.exported`, `user.password.set_by_admin`, `user.password_changed` set by an admin, `mfa.tap.issued`, `mfa.factor.removed`, `mfa.policy.changed`, `mfa.locked`, `mfa.push.reported_fraud`, `mfa.recovery.completed`, `api_key.created`, `api_key.scopes_updated`, `client.secret_rotated`, `scim.token_generated`, `scim.token_regenerated`, `gdpr.erasure.completed`, `security.audit_log_retention_deletion`, `organization.deleted`, `adaptive_auth.decision` with decision `block` |
| medium | `login.failed`, `auth.failed`, `access.denied`, `security.ip_blocked` |
| low | `role.removed`, `permission.revoked`, `group.member_added`, `group.member_removed`, `agent.created`, `agent.updated`, `agent.deleted`, `agent.token_issued`, `webhook.created`, `webhook.updated`, `webhook.deleted`, `session.revoked`, `session.revoked_all`, `token.revoked`, `password_reset.requested`, `user.email_changed` |

## Useful queries

| Question | Filter |
|---|---|
| Who failed to sign in? | `eventType=login.failed` |
| Which accounts were locked? | `eventType=account.locked` |
| Who received a role? | `eventType=role.assigned` |
| What did one admin do? | `actorId=<user id>` with a date range |
| What happened to one user? | `targetType=user&targetId=<user id>` |
| Which API keys were created? | `eventType=api_key.created` |
| Who exported data? | `eventType=data.exported` and `eventType=audit.exported` |
| Who was erased? | `eventType=gdpr.erasure.completed` |
| What did one API key do? | `actorId=<key id>` (rows have `actorType: "api_key"`) |
