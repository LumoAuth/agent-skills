---
name: lumoauth-cli
description: >-
  Manages a LumoAuth organization from a terminal with the `lumo` command line (LumoAuth CLI).
  Covers install (Homebrew, Scoop, winget, install script), authentication (`lumo login` device
  flow, API key with LUMO_API_KEY and LUMO_ORG, profiles, least-privilege scopes), `lumo doctor`
  and `lumo whoami`, JSON output and exit codes for scripts and AI agents, and every command
  group: users, roles, permissions, groups, apps (OAuth clients), agents, mcp, webhooks and
  deliveries, sessions, tokens, settings, social, mfa, logs (audit logs), org, identities, dev
  (sandbox organizations), tunnel, init, migrate, api (raw endpoint access), config, profile,
  completion, upgrade. Use when the user asks to list, create, change or delete LumoAuth users,
  roles, OAuth applications, AI agents, webhooks or settings from a shell, a script or a CI
  job, to "use the lumo CLI", to fix a `lumo` 401 or 403 error, or to call an Admin API
  endpoint with `lumo api`.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth CLI (`lumo`)

Use the `lumo` command line to read and change one LumoAuth organization at a time: users,
roles, groups, permissions, OAuth applications, AI agents, MCP servers, webhooks, audit logs,
sessions and settings. Every resource command is a thin wrapper around the Admin API
(`{base}/orgs/{orgId}/api/v1/admin/...`), and `lumo api` reaches any endpoint that has no
dedicated command.

## When to use

- The user wants to inspect or change the organization from a terminal, a script or a CI job.
- A task in another skill needs a value from the organization (a client ID, a role slug, a
  webhook ID) and a shell is available.
- A `lumo` command fails with an authentication or permission error.

Do not use this skill for:

- Code that calls the Admin API over HTTP or through a generated API client: use
  `lumoauth-admin-api`.
- A webhook receiver (signature verification, retries): use `lumoauth-webhooks`.
- A move from Auth0, Clerk, Okta, Cognito or Firebase Auth: use `lumoauth-migrate`.
- A choice of SDK or a first project: use `lumoauth-getting-started`.
- Changes that the agent makes itself with tool calls, when the LumoAuth MCP server is
  connected to the agent: use `lumoauth-mcp-management`.

## Before you start

You need three values. Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Organization slug (`acme-corp`) | The portal URL `/orgs/{orgId}/portal/...`, or `lumo whoami -o json` when the user is already signed in |
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask the user which one |
| A credential | A `lumo login` session that a person approves in a browser, or an API key (`lmk_...`) created in the portal at `/orgs/{orgId}/portal/settings/api-keys` |

Rules for the whole session:

- **Show before you change.** Before you run a command that creates, changes or deletes
  something in the organization, show the user the exact command and wait for approval. This
  covers `create`, `update`, `delete`, `set`, `block`, `unblock`, `enable`, `disable`,
  `revoke`, `rotate-*`, `remove`, `link`, `unlink`, `tap`, `token`, `replay`, `dev start`,
  `dev stop`, `migrate`, and `lumo api` with `POST`, `PUT`, `PATCH` or `DELETE`. Read commands
  (`list`, `get`, `whoami`, `doctor`, `stats`, `coverage`) need no approval.
- **Pass `-o json` on every command whose output you parse.** Without `-o` the output is a
  table for people. Do not rely on automatic detection of a pipe.
- **Keep secrets out of the conversation and out of logs.** Read the API key from the
  environment. Commands that print a credential once (`agents create`,
  `agents rotate-credentials`, `agents token`, `apps rotate-secret`, `webhooks create`,
  `users tap`) must write it to a secret store or a file that the user chose, not to a log.

## Steps

### 1. Install

Check first: `lumo --version`. If the command is missing, show the user the install command
for the platform and run it after approval.

```bash
# macOS or Linux (Homebrew)
brew install lumoauth/tap/lumo

# Linux, macOS or WSL (install script; installs to ~/.local/bin, no sudo)
curl -fsSL https://raw.githubusercontent.com/LumoAuth/cli/main/install.sh | sh
```

```powershell
# Windows (Scoop)
scoop bucket add lumoauth https://github.com/lumoauth/scoop-bucket
scoop install lumo

# Windows (winget)
winget install --id LumoAuth.lumo
```

After the install script, restart the shell so that `~/.local/bin` is on `PATH`.

### 2. Authenticate

Choose one credential.

**API key (scripts, CI, and an agent without a browser).** The user creates the key in the
portal and selects only the scopes that the job needs. Export it in the shell; do not write
it into a file in the repository.

```bash
export LUMO_API_KEY="lmk_..."          # the user supplies the value
export LUMO_ORG="acme-corp"
export LUMO_BASE_URL="https://app.lumoauth.dev"   # EU: https://eu.app.lumoauth.dev
```

**Browser sign-in (a person at the keyboard).** `lumo login` starts the OAuth 2.0 device
flow, prints a verification URL and a user code, and waits until a person approves the
request in a browser. Pass `--org` and `--base-url`; without them the command prompts on
standard input.

```bash
lumo login --org acme-corp --base-url https://app.lumoauth.dev
```

In a session without a browser, add `--no-browser` and give the printed URL and user code to
the user. The command stores the tokens in `~/.lumoauth/credentials.yaml`.

By default the login requests `openid profile email admin`. `admin` is the blanket Admin API
scope. For a least-privilege session, request resource scopes instead:

```bash
lumo login --org acme-corp --base-url https://app.lumoauth.dev \
  --scope openid,admin:users:read,admin:audit:read
```

When both credentials exist, a valid login token for the addressed organization is sent and
the API key is not. Read [references/auth-and-output.md](references/auth-and-output.md) for
the precedence rules, profiles, the scope that each command needs, and the config files.

### 3. Check the connection first

Run both commands before any other work, and again after any 401 or 403.

```bash
lumo whoami -o json    # which profile, organization, base URL and credential will be used
lumo doctor -o json    # checks the credential, scopes, server and Admin API reach
```

`lumo doctor -o json` prints `{"ok": true|false, "checks": [...], "version": "..."}` and
exits with status 1 when a check fails. Each failed check has a `hint` with the fix. If
`ok` is `false`, stop and apply the hint (or show it to the user) before you continue.

Confirm that `org` and `base_url` in the `whoami` output are the organization that the user
named. A command sent to the wrong organization is the most expensive mistake with this tool.

### 4. Read, then change

Every resource command has the form `lumo <group> <verb> [id] [flags]`. Read the current
state, show the planned change, run it after approval, then read again.

```bash
# Read
lumo users list --search jane -o json
lumo roles list -o json

# Change (show the command to the user first)
lumo roles create --name "Editor" --permissions document.edit,document.view -o json
lumo users roles set 0192a3f4-0000-7000-8000-000000000000 --roles editor -o json

# Verify
lumo users roles get 0192a3f4-0000-7000-8000-000000000000 -o json
```

List commands return the Admin API envelope: `{"data": [...], "meta": {"total", "page",
"limit", "totalPages", "hasNextPage", "hasPreviousPage"}}`. Page with `--page` and `--limit`
until `meta.hasNextPage` is `false`.

### 5. Handle results by exit code

| Exit code | Meaning | What to do |
|---|---|---|
| 0 | Success | Continue |
| 1 | General failure (also: a failed `doctor` check, a denied `mcp check-tool`, a failed row in `migrate auth0`) | Read the message |
| 2 | Not authenticated or not authorized (HTTP 401 or 403) | Run `lumo doctor -o json`; read `hint` |
| 3 | Not found (HTTP 404) | Check the ID and the organization |
| 4 | Invalid input (HTTP 400, 409 or 422) | Fix the flags or the body; 409 means that the resource exists |
| 5 | Rate limited (HTTP 429) | Wait, then retry with a growing delay |

With `-o json`, a failure is printed on standard output as:

```json
{
  "error": true,
  "message": "Insufficient scope: this API key is missing a required scope (HTTP 403 forbidden)",
  "hint": "This API key lacks the scope(s) admin:users:write ...",
  "status": 403,
  "code": "forbidden",
  "details": { "required_scopes": ["admin:users:write"] }
}
```

Check the exit code first, then parse the JSON. On a 403, `hint` names the missing scope and
how to get it. Do not retry a 401, 403 or 404 without a change.

### 6. Reach endpoints that have no command

```bash
lumo api GET /users --query search=jane --query limit=5 -o json
lumo api POST /webhooks/42/rotate-secret -o json
lumo api PATCH /organization --data '{"settings":{"timezone":"Europe/Berlin"}}' -o json
```

A path such as `/users` is relative to the Admin API of the active organization. A path that
starts with `/orgs/`, `/api/` or `/.well-known/` is sent as given, relative to the base URL.
Pass only LumoAuth paths: the command attaches the credential to the request.

## Command map

| Group | Verbs |
|---|---|
| `login`, `logout`, `whoami`, `doctor` | session and diagnosis |
| `users` | `list`, `get`, `create`, `update`, `delete`, `block`, `unblock`, `set-password`, `roles get\|set`, `groups get\|set`, `authenticators list\|remove`, `tap`, `identities list\|link\|unlink` |
| `roles` | `list`, `get`, `create`, `update`, `delete` |
| `permissions` | `list`, `get`, `create`, `update`, `delete` |
| `groups` | `list`, `get`, `create`, `update`, `delete`, `members list\|add\|remove` |
| `apps` (OAuth clients) | `list`, `get`, `create`, `update`, `delete`, `rotate-secret` |
| `agents` | `list`, `get`, `create`, `update`, `delete`, `enable`, `disable`, `rotate-credentials`, `token` |
| `mcp` | `servers`, `discovery`, `test`, `check-tool` |
| `webhooks` | `list`, `get`, `create`, `update`, `delete`, `deliveries list\|get\|replay` |
| `sessions` | `list`, `revoke`, `revoke-all` |
| `tokens` | `list`, `revoke` |
| `settings` | `get <area>`, `update <area>` (areas: `general`, `authentication`, `security`, `email`, `branding`, `scim`, `organization`; `get all`) |
| `org` | `get`, `update` |
| `social` | `list`, `get`, `create`, `delete` |
| `mfa` | `policy get`, `policy set`, `coverage` |
| `logs` (audit logs) | `list`, `get`, `stats`, `export` |
| `identities` | `legacy-saml` |
| `dev` (sandbox organizations) | `start`, `list`, `stop` |
| `tunnel` | forwards webhook events to a local URL |
| `init` | scaffolds a starter project (`next`, `express`, `fastapi`, `go`) |
| `migrate` | `auth0` |
| `api` | `lumo api <METHOD> <PATH>` |
| `config` | `init`, `show`, `set` |
| `profile` | `list`, `use`, `create`, `delete`, `show` |
| `completion`, `upgrade`, `version` | shell completion, self-upgrade, build information |

Open the reference file for the group before you write a command with flags:

- [references/identity-commands.md](references/identity-commands.md): `users` and its
  sub-commands, `roles`, `permissions`, `groups`, `sessions`, `tokens`, `mfa`, `identities`.
- [references/apps-agents-webhooks-commands.md](references/apps-agents-webhooks-commands.md):
  `apps`, `agents`, `mcp`, `webhooks`, `social`.
- [references/org-and-developer-commands.md](references/org-and-developer-commands.md):
  `org`, `settings` and the `--set` syntax, `logs`, `dev`, `tunnel`, `init`, `migrate`,
  `api`, `completion`, `upgrade`.
- [references/auth-and-output.md](references/auth-and-output.md): `login`, `whoami`,
  `doctor`, `config`, `profile`, the scope that each command needs, the JSON contract.

`lumo <group> --help` and `lumo <group> <verb> --help` print the flags of the installed
version. When this skill and `--help` disagree, follow `--help`.

## Verify

1. `lumo doctor -o json` prints `"ok": true` and exits with status 0.
2. `lumo whoami -o json` names the organization and base URL that the user gave.
3. After a change, the matching `get` or `list` command returns the new state.
4. `lumo logs list --limit 5 -o json` shows the audit entry for the change (needs
   `admin:audit:read`).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Output is a table and `jq` fails | No `-o json` | Add `-o json`, or export `LUMO_OUTPUT_FORMAT=json` |
| `lumo login` waits on a prompt | No `--org` or no base URL | Pass `--org` and `--base-url`, or set `LUMO_BASE_URL` |
| Exit code 2, `not authenticated` | No login token and no API key | Run `lumo login`, or export `LUMO_API_KEY` |
| 403 right after `lumo login` | The token has no admin scope: `--scope` was narrowed, or an administrator narrowed the scopes of the `lumoauth-cli` client | Read `hint`; sign in again with the named scope, or use an API key |
| `invalid_scope` on `lumo login` | The organization's CLI client does not allow a requested scope | Narrow `--scope`, or an administrator allows the scope under Applications, LumoAuth CLI |
| 403 with a key that can `list` | The key holds a `:read` scope only | Create a key that also holds the `:write` scope for that resource |
| 403 with `required_permissions` in `details` | The signed-in user, or the person who created the API key, does not hold that permission | An administrator grants the permission, or creates the key |
| A command runs against the wrong organization | A stored profile, `LUMO_ORG` or the config file selects another organization | Check `lumo whoami -o json`; pass `--org`, or `lumo profile use <name>` |
| The API key in `LUMO_API_KEY` is ignored | A valid login token exists for the same organization and is sent first | `lumo logout`, or select a profile that has no token |
| 404 from `lumo api` | The path was resolved against the Admin API | Start the path with `/orgs/<slug>/api/v1/...` for a route outside the Admin API, or pass `--raw` |
| `refusing to remove ... without confirmation` | A destructive command ran without a terminal | Add `--yes` after the user approved the command |
| `step_up_required` on `users tap` or `users identities link` | With a login token, the server requires a fresh MFA check of the caller | Pass the ID of an approved step-up challenge with `--mfa-challenge`, or use an API key |
| `403 feature_not_in_plan` on `lumo dev start` | The plan does not include sandbox organizations | Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix) |

## Related skills

- `lumoauth-mcp-management`: the same resources as tool calls of the LumoAuth MCP server.
- `lumoauth-admin-api`: the HTTP API behind these commands, API keys and scopes, the
  generated API clients, configuration as code in CI.
- `lumoauth-webhooks`: verify and process the events that `lumo webhooks` subscribes to.
- `lumoauth-migrate`: the full process around `lumo migrate auth0`.
- `lumoauth-getting-started`: organizations, credentials, and the starters that `lumo init`
  writes.
- `lumoauth-users-sessions`, `lumoauth-rbac`, `lumoauth-agent-identity`,
  `lumoauth-mcp-server`: what the users, roles, agents and MCP servers that these commands
  manage are for.

## References

- [references/auth-and-output.md](references/auth-and-output.md): open when a credential,
  a profile, a scope or the output format is the problem.
- [references/identity-commands.md](references/identity-commands.md)
- [references/apps-agents-webhooks-commands.md](references/apps-agents-webhooks-commands.md)
- [references/org-and-developer-commands.md](references/org-and-developer-commands.md)
- https://docs.lumoauth.dev/cli/ (overview), https://docs.lumoauth.dev/cli/install,
  https://docs.lumoauth.dev/cli/login, https://docs.lumoauth.dev/cli/auth,
  https://docs.lumoauth.dev/cli/doctor, https://docs.lumoauth.dev/cli/dev,
  https://docs.lumoauth.dev/cli/tunnel, https://docs.lumoauth.dev/cli/init,
  https://docs.lumoauth.dev/cli/identities, https://docs.lumoauth.dev/cli/migrate
- https://docs.lumoauth.dev/api-reference/authentication (scopes and permissions per endpoint)
