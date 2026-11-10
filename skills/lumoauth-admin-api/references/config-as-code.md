# Configuration as code for LumoAuth

Open this file to keep an organization's configuration in a repository and apply it from a
pipeline.

LumoAuth has no Terraform provider, no Kubernetes operator and no custom resource
definitions. The supported route is a script in the repository that calls the Admin API
with an organization API key: through the `lumo` CLI for the resources that it covers, and
through `lumo api` or HTTP for the rest.

## What the pipeline needs

| Item | Where |
|---|---|
| `LUMO_BASE_URL` | `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev`. Plain variable |
| `LUMO_ORG` | Organization slug. Plain variable |
| `LUMO_API_KEY` | Secret of the CI system. An admin creates the key in the portal (`/orgs/{orgId}/portal/settings/api-keys`) with an expiration |
| The `lumo` CLI and `jq` | Installed in the job |

Scopes for a pipeline that manages permissions, roles, applications, webhooks and agents:

| Resource | Scopes |
|---|---|
| Permissions | `admin:permissions:read`, `admin:permissions:write` |
| Roles | `admin:roles:read`, `admin:roles:write` |
| Groups | `admin:groups:read`, `admin:groups:write` |
| Applications (OAuth clients) | `admin:clients:read`, `admin:clients:write` |
| Webhooks | `admin:webhooks:read`, `admin:webhooks:write` |
| Agents, MCP servers | `admin:agents:read`, `admin:agents:write` |
| Organization settings | `admin:settings:read`, `admin:settings:write` |
| `lumo doctor` as a first step | `admin:settings:read` (its Admin API check reads the organization) |

Select only the rows that the script touches. The admin who creates the key must hold the
matching permissions (for example `roles.create`, `roles.edit`, `roles.assign-permissions`),
and the key stops working for an endpoint when that admin loses the permission or is
deactivated. Plan a key owner that stays in the organization, and rotate the key on a
schedule.

Use a separate organization, or a sandbox organization where the plan includes it, to test
the script before it runs against production.

## The script

Structure the script as "ensure" functions: look up by slug or name, create when missing,
update when present. The file in `SKILL.md` (`lumoauth/apply.sh`) shows permissions and
roles. The same pattern for the other resources:

```bash
#!/usr/bin/env bash
# lumoauth/apply-apps.sh: applications and webhooks. Needs LUMO_BASE_URL, LUMO_ORG, LUMO_API_KEY.
set -euo pipefail

# Applications have no slug. Find one by its exact name.
client_id_by_name() { # prints the clientId, or nothing
  lumo apps list --search "$1" --limit 100 -o json \
    | jq -r --arg name "$1" '.data[] | select(.name == $name) | .clientId' | head -n 1
}

ensure_app() { # ensure_app <name> <redirect-uris>
  local client_id
  client_id=$(client_id_by_name "$1")
  if [ -n "$client_id" ]; then
    lumo apps update "$client_id" --redirect-uris "$2" -o json >/dev/null
    echo "updated application $1 ($client_id)" >&2
  else
    # The response holds the client secret once. Hand it to the secret store here.
    lumo apps create --name "$1" --redirect-uris "$2" -o json \
      | jq -r '.data | "LUMOAUTH_CLIENT_ID=\(.clientId)\nLUMOAUTH_CLIENT_SECRET=\(.secret)"' \
      > "${SECRETS_OUT:?set SECRETS_OUT to a file that the next step uploads and deletes}"
    echo "created application $1" >&2
  fi
}

# Webhooks have no name. Find one by its URL.
webhook_id_by_url() {
  lumo webhooks list -o json | jq -r --arg url "$1" '.data[] | select(.url == $url) | .id' | head -n 1
}

ensure_webhook() { # ensure_webhook <url> <events>
  local id
  id=$(webhook_id_by_url "$1")
  if [ -n "$id" ]; then
    lumo webhooks update "$id" --events "$2" -o json >/dev/null
  else
    lumo webhooks create --url "$1" --events "$2" -o json \
      | jq -r '.data | "LUMOAUTH_WEBHOOK_SECRET=\(.secret)"' >> "${SECRETS_OUT:?}"
  fi
}

ensure_app "Customer portal" "https://app.example.com/callback"
ensure_webhook "https://app.example.com/webhooks/lumoauth" "user.created,user.deleted"
```

Rules for such a script:

- `set -euo pipefail`, and `-o json` on every `lumo` command.
- Never `echo` a response of a create or rotate command into the job log.
- A lookup by name or URL must match exactly. `--search` is a text search, so filter the
  result with `jq` as above.
- `lumo webhooks list` returns one page. With more webhooks than one page holds, page with
  `--page` until `meta.hasNextPage` is `false`.
- Deletions are not implied. A resource that is removed from the script stays in the
  organization. Delete on purpose, with a reviewed command.
- The script describes what it manages. It does not detect changes that someone made in
  the portal to other resources.

## Values that are returned once

| Value | Returned by | In the response |
|---|---|---|
| Client secret of an application | `lumo apps create`, `lumo apps rotate-secret` | `data.secret` on create |
| Agent API key or client secret | `lumo agents create`, `lumo agents rotate-credentials` | in `data`; read the response of the installed version |
| Webhook signing secret | `lumo webhooks create`, `POST /admin/webhooks/{id}/rotate-secret` | `data.secret` |

Write each one to the secret store in the step that creates it. A lost value cannot be read
back; rotate it. Mask it in the CI system when the system supports that (in GitHub Actions:
`echo "::add-mask::$VALUE"` before any use).

## GitHub Actions

```yaml
name: lumoauth-config
on:
  push:
    branches: [main]
    paths: ["lumoauth/**"]
  workflow_dispatch: {}

concurrency: lumoauth-config

jobs:
  apply:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
    env:
      LUMO_BASE_URL: https://app.lumoauth.dev
      LUMO_ORG: acme-corp
      LUMO_API_KEY: ${{ secrets.LUMO_API_KEY }}
      LUMO_OUTPUT_FORMAT: json
    steps:
      - uses: actions/checkout@v4
      - name: Install the lumo CLI
        run: |
          curl -fsSL https://raw.githubusercontent.com/LumoAuth/cli/main/install.sh | sh
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Check the credential
        run: lumo doctor -o json
      - name: Apply
        run: bash lumoauth/apply.sh
```

- `concurrency` keeps two runs from applying at the same time.
- Protect the `production` environment with required reviewers, so that a person approves
  each apply. This is the "show before you change" rule for a pipeline.
- Run the same script against a test organization on pull requests, with a second key in a
  second environment.
- The install script verifies the download against the release checksums. Pin the action
  versions and review the script as the project's policy requires.

## Kubernetes

Run the same script from a `Job` (or a Helm hook) with the API key in a `Secret`. Where a
pod needs an identity of its own as an AI agent, prefer a workload identity agent: LumoAuth
then verifies the platform's own token and no long-lived credential is stored in the
cluster. Use the `lumoauth-agent-identity` skill for that.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: lumoauth-apply
  namespace: apps
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: apply
          image: registry.example.com/tools/lumo-tools:1.0.0 # an image with lumo, jq and the script
          envFrom:
            - secretRef:
                name: lumoauth-admin # LUMO_BASE_URL, LUMO_ORG, LUMO_API_KEY
          command: ["bash", "/opt/lumoauth/apply.sh"]
```

`backoffLimit: 0` avoids an automatic second run of a script that failed half-way; fix the
cause and start the Job again. The script is repeat-safe, so a manual second run is fine.

## What the API does not manage

- **Signing keys.** Generate, rotate, promote and revoke them in the portal.
- **API keys.** An admin creates and rotates them in the portal.
- **MCP servers** can be created, read and deleted, not edited. A change means delete and
  create again, and clients that hold tokens for the old resource identifier must
  authorize again.
- **An agent's identity type** cannot be changed after creation.

## Terraform users

There is no provider to install and no state file. If the team wants Terraform to drive the
apply, wrap the script in a `terraform_data` resource with a `local-exec` provisioner that
runs `bash lumoauth/apply.sh` and is triggered by a hash of the files in `lumoauth/`.
Terraform then only schedules the script; the script stays the source of truth, and
`terraform plan` cannot show a diff of LumoAuth resources.
