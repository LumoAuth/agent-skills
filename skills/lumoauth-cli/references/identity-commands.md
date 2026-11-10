# `lumo`: users, roles, permissions, groups, sessions, MFA, identities

Command tables for the people-and-access groups. Add `-o json` to every command whose
output you parse. Show the user each command in a "changes" row before you run it.

`<user>` means a user ID or an email address where the usage line says
`<user-id-or-email>`. Other user commands take the user ID: get it with
`lumo users get <email> -o json`.

## `users` (aliases `user`, `u`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo users list` | no | `--search <text>` (email, name or username), `--role <slug>`, `--group <slug>`, `--blocked` (`--blocked=false` for users that are not blocked), `--page <n>`, `--limit <n>`, `--sort <field>` (`email`, `name`, `createdAt`, `lastLoginAt`) |
| `lumo users get <user-id-or-email>` | no | |
| `lumo users create` | yes | `--email` (required), `--name`, `--given-name`, `--family-name`, `--username` (defaults to the email), `--password`, `--phone`, `--roles <slug,...>`, `--groups <slug,...>`, `--verified` |
| `lumo users update <user-id>` | yes | `--name`, `--email`, `--given-name`, `--family-name`, `--phone`, `--picture <url>`, `--active` / `--active=false`, `--verified` / `--verified=false`. At least one flag |
| `lumo users delete <user-id>` | yes | No confirmation prompt. Confirm with the user first |
| `lumo users block <user-id>` | yes | |
| `lumo users unblock <user-id>` | yes | |
| `lumo users set-password <user-id>` | yes | `--password` (required). The password must pass the organization's password policy |

Do not put a real password on a command line that is logged. Prefer to create the user
without `--password` and let the user set one through the sign-in page.

A 409 on `users create` (exit code 4) means that the email exists in the organization.

### `users roles` and `users groups`

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo users roles get <user-id>` | no | |
| `lumo users roles set <user-id> --roles <slug,...>` | yes | Replaces the user's roles with the given list |
| `lumo users groups get <user-id>` | no | |
| `lumo users groups set <user-id> --groups <slug,...>` | yes | Replaces the user's groups with the given list |

`set` replaces. To add one role, read the current roles with `get`, append the new slug,
then `set` the full list.

### `users authenticators` (aliases `authenticator`, `authn`, `factors`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo users authenticators list <user-id-or-email>` | no | Lists passkeys, push devices, authenticator apps, phone numbers, email codes and recovery codes |
| `lumo users authenticators remove <user-id> <authenticator-id>` (aliases `rm`, `delete`) | yes | `-y, --yes`. The authenticator ID has the form `<type>:<number>`, for example `totp:12` or `passkey:7`, as shown by `list` |

Removing an authenticator revokes the user's trusted devices and notifies the user. It does
not switch MFA off: when the organization requires MFA, the user enrolls again at the next
sign-in. Without a terminal, the command refuses to run without `--yes`.

`lumo users mfa-reset` is removed. It prints an error and changes nothing. Use
`users tap` or `users authenticators remove`.

### `users tap`: temporary access code

```bash
lumo users tap jane@example.com --reason "Lost phone; identity verified by video call" -o json
```

| Flag | Purpose |
|---|---|
| `--reason <text>` | Required. Recorded in the audit log and shown to the user |
| `--ttl <minutes>` | Minutes until the code expires, 5 to 10080. Default 60 |
| `--multi-use` | The code can be used more than once until it expires. Default: single use |
| `--mfa-challenge <id>` | ID of an approved step-up MFA challenge. Needed when the caller is signed in with `lumo login` and the server answers `step_up_required` |

The code stands in for the second factor and lets the user sign in and enroll a new factor.
It is returned once (`data.code` with `-o json`). Give it to the user over a verified
channel. Do not write it to a log.

### `users identities` (aliases `identity`, `idents`)

A federated identity link states which external identity signs in as the user: a SAML
identity provider and NameID, an LDAP directory and DN, or a social provider.

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo users identities list <user-id-or-email>` | no | |
| `lumo users identities link <user-id-or-email> --saml-idp <id> --name-id <NameID>` | yes | Links a SAML identity. Both flags are required |
| `lumo users identities link <user-id-or-email> --ldap-config <id> [--dn <DN>] [--ldap-only]` | yes | Links an LDAP identity. Without `--dn` the server looks the entry up by email, then username. `--ldap-only` also disables the local password |
| `lumo users identities unlink <user-id-or-email> --type saml\|ldap\|social` | yes | `-y, --yes` |

`link` and `unlink` also take `--mfa-challenge <id>`.

Every link change signs the user out of all sessions, notifies the user by email and is
audited. `link` replaces an existing link of the same type. It fails with HTTP 409
(`identity_conflict`) when another user holds that identity, or when the user is linked to
another federated source. Unlinking LDAP re-enables the local password, which usually needs
a reset.

## `identities` (alias `identity`): organization-wide tools

`lumo identities legacy-saml` reports and repairs users whose SAML link stores only a NameID
without an identity provider. While the organization has more than one SAML identity
provider, these users cannot sign in with SAML until they are relinked.

| Command | Changes | Purpose |
|---|---|---|
| `lumo identities legacy-saml` | no | Report: each affected user and the suggested identity provider |
| `lumo identities legacy-saml --idp <id>` | no | Report filtered to one identity provider |
| `lumo identities legacy-saml --idp <id> --relink --dry-run` | no | Shows what a relink would change |
| `lumo identities legacy-saml --idp <id> --relink --yes` | yes | Relinks every affected user whose email domain the identity provider claims |
| `lumo identities legacy-saml --idp <id> --relink --user <id> --user <id> --yes` | yes | Relinks only the listed users |

`--dry-run`, `--yes` and `--user` apply only with `--relink`. `--relink` needs `--idp`.
`--mfa-challenge <id>` is accepted. Always run the `--dry-run` form and show its result to
the user before the real run. Each relinked user is signed out and notified.

## `roles` (alias `role`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo roles list` | no | `--page`, `--limit` |
| `lumo roles get <role-id-or-slug>` | no | |
| `lumo roles create` | yes | `--name` (required), `--description`, `--permissions <slug,...>` |
| `lumo roles update <role-id>` | yes | `--name`, `--description`, `--permissions <slug,...>` |
| `lumo roles delete <role-id>` | yes | |

## `permissions` (aliases `permission`, `perms`, `perm`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo permissions list` | no | `--page`, `--limit` |
| `lumo permissions get <permission-id-or-slug>` | no | |
| `lumo permissions create` | yes | `--slug` (required, for example `document.edit`), `--name` (defaults to the slug), `--description` |
| `lumo permissions update <permission-id>` | yes | `--name`, `--description` |
| `lumo permissions delete <permission-id>` | yes | |

A 409 on `create` means that the slug exists or shadows a system permission.

## `groups` (alias `group`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo groups list` | no | `--search <name>`, `--page`, `--limit` |
| `lumo groups get <group-id-or-slug>` | no | |
| `lumo groups create` | yes | `--name` (required), `--description` |
| `lumo groups update <group-id>` | yes | `--name`, `--description` |
| `lumo groups delete <group-id>` | yes | |
| `lumo groups members list <group-id>` | no | |
| `lumo groups members add <group-id> --users <id-or-email,...>` | yes | |

To remove one member, call the endpoint directly. The Admin API removes one user per
request, by user ID:

```bash
lumo api DELETE /groups/<group-id>/members/<user-id> -o json
```

`lumo groups members remove <group-id> --users ...` exists, but it does not send the
`--users` values to the server. Do not rely on it.

## `sessions` (alias `session`) and `tokens` (alias `token`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo sessions list` | no | `--user <user-id>` (sessions of one user), `--page` |
| `lumo sessions revoke <session-id>` | yes | |
| `lumo sessions revoke-all --user <user-id>` | yes | Revokes every session of the user. `--user` is required |
| `lumo tokens list` | no | `--user <user-id>`, `--client <client-id>` |
| `lumo tokens revoke <token-id>` | yes | |

## `mfa`: organization policy and coverage

Per-user factors are under `lumo users authenticators` and `lumo users tap`.

| Command | Changes | Purpose |
|---|---|---|
| `lumo mfa policy get` | no | Shows the MFA policy. With `-o json` the response also has `effective_allowed_factors`: the allowed factors that the organization can deliver |
| `lumo mfa policy set [flags]` | yes | Sends only the flags that you pass; other values keep their current state. A change applies at each user's next sign-in |
| `lumo mfa coverage` | no | Enrollment report: enrolled users, factor types, users in the grace period |

`lumo mfa policy set` flags:

| Flag | Value |
|---|---|
| `--requirement` | `off`, `optional`, `required` or `risk_based` |
| `--allowed-factors` | Comma-separated, from `passkey`, `push`, `totp`, `sms_otp`, `email_otp` |
| `--grace-days` | 0 to 90: days that a user may sign in without MFA after it becomes required |
| `--trusted-device-days` | 0 to 180: days that a device stays trusted after MFA; 0 disables |
| `--min-tier-login` | 1 to 4: weakest factor tier accepted at sign-in (1 is the strongest) |
| `--min-tier-step-up` | 1 to 4: weakest factor tier accepted for step-up |
| `--required-factors` | 1 or 2: number of factors that each user must enroll |
| `--email-otp-counts` | Boolean: email codes count as a second factor |
| `--passwordless-passkey` | Boolean: passkeys sign in without a password |
| `--block-voip` | Boolean: refuse VoIP numbers for SMS codes |
| `--data '<json>'` | Raw JSON object with other policy fields. Flags override it |

Boolean flags take `--flag` or `--flag=false`.

```bash
lumo mfa policy get -o json
lumo mfa policy set --requirement required --grace-days 14 -o json
lumo mfa policy set --allowed-factors passkey,push,totp --min-tier-step-up 3 -o json
```

For what the factors and tiers mean, use the `lumoauth-mfa-passkeys` skill.
