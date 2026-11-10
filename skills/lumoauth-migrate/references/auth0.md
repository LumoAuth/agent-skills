# Migrate from Auth0

Auth0 is the one source with an importer: `lumo migrate auth0`. It reads an Auth0 user
export and creates each user through `POST /admin/users`.

## 1. Export the users from Auth0

Export the users as JSON, either from the Auth0 dashboard or with a user export job of the
Auth0 Management API (`POST /api/v2/jobs/users-exports` with `"format": "json"`). Choose
JSON, not CSV: CSV loses the nested `user_metadata` and `app_metadata`, which the
application may want to keep in its own database.

The importer accepts both shapes that Auth0 produces: one JSON array, or one JSON object
per line. It detects the shape itself. Blank lines are ignored.

Check the file before the run:

```bash
jq -c 'if type == "array" then .[] else . end' users.json | wc -l          # number of users
jq -c 'if type == "array" then .[] else . end | select(.email == null)' users.json | wc -l   # users without an email
```

Each record needs at least `email`. The importer reads `email`, `email_verified`, `name`,
`given_name`, `family_name`, `nickname`, `username`, `user_id`, `picture`, `locale`,
`blocked`, `created_at`, `user_metadata` and `app_metadata`. If an export job lists fields,
include these.

## 2. Run the importer

```bash
lumo migrate auth0 --file users.json --dry-run
lumo migrate auth0 --file users.json --limit 100 -o json
lumo migrate auth0 --file users.json -o json
```

| Flag | Default | Purpose |
|---|---|---|
| `--file <path>` | required | The export file |
| `--dry-run` | off | Parses the file and reports. Sends nothing to LumoAuth |
| `--limit <n>` | 0 (no limit) | Takes only the first `n` users of the file |
| `--concurrent <n>` | 4 | Parallel requests, 1 to 16 |
| `--send-reset` | off | Defined, but the current CLI does not act on it. See step 4 |

`migrate` has no organization flag of its own. The target is the global `--org`, the
`LUMO_ORG` variable or the active profile. Check it with `lumo whoami -o json` and show
the user the command and the target before the real run.

Output:

- One line per user on standard error: `✓ email` (created), `– email  (already exists)`
  (skipped), `✗ email  HTTP <status>  <message>` (failed).
- A final line on standard error: `Done. created=N skipped=N failed=N`.
- With `-o json`, one JSON object on standard output:
  `{"total": 138, "created": 124, "skipped": 12, "failed": 2, "dry_run": false}`.
- Exit status 1 when any user failed, otherwise 0.

Facts about a run:

- A dry run does not contact LumoAuth. It reports every user with an email as created and
  cannot tell which emails exist.
- A user without an email is skipped and never sent.
- An email that exists in the organization answers HTTP 409 and is counted as skipped. A
  second run therefore creates only the missing users.
- A request that fails with HTTP 429 is reported as failed, not retried. Lower
  `--concurrent` (for example to 2) and run the command again.
- `--limit` always takes the first users of the file. For stages, raise the limit; the
  users of the earlier stage are skipped.

Capture the per-user lines for the record: `2> auth0-import.log`.

## 3. What LumoAuth stores

| Auth0 field | LumoAuth field |
|---|---|
| `email` | `email` (stored in lower case) |
| `email_verified` | `emailVerified` |
| `name`, `given_name`, `family_name` | `name`, `givenName`, `familyName` |
| `username` | `username` (the email when absent) |

The importer also sends `nickname`, `picture`, `locale`, `blocked` and a `traits` object
with `auth0_user_id`, `auth0_user_metadata`, `auth0_app_metadata` and `auth0_created_at`.
The user creation endpoint does not store these. After the run:

- build the mapping from the Auth0 `user_id` to the LumoAuth user ID;
- set `picture` and `locale` with a user update;
- block the users that were blocked in Auth0;
- keep `user_metadata` and `app_metadata` in the application's database, keyed by the
  LumoAuth user ID.

`auth0-after-import.sh` does the first three. It was run against a stub of the CLI with
both export shapes. Show it to the user before you run it: it updates and blocks users.

```bash
#!/usr/bin/env bash
# auth0-after-import.sh <auth0-export.json>
# Builds auth0-mapping.csv (auth0_user_id,lumoauth_user_id), then sets picture and locale
# and blocks the users that were blocked in Auth0. Safe to run again.
set -euo pipefail

EXPORT="${1:?usage: auth0-after-import.sh <auth0-export.json>}"
MAPPING="auth0-mapping.csv"
: > "$MAPPING"

# The export is a JSON array or one JSON object per line; this handles both.
jq -c 'if type == "array" then .[] else . end
       | select(.email != null and .email != "")
       | {user_id, email: (.email | ascii_downcase), picture, locale, blocked: (.blocked == true)}' "$EXPORT" \
| while IFS= read -r row; do
  email=$(jq -r '.email' <<<"$row")
  id=$(lumo users get "$email" -o json 2>/dev/null | jq -r '.data.id // empty') || true
  if [ -z "$id" ]; then
    echo "not found in LumoAuth: $email" >&2
    continue
  fi
  printf '%s,%s\n' "$(jq -r '.user_id' <<<"$row")" "$id" >> "$MAPPING"

  patch=$(jq -c '{picture, locale} | with_entries(select(.value != null and .value != ""))' <<<"$row")
  if [ "$patch" != "{}" ]; then
    lumo api PATCH "/users/$id" --data "$patch" -o json >/dev/null
  fi
  if [ "$(jq -r '.blocked' <<<"$row")" = "true" ]; then
    lumo users block "$id" -o json >/dev/null
  fi
done

echo "wrote $(wc -l < "$MAPPING") line(s) to $MAPPING" >&2
```

Not migrated: `last_login` and login counts (LumoAuth counts from the cut-over), password
hashes, MFA enrollments, passkeys, sessions and refresh tokens.

## 4. First sign-in of migrated users

Users are created without a password. They sign in by password reset, by magic link when
it is switched on, or with a social or enterprise provider that is configured in
LumoAuth.

To send a password reset email to a user from the admin side:

```bash
lumo api POST /users/<user-id>/password-reset -o json
```

For all imported users, loop over the mapping. This sends one email per user: agree the
timing and the wording of the announcement with the user first, send to a small group
first, and keep the pace low.

```bash
#!/usr/bin/env bash
# send-resets.sh <mapping.csv>: one password reset email per mapped user.
set -euo pipefail
while IFS=, read -r _old_id user_id; do
  [ -z "$user_id" ] && continue
  lumo api POST "/users/$user_id/password-reset" -o json >/dev/null     || echo "reset failed for $user_id" >&2
  sleep 1
done < "${1:?usage: send-resets.sh <mapping.csv>}"
```

Do not send reset emails to users who sign in only with a social or enterprise provider.
Split the export by `identities[0].provider` (`auth0` is the database connection) to find
them.

## 5. Configuration

| Auth0 | LumoAuth |
|---|---|
| Applications | OAuth clients: `lumo apps create` (with a secret), or `lumo api POST /clients` with `"isConfidential": false` for a single-page or native app. Client IDs are new |
| Database connection | The imported users |
| Social connections | Social login providers. The provider's own client ID and secret can be reused; add LumoAuth's callback URL at the provider |
| Enterprise connections (SAML, OIDC, AD/LDAP) | Enterprise SSO connections, created in the portal |
| Roles and permissions | Exported separately from users in Auth0. Recreate with `lumo permissions create` and `lumo roles create`; assign with `lumo users roles set <user-id> --roles <slug,...>` |
| Organizations | Customer organizations: `lumo api POST /organizations --data '{"name":"Acme Inc","slug":"acme-inc"}'`, then members with `POST /organizations/<organizationId>/members` and a body `{"userId":"<lumoauth user id>","roleId":<organization role id>}`. Read the role IDs from `GET /organizations/<organizationId>/roles` |
| Rules, Actions, Hooks | Application code or a webhook handler (`user.login`, `user.login_failed`, `user.created` and the other events). LumoAuth does not run custom code in the sign-in flow |
| Custom claims that a Rule or Action added | Read roles and permissions from LumoAuth's tokens or check permissions through the API; see the framework skill |
| Logs | Export them from Auth0 before it is retired. LumoAuth's audit log starts with the first event in LumoAuth |

## 6. Auth0-specific cut-over notes

- Auth0 sessions keep working at Auth0 until the user signs out or the application stops
  accepting them. The switch of the default provider decides when users come to LumoAuth.
- APIs that validate Auth0 access tokens must accept LumoAuth's issuer and audience next
  to Auth0's during the parallel run.
- A user ID in the form `auth0|...` or `google-oauth2|...` that the application stored is
  resolved through `auth0-mapping.csv`.

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `parse JSON array: ...`, `parse NDJSON line: ...` | The file is cut off or was edited | Export again |
| `empty file` | The export is empty | Check the export job |
| `– (no email)  (missing email)` | A user without an email | Not imported. Collect an email in the application |
| `– email  (already exists)` | The email is in the organization | Expected on a second run |
| `✗ email  HTTP 429 ...` | Rate limit | Lower `--concurrent`; run again |
| `✗ email  HTTP 403 ...` | Missing `admin:users:write`, or the key's creator lacks `users.create` | Fix the credential; run again |
| `--concurrent must be between 1 and 16` | Value out of range | Use 1 to 16 |
