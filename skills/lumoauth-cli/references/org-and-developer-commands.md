# `lumo`: organization, settings, audit logs and developer commands

Command tables for `org`, `settings`, `logs`, `dev`, `tunnel`, `init`, `migrate`, `api`,
`completion`, `upgrade` and `version`. `config` and `profile` are in
`auth-and-output.md`. Add `-o json` to every command whose output you parse. Show the user
each command in a "changes" row before you run it.

## `org` (alias `organization`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo org get` | no | The organization profile and its settings |
| `lumo org update` | yes | `--name <new name>`, `--set key=value` (repeatable), `--data '<json>'` |

`--set` writes under `settings`, except `name`. Writable keys: `display_name`, `timezone`,
`locale`, `security.*`, `email.*`, `audit_log_retention_days`, `audit_log_auto_delete`,
`agent_governance.*`, `allow_root_admin_login`. A request with any other key, or with a key
that ends in `_hash`, `_secret`, `_token`, `_key` or `_password`, is refused with HTTP 400;
`details.rejected_keys` lists the keys and nothing is saved. Object values merge key by key.

```bash
lumo org get -o json
lumo org update --set timezone=Europe/Berlin --set locale=de -o json
lumo org update --set security.dpop_require_nonce=true -o json
lumo org update --data '{"settings":{"audit_log_retention_days":365}}' -o json
```

## `settings` (alias `setting`)

| Command | Changes | Purpose |
|---|---|---|
| `lumo settings get <area>` | no | Settings of one area |
| `lumo settings get all` | no | Every area in one document |
| `lumo settings update <area> --set key=value` | yes | Changes the given keys of one area |
| `lumo settings update <area> --data '<json>'` | yes | Sends a raw JSON object with the fields to change |

| Area | Content |
|---|---|
| `general` | Name, display name, time zone, locale |
| `authentication` (alias `auth`) | Password policy, sessions, passkeys. The MFA policy has its own command: `lumo mfa policy` |
| `security` | OAuth hardening switches, for example `dpop_require_nonce` |
| `email` | Sender name, sender address, provider |
| `branding` | Login page logo, colours, texts |
| `scim` | Provisioning policy: `allow_user_creation`, updates, deletion, `allow_group_operations`, `protected_attributes`, `deprovisioning_action` |
| `organization` (aliases `org`, `tenant`) | The organization profile; the same endpoint as `lumo org` |

Always `get` the area first and build the change from the key names in the response.
Do not guess a key name.

```bash
lumo settings get authentication -o json
lumo settings update authentication --set session_timeout=86400 --set password_min_length=12 -o json
lumo settings update scim --set allow_user_deletion=false --set deprovisioning_action=deactivate -o json
lumo settings update branding --data '{"primary_color":"#0f766e"}' -o json
```

### `--set key=value` syntax

Used by `org update` and `settings update`.

| Input | Sent as |
|---|---|
| `--set name=Acme` | `{"name": "Acme"}` |
| `--set security.dpop_require_nonce=true` | `{"security": {"dpop_require_nonce": true}}` (a dot nests) |
| `--set session_timeout=86400` | a number |
| `--set tags='["a","b"]'` | a JSON array (values that start with `{` or `[` are parsed as JSON) |
| `--set note=null` | `null` |
| `--set code=str:123` | the string `"123"` (the `str:` prefix forces a string) |

`true`, `false` and `null` become JSON literals, integers and decimals become numbers, and
everything else is a string. `--data` and `--set` can be combined; `--set` values are merged
over the `--data` object.

## `logs` (aliases `audit-logs`, `audit`): audit logs

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo logs list` | no | `--action <action>` (for example `user.created`), `--user <user-id>`, `--from <ISO 8601>`, `--to <ISO 8601>`, `--page`, `--limit` |
| `lumo logs get <log-id>` | no | |
| `lumo logs stats` | no | `--from`, `--to` |
| `lumo logs export` | no | `--from`, `--to`, `--export-format json\|csv` (default `json`). Prints the export on standard output as returned; redirect it to a file |

```bash
lumo logs list --action user.created --from 2026-11-01T00:00:00Z --limit 50 -o json
lumo logs export --from 2026-10-01T00:00:00Z --to 2026-10-31T23:59:59Z --export-format csv > audit-october.csv
```

An export can hold personal data. Write it to the location that the user names. For log
streaming to a SIEM and for retention, use `lumoauth-audit-compliance`.

## `dev`: sandbox organizations

A sandbox is a separate, isolated organization with its own slug, users, clients and
webhooks. It is deleted after its time to live. Availability depends on the organization's
plan (see https://docs.lumoauth.dev/pricing-matrix); without the feature, `lumo dev start`
answers `403 feature_not_in_plan`, and `list` and `stop` still work.

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo dev start` | yes | `--name <suffix>` (becomes part of the slug), `--ttl-hours <hours>` (default 24, at most 168) |
| `lumo dev list` (alias `ls`) | no | The caller's active sandboxes |
| `lumo dev stop <slug>` | yes | Deletes the sandbox. Only the user who created it can stop it; any other case answers 404 |

```bash
SLUG=$(lumo dev start --name pr-1234 -o json | jq -r '.data.slug')
lumo dev list -o json
lumo dev stop "$SLUG"
```

The sandbox is another organization. Address it with `--org "$SLUG"` or `LUMO_ORG`. A login
token is sent only to the organization that it was issued for, and an API key works only in
its own organization. To run commands in the sandbox, the user signs in to it under its own
profile:

```bash
lumo login --profile sandbox --org "$SLUG" --base-url https://app.lumoauth.dev
lumo users list --profile sandbox -o json
```

## `tunnel`: forward webhook events to a local URL

```bash
lumo tunnel --to http://localhost:3000/webhooks
lumo tunnel --to http://localhost:3000/webhooks --filter user.created --filter user.deleted
```

| Flag | Default | Purpose |
|---|---|---|
| `--to <url>` | `http://localhost:3000/webhooks` | Local URL that receives each event as a POST |
| `--filter <event>` | none | Forwards only this event name. Repeatable. The filter runs in the CLI |

The command registers a temporary webhook that is subscribed to every event, reads its
deliveries over a server-sent events stream, and posts each one to `--to`. It runs until
Ctrl+C, then removes the temporary webhook. Run it in the background or in a second terminal
and stop it when the test ends. If the process is killed without cleanup, a webhook with a
`tunnel://` URL stays in `lumo webhooks list`; delete it with `lumo webhooks delete <id>`.

A forwarded request differs from a production delivery:

| | Production delivery | `lumo tunnel` |
|---|---|---|
| Body | The envelope `{"event", "timestamp", "tenant", "data"}` | Only the event's `data` object |
| Headers | `X-LumoAuth-Event`, `X-LumoAuth-Timestamp`, `X-LumoAuth-Delivery`, `X-LumoAuth-Signature` | `X-LumoAuth-Event`, `X-LumoAuth-Delivery`, `Content-Type: application/json` |
| Signature | HMAC-SHA256 | none |

Use the `lumoauth-webhooks` skill for a receiver that handles both.

## `init`: scaffold a starter project

```bash
lumo init --framework next --dir ./my-app --org acme-corp --client-id <client-id>
```

| Flag | Purpose |
|---|---|
| `--framework <name>` | Required. `next`, `express`, `fastapi` or `go` |
| `--dir <path>` | Target directory, created when missing. Default: the current directory |
| `--org <slug>` | Organization slug for the environment file. Default: the active profile's organization |
| `--client-id <id>` | OAuth client ID for the environment file |
| `--force` | Overwrites existing files. Without it, existing files are skipped |

| Framework | Starter | Environment file | Next step that the command prints |
|---|---|---|---|
| `next` | Next.js (App Router) with `@lumoauth/nextjs` | `.env.local` | `npm install && npm run dev` |
| `express` | Express with `@lumoauth/express` | `.env` | `npm install && npm start` |
| `fastapi` | FastAPI with the `lumoauth` Python package | `.env` | `pip install -r requirements.txt`, then `uvicorn main:app --reload --port 3000` |
| `go` | Go (chi router) with `lumo-auth-go` | `.env` | `go mod tidy && go run .` |

The command writes files only; it changes nothing in the organization. The environment file
holds the organization slug, the base URL of the active profile (US when no profile exists)
and the client ID. The `express`, `fastapi` and `go` starters also get a generated
`SESSION_SECRET` and an empty `LUMO_CLIENT_SECRET` line that the user fills in. Without
`--client-id` the file holds a placeholder: set the client ID before the first sign-in. The
generated `.gitignore` is part of the starter; do not commit the environment file.

For which starter fits and what to do next, use `lumoauth-getting-started` and the
framework skill (`lumoauth-nextjs`, `lumoauth-express`, `lumoauth-fastapi`, `lumoauth-go`).

## `migrate`: import users from another identity provider

`lumo migrate auth0` is the only importer.

```bash
lumo migrate auth0 --file users.json --dry-run
lumo migrate auth0 --file users.json --limit 100 -o json
```

| Flag | Default | Purpose |
|---|---|---|
| `--file <path>` | required | Auth0 user export: a JSON array, or one JSON object per line |
| `--dry-run` | false | Parses the file and reports; sends nothing |
| `--limit <n>` | 0 (no limit) | Stops after `n` users |
| `--concurrent <n>` | 4 | Parallel requests, 1 to 16 |

The command creates one user per record through `POST /admin/users`, skips a user whose
email exists (HTTP 409), prints one line per user on standard error and, with `-o json`, a
summary `{"total", "created", "skipped", "failed", "dry_run"}` on standard output. It exits
with status 1 when any user failed. It does not import passwords. Use the `lumoauth-migrate`
skill for the whole process, including the other providers.

## `api`: raw endpoint access

```bash
lumo api <METHOD> <PATH> [--data '<json>'] [--query key=value ...] [--raw]
```

| Flag | Purpose |
|---|---|
| `-d, --data '<json>'` | JSON request body. Invalid JSON is rejected before the request |
| `-Q, --query key=value` | Query parameter. Repeatable |
| `--raw` | Treats the path as relative to the base URL |

Path resolution:

| Path | Request goes to |
|---|---|
| `/users` | `{base}/orgs/{org}/api/v1/admin/users` (Admin API) |
| `/admin/users` | the same |
| `/orgs/acme-corp/api/v1/me` | `{base}/orgs/acme-corp/api/v1/me` |
| `/api/v1/authz/check` | `{base}/api/v1/authz/check` |
| `/.well-known/...` | `{base}/.well-known/...` |
| `--raw /anything` | `{base}/anything` |

The exit code follows the HTTP status, as for every other command. An empty response prints
a success object. A `GET` needs no approval; show the user every `POST`, `PUT`, `PATCH` and
`DELETE` first. The request carries the CLI credential, so pass LumoAuth paths only.

```bash
lumo api GET /users --query search=jane --query limit=5 -o json
lumo api POST /roles --data '{"name":"Editor"}' -o json
lumo api GET /orgs/acme-corp/api/v1/.well-known/openid-configuration -o json
```

For the endpoints, bodies and error format, use `lumoauth-admin-api`.

## `completion`, `upgrade`, `version`

| Command | Purpose |
|---|---|
| `lumo completion bash\|zsh\|fish\|powershell` | Prints a shell completion script. Homebrew installs completions itself |
| `lumo upgrade --check` | Reports whether a newer release exists. Changes nothing |
| `lumo upgrade` | Detects the install channel (Homebrew, Scoop, winget or a manual install) and upgrades through it. Asks for confirmation |
| `lumo upgrade --exec` | Upgrades without the confirmation prompt |
| `lumo version` | Version, commit, build date |
| `lumo --version` | One-line version |

```bash
source <(lumo completion bash)
lumo completion zsh > "${fpath[1]}/_lumo"
lumo completion fish > ~/.config/fish/completions/lumo.fish
```

Run `lumo upgrade` only when the user asks for it: it replaces the installed binary.
