# `lumo`: credentials, profiles, scopes and output

Open this file when a command fails with exit code 2, when the wrong organization answers,
or when a script must parse `lumo` output.

## Global flags

These flags work on every command.

| Flag | Purpose |
|---|---|
| `--org <slug>` | Organization slug. Overrides `LUMO_ORG` and the active profile |
| `--base-url <url>` | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Overrides `LUMO_BASE_URL` |
| `--api-key <key>` | Organization API key (`lmk_...`). Overrides `LUMO_API_KEY`. Prefer the environment variable: a flag value is visible in the process list and the shell history |
| `--profile <name>` | Named credentials profile. Overrides `LUMO_PROFILE` and the current profile |
| `-o, --output <format>` | `table`, `json` or `yaml` |
| `-q, --quiet` | Suppresses success messages and notes |
| `-v, --verbose` | Verbose output |

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `LUMO_API_KEY` | Organization API key (`lmk_...`) | none |
| `LUMO_ORG` | Organization slug (`LUMO_ORG_ID` is still read) | the active profile's organization |
| `LUMO_BASE_URL` | Region base URL | `https://app.lumoauth.dev` |
| `LUMO_PROFILE` | Named credentials profile | `current_profile` in `credentials.yaml` |
| `LUMO_OUTPUT_FORMAT` | Output format when `-o` is absent | table |
| `LUMO_CONFIG_DIR` | Directory of the config and credentials files | `~/.lumoauth` |
| `LUMO_MCP_CLIENT_SECRET` | Client secret for `lumo mcp check-tool` | none |

These names belong to the CLI. The SDKs read other names (`LUMOAUTH_URL`,
`LUMOAUTH_ORG_ID`, `LUMOAUTH_API_KEY`).

## Two credentials

| | `lumo login` token | API key |
|---|---|---|
| For | A person at a terminal | Scripts, CI, an agent without a browser |
| Obtained | `lumo login --org <slug> --base-url <url>`; a person approves in a browser | Portal: `/orgs/{orgId}/portal/settings/api-keys`, shown once |
| Scopes | What `--scope` requested. Default `openid profile email admin` | The scopes selected when the key was created. No blanket scope exists for keys |
| Stored | `~/.lumoauth/credentials.yaml` (the CLI writes it) | Environment variable, or `lumo config set api_key <key>` in `~/.lumoauth/config.yaml` |
| Ends | `lumo logout`; the CLI refreshes an expired access token while the stored refresh token is valid | Revoke or rotate the key in the portal |

Both are sent on every request. The server sets no session cookie.

### `lumo login` flags

| Flag | Purpose |
|---|---|
| `--org <slug>` | Organization slug. Prompted when absent |
| `--base-url <url>` | Region base URL. When the flag, `LUMO_BASE_URL` and `base_url` in the config file are all absent, the command prompts for a region |
| `--scope <list>` | Scopes to request, comma-separated or repeated. Default `openid,profile,email,admin` |
| `--no-browser` | Does not open the verification URL; prints it for a person to open |
| `--profile <name>` | (global flag) Stores the session under this profile and makes it the current profile |

The device flow needs a person: the command prints a verification URL and a user code and
polls until the request is approved or expires. An agent cannot complete it alone.

The first sign-in to an organization uses the first-party OAuth client `lumoauth-cli`. An
administrator can narrow the scopes that this client allows. A request for a scope outside
that list fails with `invalid_scope`.

### `lumo whoami -o json`

```json
{
  "profile": "default",
  "org": "acme-corp",
  "base_url": "https://app.lumoauth.dev",
  "tls_verify": true,
  "auth": "token",
  "expires_at": "2026-11-10T12:00:00Z",
  "user": "admin@example.com",
  "scopes": ["openid", "profile", "email", "admin"],
  "admin_api": true
}
```

`auth` is `token`, `api-key`, `expired` or `none`. With `api-key` the output has a masked
`api_key` field and no `scopes`: the server checks key scopes per request. The command exits
with status 2 when `auth` is `expired` or `none`.

### `lumo doctor -o json`

```json
{
  "ok": true,
  "version": "1.4.0",
  "checks": [
    { "name": "profile", "status": "ok", "detail": "default (/home/dev/.lumoauth/credentials.yaml)" },
    { "name": "organization", "status": "ok", "detail": "acme-corp" },
    { "name": "server", "status": "ok", "detail": "https://app.lumoauth.dev" },
    { "name": "credential", "status": "ok", "detail": "API key lmk_abcd…wxyz (scopes enforced per resource)" },
    { "name": "discovery", "status": "ok", "detail": "issuer <issuer URL of the organization>" },
    { "name": "admin api", "status": "ok", "detail": "GET /admin/organization succeeded" }
  ]
}
```

`status` is `ok`, `warn`, `fail` or `skip`. A failed check carries a `hint`. Check names:
`config`, `profile`, `organization`, `server`, `credential`, `scopes` (login tokens only),
`discovery`, `admin api`, `note`. The Admin API check calls `GET /admin/organization`, so an
API key needs `admin:settings:read` to pass it. A key without that scope can still be valid
for its own resources. The version value above is an example.

## Which value wins

Organization, base URL and output format:

1. Command-line flag
2. Environment variable
3. `~/.lumoauth/config.yaml`
4. The active profile in `~/.lumoauth/credentials.yaml`

Profile: `--profile`, then `LUMO_PROFILE`, then `current_profile`.

Credential, chosen separately:

1. The active profile's login token, when it is valid and belongs to the organization that
   the command addresses.
2. Otherwise the API key (`--api-key`, `LUMO_API_KEY`, or `api_key` in the config file).
3. Otherwise the command exits with status 2.

Consequence: `lumo --org other-org users list` with a token for `acme-corp` falls back to
the API key, and fails when no key is set. An API key works only in the organization that
it belongs to.

## Profiles

Use profiles when the user works with more than one organization or region.

| Command | Purpose |
|---|---|
| `lumo login --profile acme --org acme-corp --base-url https://app.lumoauth.dev` | Signs in and stores the session as profile `acme` |
| `lumo profile list` (alias `ls`) | Lists profiles; `-o json` returns `{"data": [...], "current_profile": "..."}` |
| `lumo profile show [name]` | Shows one profile; tokens are not printed |
| `lumo profile use <name>` | Sets the current profile |
| `lumo profile create <name> --org <slug> --base-url <url> [--use]` | Creates a profile without tokens, for use with an API key |
| `lumo profile delete <name> [-f]` (aliases `rm`, `remove`) | Deletes the profile and its tokens. Asks on a terminal unless `-f` is passed |
| `lumo users list --profile clientb` | Runs one command against another profile |
| `lumo logout` | Clears the active profile only |

## Config commands

| Command | Purpose |
|---|---|
| `lumo config show` | Prints the effective values; the API key is masked |
| `lumo config set <key> <value>` | Keys: `org_id`, `api_key`, `base_url`, `format`, `insecure` |
| `lumo config init` | Interactive wizard. Do not run it from an agent; use `config set` |

For output, pass `-o json` or set `LUMO_OUTPUT_FORMAT`. Do not depend on the `format` key
of the config file for parsing.

## Scope that each command needs

An API key needs the scope in the table. A login token needs the same scope or the blanket
`admin` scope. Scopes are checked per resource: a scope for one resource never opens another,
and a `:read` scope never allows a write. On top of the scope, the signed-in user (or, for a
key, the person who created it) must hold the permission that the endpoint requires; a 403
names it in `details.required_permissions`.

| Commands | Scope |
|---|---|
| `users list`, `users get`, `users roles get`, `users groups get`, `users authenticators list`, `users identities list`, `identities legacy-saml` (report), `mfa coverage` | `admin:users:read` |
| `users create`, `update`, `delete`, `block`, `unblock`, `set-password`, `roles set`, `groups set`, `authenticators remove`, `tap`, `identities link`, `identities unlink`, `identities legacy-saml --relink` | `admin:users:write` |
| `roles list`, `roles get` | `admin:roles:read` |
| `roles create`, `update`, `delete` | `admin:roles:write` |
| `permissions list`, `permissions get` | `admin:permissions:read` |
| `permissions create`, `update`, `delete` | `admin:permissions:write` |
| `groups list`, `get`, `members list` | `admin:groups:read` |
| `groups create`, `update`, `delete`, `members add` | `admin:groups:write` |
| `apps list`, `apps get` | `admin:clients:read` |
| `apps create`, `update`, `delete`, `rotate-secret` | `admin:clients:write` |
| `agents list`, `agents get`, `mcp servers` | `admin:agents:read` |
| `agents create`, `update`, `delete`, `enable`, `disable`, `rotate-credentials`, `token`; `mcp test` (it mints a token) | `admin:agents:write` (plus `admin:agents:read` for `mcp test`) |
| `mcp discovery` | none; the document is public |
| `mcp check-tool` | none from the CLI credential; it uses the MCP server's own client credentials |
| `webhooks list`, `get`, `deliveries list`, `deliveries get` | `admin:webhooks:read` |
| `webhooks create`, `update`, `delete`, `deliveries replay`; `tunnel` | `admin:webhooks:write` (`tunnel` also reads the stream: `admin:webhooks:read`) |
| `sessions list`, `tokens list` | `admin:sessions:read` |
| `sessions revoke`, `sessions revoke-all`, `tokens revoke` | `admin:sessions:write` |
| `logs list`, `get`, `stats`, `export` | `admin:audit:read` |
| `settings get`, `org get`, `mfa policy get`, `dev list` | `admin:settings:read` |
| `settings update`, `org update`, `mfa policy set`, `dev start`, `dev stop` | `admin:settings:write` |
| `social list`, `social get` | `admin:social:read` |
| `social create`, `social delete` | `admin:social:write` |
| `migrate auth0` | `admin:users:write` |

A job that both reads and changes a resource needs the `:read` and the `:write` scope.
Create one key per job, with only the scopes of the commands that the job runs.

## Output contract

| Format | How to select | Content |
|---|---|---|
| JSON | `-o json` or `LUMO_OUTPUT_FORMAT=json` | The API response body as returned, or a small status object |
| YAML | `-o yaml` | The same data as YAML |
| Table | no `-o` | Text for people. Do not parse it |

With `-o json`:

- A resource command prints the Admin API response. A list is `{"data": [...], "meta":
  {...}}`. A single resource is `{"data": {...}}` in most cases; some carry a `message`.
- A command whose response is empty prints `{"status": "success", "message": "..."}`.
- A failure prints `{"error": true, "message": "...", "hint": "...", "status": 403, "code":
  "forbidden", "details": {...}}` on standard output and exits with a non-zero status.
  `hint`, `status`, `code` and `details` are present only when they apply.
- Progress lines and notes go to standard error. Keep the two streams apart:
  `lumo users list -o json 2>/dev/null | jq '.data[].email'`.

Exit codes: `0` success, `1` general failure, `2` authentication or authorization (401,
403, or no credential), `3` not found (404), `4` invalid input (400, 409, 422), `5` rate
limited (429).

Commands with their own exit rule:

| Command | Exit status |
|---|---|
| `lumo doctor` | 1 when any check fails |
| `lumo whoami` | 2 when the credential is expired or absent |
| `lumo mcp check-tool` | 1 when the tool call is denied |
| `lumo migrate auth0` | 1 when any user failed |
| `lumo upgrade --check` | 2 when the release check could not run |

## Commands that prompt

A script or an agent must avoid a prompt.

| Command | Prompt | How to avoid it |
|---|---|---|
| `lumo login` | Organization slug, region | Pass `--org` and `--base-url` |
| `lumo config init` | Every value | Use `lumo config set` |
| `lumo users authenticators remove` | Confirmation | `--yes`; without a terminal the command refuses to run without it |
| `lumo users identities unlink` | Confirmation | `--yes`; same rule |
| `lumo identities legacy-saml --relink` | Confirmation | `--dry-run` first, then `--yes` |
| `lumo profile delete` | Confirmation on a terminal | `-f` |
| `lumo upgrade` | Confirmation | `--check` to report only, `--exec` to upgrade without a prompt |

Pass `--yes`, `-f` or `--exec` only after the user approved the exact command.

## Error codes with a fixed meaning

| `code` | Meaning | Next step |
|---|---|---|
| `forbidden` with `details.required_scopes` | The credential lacks a scope | New key with that scope, or `lumo login --scope ...` |
| `forbidden` with `details.required_permissions` | The user or the key's creator lacks a permission | An administrator grants it |
| `step_up_required` | The action needs a fresh MFA check of the caller | Pass an approved step-up challenge ID with `--mfa-challenge`, or use an API key |
| `mfa_reset_removed` | `users mfa-reset` no longer exists | `users tap`, or `users authenticators remove` |
| `identity_conflict` | The identity belongs to another user, or the user has another federated source | `users identities list`, then unlink the conflict |
| `directory_lookup_failed` | The LDAP entry was not found by email or username | Pass `--dn` |
| `last_factor_required` | The authenticator is the user's last sign-in method | `users tap` first, so that the user can enroll a replacement |
| `feature_not_in_plan`, `plan_limit_reached` | The plan does not include the feature, or a limit is reached | See https://docs.lumoauth.dev/pricing-matrix |
| `invalid_request` with `details.rejected_keys` | `org update` or `settings update organization` sent a key that is not writable | Remove the listed keys; nothing was saved |
