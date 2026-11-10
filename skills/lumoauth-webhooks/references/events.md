# LumoAuth webhook events

Open this file to choose the event names for a subscription and to read what `data` holds.

## Get the catalogue from the organization

The list below can be behind the product. The organization returns the current catalogue as
a map of event name to description:

```bash
lumo api GET /webhooks/events -o json
```

```bash
curl -sS "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/webhooks/events" \
  -H "Authorization: ApiKey $LUMO_API_KEY"
```

Both need the scope `admin:webhooks:read`. In the portal, the **Events** section of the
webhook form shows the same events grouped by category.

## Catalogue

### Users

| Event | Sent when |
|---|---|
| `user.created` | A user is created, including a person who finished a sign-up through a mailed link |
| `user.updated` | A user is updated |
| `user.deleted` | A user is deleted |
| `user.blocked` | A user is blocked |
| `user.unblocked` | A user is unblocked |
| `user.email_verified` | A user verifies the email address, including through a sign-up link |
| `user.signup_completed` | A person finishes a sign-up through a mailed link |

### Authentication

| Event | Sent when |
|---|---|
| `user.login` | A user signs in |
| `user.login_failed` | A sign-in attempt fails |
| `user.logout` | A user signs out |
| `user.password_changed` | A user changes the password |
| `user.mfa_enabled` | A user enrolls the first MFA factor |
| `user.mfa_disabled` | A user has no active MFA factor any more |

### MFA

| Event | Sent when |
|---|---|
| `mfa.enroll.started` | A user starts to enroll a factor |
| `mfa.enroll.completed` | A user finishes the enrollment of a factor |
| `mfa.enroll.failed` | An enrollment verification fails |
| `mfa.enroll.deferred` | A user chooses "Remind me later" on the MFA setup screen |
| `mfa.challenge.issued` | An MFA challenge is issued |
| `mfa.challenge.succeeded` | An MFA challenge is passed |
| `mfa.challenge.failed` | An MFA challenge fails |
| `mfa.push.denied` | A push sign-in request is denied in the app |
| `mfa.push.reported_fraud` | A user reports a push sign-in request as "This wasn't me". Route it to the security team |
| `mfa.factor.removed` | A factor is removed, by the user or an admin |
| `mfa.factor.default_changed` | A user changes the default factor |
| `mfa.recovery_codes.generated` | Recovery codes are generated or regenerated |
| `mfa.recovery_code.used` | A recovery code is used to sign in |
| `mfa.recovery.started` | Account recovery starts |
| `mfa.recovery.completed` | A recovered user finishes re-enrollment |
| `mfa.tap.issued` | An admin issues a temporary access code |
| `mfa.locked` | MFA is locked after too many failures |
| `mfa.policy.changed` | The organization's MFA policy changes |
| `mfa.trusted_device.added` | A user trusts a device |
| `mfa.trusted_device.revoked` | A trusted device is revoked |

### Identity, consent, sessions

| Event | Sent when |
|---|---|
| `identity.linked` | A social identity is linked to a user |
| `identity.unlinked` | A social identity is unlinked |
| `consent.granted` | A user grants consent to an OAuth client |
| `consent.revoked` | A user revokes consent |
| `session.revoked` | A session is revoked |

### OAuth clients and tokens

| Event | Sent when |
|---|---|
| `client.created` | An OAuth client is created |
| `client.updated` | An OAuth client is updated |
| `client.deleted` | An OAuth client is deleted |
| `client.secret_rotated` | A client secret is rotated |
| `token.issued` | An access token is issued |
| `token.revoked` | A token is revoked |

`token.issued` is a high-volume event. Subscribe to it only when the app needs it.

### Roles and groups

| Event | Sent when |
|---|---|
| `role.assigned` | A role is assigned to a user |
| `role.unassigned` | A role is removed from a user |
| `group.member_added` | A user is added to a group |
| `group.member_removed` | A user is removed from a group |

### Customer organizations (B2B)

| Event | Sent when |
|---|---|
| `organization.created` | A customer organization is created |
| `organization.updated` | A customer organization is updated |
| `organization.deleted` | A customer organization is deleted |
| `organization.member.added` | A member is added |
| `organization.member.removed` | A member is removed |
| `organization.member.updated` | A member's role changes |
| `organization.invitation.accepted` | An invitation is accepted |

### AI agents and JIT permissions

| Event | Sent when |
|---|---|
| `agent.created` | An agent is registered |
| `agent.updated` | An agent is updated |
| `agent.revoked` | An agent is revoked or deleted |
| `agent.attestation.accepted` | A workload attestation of an agent succeeds |
| `agent.attestation.rejected` | A workload attestation of an agent is rejected |
| `jit.approval_required` | A JIT permission request needs human approval |
| `jit.request.approved` | A JIT permission request is approved, from any review channel |
| `jit.request.denied` | A JIT permission request is denied |

### Diagnostics

| Event | Sent when |
|---|---|
| `webhook.test` | An admin chooses **Send test event** in the portal |

### Wildcard

`"*"` subscribes the webhook to every event. A wildcard webhook also receives event names
that are not in this catalogue, because audit events are passed on under their own names.
A receiver must answer 2xx for an event name that it does not handle.

## Events that arrive together

Some actions send more than one event, each as its own delivery with its own delivery ID:

| Action | Events |
|---|---|
| Sign-up through a mailed link | `user.signup_completed`, `user.created`, `user.email_verified` |
| An agent is deleted | `agent.revoked` (there is no separate "deleted" event) |

Make the worker idempotent on the business key (the user ID, the agent ID), not only on
the delivery ID.

## The body

```json
{
  "event": "mfa.push.reported_fraud",
  "timestamp": "2026-11-10T10:00:00+00:00",
  "tenant": "acme-corp",
  "data": {
    "status": "failure",
    "target_type": "user",
    "target_id": "0192a3f4-0000-7000-8000-000000000000",
    "target_name": "jane@example.com",
    "severity": "warning",
    "metadata": {
      "factor_type": "push",
      "reason": "user_reported_not_me"
    }
  }
}
```

| Field | Content |
|---|---|
| `event` | Event name. The same value as the `X-LumoAuth-Event` header |
| `timestamp` | ISO 8601 time with offset |
| `tenant` | Organization slug |
| `data` | Event-specific object |

The delivery ID is not in the body. Read it from `X-LumoAuth-Delivery` or from `id=` in the
signature header.

### Fields of `data`

Events that come from the audit trail (the `mfa.*` events, and most `user.*`, `client.*`,
`token.*` and `agent.*` events) carry this set. A field without a value is `null`.

| Field | Content |
|---|---|
| `status` | Outcome, for example `success` or `failure` |
| `action` | Action name of the audit entry |
| `actor_id`, `actor_name` | Who did it |
| `initiated_by` | Who started it, when that differs from the actor |
| `target_type`, `target_id`, `target_name` | What it was done to. For a user: `user`, the user ID, the email |
| `client_id` | OAuth client, when one was involved |
| `auth_method` | How the actor authenticated |
| `error_message` | Reason for a failure |
| `ip_address`, `user_agent` | Request context |
| `severity` | Severity of the audit entry |
| `metadata` | Event-specific details, for example `authenticator_id`, `factor_type`, `purpose`, `reason` |

Other events (for example `organization.*` and `jit.approval_required`) carry their own
fields. Do not hard-code a field name from memory. Look at a real delivery first:

```bash
lumo webhooks deliveries list 42 --limit 5 -o json
lumo webhooks deliveries get 42 <delivery-id> -o json | jq '.data.payload'
```

`data.payload` in the delivery detail is the `data` object that was sent. Treat every field
as optional in code, and treat the content as personal data: do not log whole payloads.

## Choosing events

| Goal | Events |
|---|---|
| Mirror users into the app's database | `user.created`, `user.updated`, `user.deleted`, `user.blocked`, `user.unblocked` |
| Welcome flow after sign-up | `user.signup_completed` or `user.created` (choose one) |
| Security monitoring | `user.login_failed`, `mfa.push.reported_fraud`, `mfa.locked`, `user.password_changed`, `mfa.factor.removed` |
| Keep app permissions in step | `role.assigned`, `role.unassigned`, `group.member_added`, `group.member_removed` |
| Provision a workspace per customer | `organization.created`, `organization.member.added`, `organization.member.removed` |
| Notify approvers of agent requests | `jit.approval_required`, `jit.request.approved`, `jit.request.denied` |
| React to an agent that was switched off | `agent.revoked` |

A webhook is a notification, not the source of truth. When a missed event would be costly,
reconcile on a schedule against the Admin API (`lumo users list`, `GET /admin/users`).
