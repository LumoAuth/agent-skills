# Repeat-safe user import loop

The import script for Clerk, Okta, Cognito, Firebase and any other source without an
importer. It was run against a stub of the `lumo` CLI that reproduces its exit codes and
JSON errors: a created user, an existing email (HTTP 409), one rate-limited request, an
invalid email, a record without an email, and a second run.

## Input format

One JSON object per line (`lumo-users.ndjson`). The provider files in this directory have
the `jq` filter that produces it.

```json
{"source_id":"user_2abc","picture":"https://img.example.com/jane.png","user":{"email":"jane@example.com","emailVerified":true,"name":"Jane Example","givenName":"Jane","familyName":"Example"}}
```

| Key | Content |
|---|---|
| `source_id` | The user's ID at the old provider. Written to the mapping |
| `picture` | Optional picture URL. Set with a user update after creation |
| `user` | The body for `POST /admin/users`. Fields that LumoAuth stores: `email` (required), `emailVerified`, `name`, `givenName`, `familyName`, `username`, `phoneNumber`, `isActive`, `roles` (role slugs), `groups` (group slugs) |

Do not put a `password` in `user`: the old password is not known, and a temporary
password that travels in a file is a risk. Users set a password themselves.

## `import-users.sh`

```bash
#!/usr/bin/env bash
# import-users.sh <users.ndjson>
# Creates one LumoAuth user per input line and records "source_id,lumoauth_user_id" in
# mapping.csv. Safe to run again: mapped users are skipped, existing emails are looked up.
# Needs the lumo CLI with a credential that has admin:users:read and admin:users:write.
set -euo pipefail

INPUT="${1:?usage: import-users.sh <users.ndjson>}"
MAPPING="${MAPPING:-mapping.csv}"
FAILED="${FAILED:-failed.ndjson}"
touch "$MAPPING"
: > "$FAILED"

created=0 existing=0 skipped=0 failed=0

while IFS= read -r row || [ -n "$row" ]; do
  [ -z "$row" ] && continue
  source_id=$(jq -r '.source_id' <<<"$row")
  email=$(jq -r '.user.email // empty' <<<"$row")
  picture=$(jq -r '.picture // empty' <<<"$row")
  # Drop empty fields so that the API applies its defaults.
  user=$(jq -c '.user | with_entries(select(.value != null and .value != ""))' <<<"$row")

  if [ -z "$email" ]; then
    jq -c '. + {error: "no email"}' <<<"$row" >> "$FAILED"
    failed=$((failed + 1))
    continue
  fi
  if awk -F, -v id="$source_id" '$1 == id { found = 1 } END { exit !found }' "$MAPPING"; then
    skipped=$((skipped + 1))
    continue
  fi

  attempt=0
  while :; do
    rc=0
    out=$(lumo api POST /users --data "$user" -o json 2>/dev/null) || rc=$?
    # Exit code 5 = rate limited: wait and send the same request again.
    if [ "$rc" -eq 5 ] && [ "$attempt" -lt 5 ]; then
      attempt=$((attempt + 1))
      sleep $((attempt * 5))
      continue
    fi
    break
  done

  if [ "$rc" -eq 0 ]; then
    id=$(jq -r '.data.id' <<<"$out")
    created=$((created + 1))
    if [ -n "$picture" ]; then
      lumo api PATCH "/users/$id" --data "$(jq -cn --arg p "$picture" '{picture: $p}')" -o json >/dev/null || true
    fi
  elif [ "$(jq -r '.status // empty' <<<"$out" 2>/dev/null)" = "409" ]; then
    # The email exists: the user was created on an earlier run, or signed up already.
    id=$(lumo users get "$email" -o json | jq -r '.data.id')
    existing=$((existing + 1))
  else
    message=$(jq -r '.message // "unknown error"' <<<"$out" 2>/dev/null || echo "unknown error")
    jq -c --arg error "$message" '. + {error: $error}' <<<"$row" >> "$FAILED"
    failed=$((failed + 1))
    continue
  fi
  printf '%s,%s\n' "$source_id" "$id" >> "$MAPPING"
done < "$INPUT"

echo "created=$created existing=$existing skipped=$skipped failed=$failed" >&2
[ "$failed" -eq 0 ]
```

What the script does for each line:

1. Skips a `source_id` that is already in `mapping.csv`.
2. Sends `lumo api POST /users`. On exit code 5 (rate limited) it waits and sends the
   same request again, up to five times.
3. On success, records the new user ID from `data.id`, and sets the picture.
4. On HTTP 409 (the email exists), looks the user up by email and records that ID.
5. On any other error, writes the line with an `error` field to `failed.ndjson` and
   continues.

It exits with status 1 when any line failed. Fix the cause, then run it again with the
same input: finished users are skipped.

## How to run it

1. Check the target: `lumo whoami -o json` must name the right organization. For a
   rehearsal, point `LUMO_ORG` or `--profile` at the test organization.
2. Show the user the command, the target organization and the number of users
   (`wc -l < lumo-users.ndjson`), and wait for approval.
3. Run a sample, check the result in the portal or with `lumo users get <email> -o json`,
   then run the full file after a second approval:

```bash
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson
bash import-users.sh lumo-users.ndjson
```

4. Keep `mapping.csv`. It is the only record of which old ID became which LumoAuth user.

Notes:

- The script is serial. That keeps it inside the rate limit of one credential for most
  imports. For a very large import, split the input into a few files and run one process
  per file, each with its own `MAPPING` and `FAILED` file name, and each with its own API
  key.
- `mapping.csv` assumes that old IDs contain no comma.
- An existing email is treated as "the same person". If the organization already had
  users before the migration, review those matches (`existing=` in the summary) with the
  user.
- The script changes nothing at the source provider.

## Assign roles and groups

Put role and group slugs into `user.roles` and `user.groups` in the `jq` filter when the
export holds them, or assign after the import from the mapping:

```bash
# roles.csv: old_id,role-slug[,role-slug...]
while IFS=, read -r old_id roles; do
  user_id=$(awk -F, -v id="$old_id" '$1 == id { print $2 }' mapping.csv)
  [ -n "$user_id" ] && lumo users roles set "$user_id" --roles "$roles" -o json >/dev/null
done < roles.csv
```

`lumo users roles set` replaces the user's roles with the given list. A user with a role
no longer gets the automatic link on a first social sign-in (see the linking rule in
`SKILL.md`).
