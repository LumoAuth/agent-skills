---
name: lumoauth-admin-api
description: >-
  Automates a LumoAuth organization through the Admin API
  (`/orgs/{orgId}/api/v1/admin/...`) and the generated API clients (`@lumoauth/api-client`,
  `lumoauth-api-client`, `github.com/lumoauth/api-clients/go`). Covers API keys (`lmk_`,
  `Authorization: ApiKey` or `X-API-Key`), OAuth tokens with the `admin` or
  `admin:<resource>:<read|write>` scopes, least-privilege scopes and required permissions,
  the resource areas (users, roles, groups, permissions, OAuth clients, agents, MCP servers,
  webhooks, audit logs, sessions, settings), pagination, the error format, rate limits with
  `Retry-After`, retries, `lumo.api` on `@lumoauth/backend`, `client.api` in Python, and
  configuration as code in CI with the `lumo` CLI (the route instead of a Terraform
  provider or a Kubernetes operator). Use when the user asks to call the LumoAuth REST API,
  write a provisioning or sync script, manage LumoAuth from CI/CD, GitOps or Terraform,
  choose API key scopes, or fix a 401, 403 or 429 from the Admin API.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth Admin API

Write server-side code and pipelines that read and change a LumoAuth organization over
HTTPS: users, roles, groups, permissions, OAuth clients, AI agents, MCP servers, webhooks,
audit logs, sessions and settings. Everything that an admin does in the portal for these
resources has an Admin API endpoint.

## When to use

- A backend service, a script or a CI job must provision or read LumoAuth resources.
- The user wants the organization's configuration in a repository and applied by a pipeline
  ("configuration as code", "Terraform", "GitOps", "Kubernetes operator").
- A call to `/orgs/{orgId}/api/v1/admin/...` fails with 401, 403 or 429.

Do not use this skill for:

- One-off changes from a terminal: use `lumoauth-cli` (`lumo users list`, `lumo api`).
- One-off changes that the agent makes itself, with no API key, when the LumoAuth MCP
  server is connected to the agent: use `lumoauth-mcp-management`.
- Sign-in, tokens and sessions in an app: use the framework skill or `lumoauth-oauth-oidc`.
- Validating access tokens in the user's own API: use `lumoauth-api-protection`.
- Permission checks at request time (`/authz/check`): use `lumoauth-authorization`.
- SCIM provisioning from an identity provider: use `lumoauth-scim`.

## Before you start

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask the user |
| Organization slug (`{orgId}`) | The portal URL `/orgs/{orgId}/portal/...`. Example: `acme-corp` |
| API key (`lmk_...`) | An admin creates it in the portal (step 1). It is shown once. Read it from an environment variable or a secret store |
| Scopes that the job needs | Work them out from the endpoints (step 1 and `references/endpoints.md`) and tell the user which ones to select |

Ask the user for a value that you cannot find. Never guess one. An agent cannot create the
API key: an admin creates it in the portal after a fresh sign-in.

Rules:

- The API key is a server-side secret. Never put it in browser or mobile code, in a
  repository, in a container image or in a log.
- Show the user every request that creates, changes or deletes something (`POST`, `PUT`,
  `PATCH`, `DELETE`) before you send it. Reads need no approval.
- Request the smallest set of scopes. One key per job.

## The API in one screen

```
{base}/orgs/{orgId}/api/v1/admin/{resource}
```

| Topic | Rule |
|---|---|
| Credential | `Authorization: ApiKey lmk_...` or `X-API-Key: lmk_...`. One credential per request |
| Bodies | JSON in, JSON out. Send `Content-Type: application/json` on writes |
| Lists | `?page=1&limit=25`, `limit` at most 100. Response: `{"data": [...], "meta": {...}}` |
| Single resource | `{"data": {...}}`, often with a `message` |
| Errors | `{"error": "<code>", "message": "...", "status": 403, "details": {...}}` |
| Rate limit | Per credential. `429` with a `Retry-After` header (seconds) |
| IDs | Users: UUID or email in the path. Roles, groups, permissions: ID or slug |
| Session | None. No cookie is set; send the credential on every request |

## Steps

### 1. Choose the credential and its scopes

| Caller | Credential | Header |
|---|---|---|
| Server, CI job, script | API key (`lmk_...`) | `Authorization: ApiKey lmk_...` or `X-API-Key: lmk_...` |
| App that acts for a signed-in administrator | OAuth access token of that user | `Authorization: Bearer <token>` |

Use an API key unless the user asks for per-admin attribution.

**API key.** An admin opens **API keys** in the portal
(`/orgs/{orgId}/portal/settings/api-keys`), chooses **Create API key**, enters a name,
chooses an expiration, selects the scopes under **Permissions** and copies the key once.
Creating and managing keys needs the `settings.manage` permission. Tell the user exactly
which scopes to select:

- A read (`GET`) needs `admin:<resource>:read` for that resource.
- A write (`POST`, `PUT`, `PATCH`, `DELETE`) needs `admin:<resource>:write`.
- Scopes are matched exactly. A job that lists and changes users needs
  `admin:users:read` and `admin:users:write`.
- A scope for one resource never opens another. No blanket scope exists for API keys.

Scopes: `admin:users:*`, `admin:roles:*`, `admin:groups:*`, `admin:permissions:*`,
`admin:clients:*` (plus `admin:clients:register` for dynamic client registration only),
`admin:agents:*`, `admin:webhooks:*`, `admin:sessions:*`, `admin:settings:*`,
`admin:social:*`, `admin:abac:*`, each with `:read` and `:write`; and the read-only
`admin:audit:read` and `admin:analytics:read`. Some endpoint families use the closest
scope: MCP servers use `admin:agents:*`; email templates and sandboxes use
`admin:settings:*`; customer organizations use `admin:users:*`.
[references/endpoints.md](references/endpoints.md) lists the scope of every endpoint.

**Two checks run on every request.** The scope says what the credential may reach. The
permission says what the person behind it may do: every endpoint declares a permission (for
example `users.view`, `users.delete`, `roles.assign-permissions`), and the person who
created the API key must still be active and still hold it. A key never does more than its
creator can do today. `settings.manage` is not a full-admin grant: it governs sign-in,
MFA, session and security policy, the organization profile, audit log retention and
sandboxes, and does not open users, roles, clients or webhooks.

**OAuth access token.** The Admin API accepts a user's access token only when the token
carries the blanket `admin` scope or an `admin:<resource>:<read|write>` scope, and the
user holds the endpoint's permission. Add the scope to the allowed scopes of an OAuth
client that was created in the portal, and request it in the authorization request
(`scope=openid profile admin:users:read`). A token with only `openid profile email` gets
403, also for an administrator. Dynamically registered clients cannot obtain admin scopes.
ID tokens and agent tokens are refused.

Do not send an `lmk_` key as `Authorization: Bearer`: that returns 401.

### 2. Make the first call

```bash
export LUMO_BASE_URL="https://app.lumoauth.dev"
export LUMO_ORG="acme-corp"
export LUMO_API_KEY="lmk_..."   # from the secret store; never commit it

curl -sS "$LUMO_BASE_URL/orgs/$LUMO_ORG/api/v1/admin/users?limit=5" \
  -H "Authorization: ApiKey $LUMO_API_KEY"
```

`LUMO_BASE_URL`, `LUMO_ORG` and `LUMO_API_KEY` are the names that the `lumo` CLI reads; a
script can share them. The SDKs read `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID` and
`LUMOAUTH_API_KEY` instead.

A 200 with `{"data": [...], "meta": {...}}` proves the base URL, the slug, the key and the
`admin:users:read` scope. For any other status, go to step 5.

### 3. Call it from code

Use a small typed wrapper over `fetch`. The complete, tested file is in
[references/http-clients.md](references/http-clients.md) (`lumoauth-admin.ts`, and a Python
version on the standard library). It sends the key, pages through lists, retries on 429,
and raises a typed error. Use it like this:

```ts
import { createAdminClient, LumoAuthApiError } from "./lumoauth-admin.ts";

const admin = createAdminClient({
  baseUrl: process.env.LUMO_BASE_URL ?? "https://app.lumoauth.dev",
  orgId: process.env.LUMO_ORG ?? "",
  apiKey: process.env.LUMO_API_KEY ?? "",
});

interface User {
  id: string;
  email: string;
}

// Read: every user, page by page (scope admin:users:read).
let count = 0;
for await (const user of admin.paginate<User>("/users", { sortBy: "createdAt", sortDir: "ASC" })) {
  count++;
  console.log(user.id, user.email);
}
console.log(`${count} users`);

// Write: create a role, and treat "already exists" as success (scope admin:roles:write).
try {
  const created = await admin.request<{ data: { id: string | number; slug: string } }>("POST", "/roles", {
    body: { name: "Finance", description: "Finance team", permissions: ["invoices.approve"] },
  });
  console.log("created role", created.data.slug);
} catch (err) {
  if (err instanceof LumoAuthApiError && err.status === 409) {
    console.log("role exists");
  } else if (err instanceof LumoAuthApiError && err.status === 403) {
    // details.required_scopes or details.required_permissions names what is missing
    console.error("forbidden:", err.message, JSON.stringify(err.details ?? {}));
    process.exitCode = 1;
  } else {
    throw err;
  }
}
```

When the project already uses a LumoAuth SDK, reach the full API through it instead:
`lumo.api` on `@lumoauth/backend` and `client.api` on the Python `lumoauth` package expose
the generated client with the SDK's credential. Read
[references/generated-clients.md](references/generated-clients.md) before you use a
generated client: most Admin API operations in it take only path parameters, so request
bodies and query parameters need extra care.

### 4. Page through lists

| Parameter | Default | Meaning |
|---|---|---|
| `page` | 1 | 1-based page number |
| `limit` | 25 | Items per page, at most 100 |
| `search` | none | Text search, on endpoints that support it |
| `sortBy`, `sortDir` | endpoint default, `DESC` | Sort field and `ASC` or `DESC` |

```json
{
  "data": [],
  "meta": { "total": 1284, "page": 3, "limit": 20, "totalPages": 65, "hasNextPage": true, "hasPreviousPage": true },
  "resourceType": "users"
}
```

Increase `page` until `meta.hasNextPage` is `false`. Do not assume that a list fits on
one page. Filters are endpoint-specific (`/users` takes `search`, `role`, `group`,
`blocked`, `active`); read the endpoint's page in the API reference before you add one.

### 5. Handle errors

Read the HTTP status first, then `error` (the machine code), then `message` and `details`.

| Status | `error` | Meaning | Action |
|---|---|---|---|
| 400 | `invalid_request` | Malformed body or parameter; `details.missing_fields` or `details.rejected_keys` | Fix the request. Do not retry |
| 401 | `invalid_api_key`, `invalid_token`, `unauthorized` | Missing, expired, revoked or wrong-organization credential | Fix the credential. Do not retry |
| 403 | `forbidden` | Missing scope (`details.required_scopes`, `details.granted_scopes`) or missing permission (`details.required_permissions`) | Tell the user what is missing. Do not retry |
| 403 | `feature_not_in_plan`, `plan_limit_reached` | The plan does not include the feature or a limit is reached | See https://docs.lumoauth.dev/pricing-matrix |
| 404 | `not_found` | Unknown ID, or wrong organization slug | Check both |
| 409 | `conflict` | The resource exists (duplicate email, slug) | Read or update instead of create |
| 422 | `validation_error` | Field validation failed; `details` maps field to message | Fix the fields |
| 429 | `rate_limited`, `rate_limit_exceeded` | Too many requests for this credential | Wait `Retry-After` seconds, then retry |
| 5xx | `server_error`, `temporarily_unavailable` | Server-side failure | Retry reads with backoff; see step 6 for writes |

[references/errors-and-limits.md](references/errors-and-limits.md) lists every 403 cause
with its message, the other error formats (OAuth endpoints, SCIM) and the retry rules.

### 6. Rate limits, retries and repeated writes

- The limit is counted per credential. Successful responses carry no rate-limit headers;
  a `429` carries `Retry-After` in seconds. Wait that long plus a small random delay.
- A 429 is returned before the request runs, so a write that got 429 can be sent again.
- Retry `GET` on a network error or 5xx with exponential backoff. Do not blindly retry a
  `POST` after a network error or 5xx: the first attempt may have succeeded.
- The API has no idempotency key. Make a job safe to run twice: look the resource up
  first, create only when it is missing, and treat 409 as "already exists".
- Give independent jobs their own API keys: each key has its own budget. Run bulk work
  with low concurrency.

### 7. Keep configuration in a repository

LumoAuth has no Terraform provider and no Kubernetes operator. Configuration as code means
a script in the repository that a pipeline runs with an API key: the `lumo` CLI for the
resources that it covers, `lumo api` or HTTP for the rest. The pattern is "ensure": read,
then create or update.

```bash
#!/usr/bin/env bash
# lumoauth/apply.sh: safe to run repeatedly. Needs LUMO_BASE_URL, LUMO_ORG, LUMO_API_KEY.
set -euo pipefail

exists() { # exists <group> <id-or-slug>: 0 = exists, 1 = missing; stops on any other error
  local rc=0
  lumo "$1" get "$2" -o json >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    3) return 1 ;;
    *) echo "lumo $1 get $2 failed with exit code $rc" >&2; exit "$rc" ;;
  esac
}

ensure_permission() { # ensure_permission <slug> <name>
  if exists permissions "$1"; then
    lumo permissions update "$1" --name "$2" -o json >/dev/null
  else
    lumo permissions create --slug "$1" --name "$2" -o json >/dev/null
  fi
}

ensure_role() { # ensure_role <slug> <name> <permission-slugs>
  if exists roles "$1"; then
    local id
    id=$(lumo roles get "$1" -o json | jq -r '.data.id')
    lumo roles update "$id" --name "$2" --permissions "$3" -o json >/dev/null
  else
    lumo roles create --name "$2" --permissions "$3" -o json >/dev/null
  fi
}

lumo doctor -o json >/dev/null

ensure_permission invoices.approve "Approve invoices"
ensure_permission invoices.view "View invoices"
ensure_role finance "Finance" invoices.approve,invoices.view
```

The role slug is derived from the name when the role is created (`Finance` becomes
`finance`). Read [references/config-as-code.md](references/config-as-code.md) for the CI
workflow, the scopes of such a pipeline, secrets that are returned once, a Kubernetes Job
variant, and what cannot be managed through the API.

## Verify

1. `curl` from step 2 returns 200 and a `data` array.
2. A deliberate call outside the key's scopes returns 403 with `details.required_scopes`.
   That proves that the key is narrow.
3. After a write, a `GET` of the same resource returns the new state.
4. Run the script or pipeline twice. The second run changes nothing and exits with 0.
5. The audit log shows the change: `GET /admin/audit-logs?limit=5` (scope
   `admin:audit:read`).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| 401 `invalid_token` with an `lmk_` key | The key was sent as `Authorization: Bearer` | `Authorization: ApiKey lmk_...` or `X-API-Key` |
| 401 with a valid key | The key belongs to another organization or region, or it expired or was rotated | Check the slug and the base URL; create a new key |
| 403 on `POST`, while `GET` works | The key holds only the `:read` scope | Add the `:write` scope (keep `:read` for the reads) |
| 403 on `GET`, while the key holds `:write` | Scopes are matched exactly | Add the `:read` scope |
| 403 with `details.required_permissions` | The key's creator (or the token's user) lacks that permission, also when they hold `settings.manage` | An admin who holds the permission grants it or creates the key |
| 403 and the key used to work | Its creator was deactivated or lost a permission | Create a new key from an active admin |
| 403 with an OAuth token that works elsewhere | The token has no admin scope | Allow and request `admin` or `admin:<resource>:<read\|write>` |
| 400 "Send exactly one credential" | The request carries an API key and a Bearer token | Remove one; check HTTP client defaults |
| 400 with a plain-text body | The path percent-encodes a letter, digit, `-`, `.`, `_` or `/` | Send the path in plain form |
| 403 `bearer_not_accepted` or `api_key_not_accepted` | The credential was sent to a portal page or a route outside `/orgs/{orgId}/api/v1/` | Call API routes only; fetch discovery documents without a credential |
| A script creates duplicates or fails on the second run | Create without a lookup | Use the "ensure" pattern; treat 409 as exists |
| Only 25 items come back | No pagination | Follow `meta.hasNextPage` |
| CORS error from a browser app | The Admin API does not accept cross-origin browser calls | Call it from the backend with an API key |
| A secret is missing after create | Client secrets, agent keys and webhook signing secrets are returned once | Capture them from the create response; rotate when lost |

## Related skills

- `lumoauth-mcp-management`: the same resources as tool calls of the LumoAuth MCP server.
- `lumoauth-cli`: the `lumo` commands that wrap this API, and `lumo api` for raw calls.
- `lumoauth-node-backend`, `lumoauth-python`: the SDKs whose `lumo.api` and `client.api`
  expose the generated client.
- `lumoauth-users-sessions`, `lumoauth-rbac`, `lumoauth-agent-identity`,
  `lumoauth-mcp-server`, `lumoauth-webhooks`: what to put in the request bodies for those
  resources.
- `lumoauth-audit-compliance`: audit log queries and export.
- `lumoauth-b2b-saas`: the customer organization endpoints.

## References

- [references/endpoints.md](references/endpoints.md): open to find the endpoint, the
  permission and the scope for a resource.
- [references/http-clients.md](references/http-clients.md): the TypeScript and Python
  wrappers used in step 3.
- [references/generated-clients.md](references/generated-clients.md): open before you use
  `@lumoauth/api-client`, `lumoauth-api-client`, the Go client, `lumo.api` or `client.api`.
- [references/errors-and-limits.md](references/errors-and-limits.md): open for a 4xx or
  429 that the table above does not explain.
- [references/config-as-code.md](references/config-as-code.md): open to build the CI
  pipeline.
- https://docs.lumoauth.dev/api-reference/ and
  https://docs.lumoauth.dev/api-reference/authentication
- https://docs.lumoauth.dev/api-reference/pagination,
  https://docs.lumoauth.dev/api-reference/rate-limits,
  https://docs.lumoauth.dev/api-reference/errors
- https://docs.lumoauth.dev/admin/ and https://docs.lumoauth.dev/admin/spec (OpenAPI)
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/integrations/terraform-provider,
  https://docs.lumoauth.dev/integrations/kubernetes-operator
