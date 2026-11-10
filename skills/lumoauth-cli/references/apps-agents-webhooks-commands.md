# `lumo`: apps, agents, MCP servers, webhooks, social providers

Command tables for OAuth applications, AI agents, MCP servers, webhooks and social login
providers. Add `-o json` to every command whose output you parse. Show the user each command
in a "changes" row before you run it.

Several commands here return a secret exactly once. Run them with `-o json`, store the
secret where the user wants it (a secret manager, or an environment file outside version
control), and do not print it into a log.

## `apps` (aliases `app`, `clients`): OAuth applications

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo apps list` | no | `--search <name>`, `--page`, `--limit` |
| `lumo apps get <client-id>` | no | |
| `lumo apps create` | yes | `--name` (required), `--redirect-uris <uri,...>`, `--grant-types <type,...>`. Returns `data.secret` once |
| `lumo apps update <client-id>` | yes | `--name`, `--redirect-uris <uri,...>`, `--grant-types <type,...>`. Pass the full list, not only the new entry |
| `lumo apps delete <client-id>` | yes | |
| `lumo apps rotate-secret <client-id>` | yes | Returns the new client secret once. The old secret stops working |

```bash
lumo apps create --name "Acme Web" \
  --redirect-uris http://localhost:3000/callback,https://app.example.com/callback \
  -o json
```

Defaults when a flag is absent: grant types `authorization_code` and `refresh_token`; scopes
`openid`, `profile`, `email`; a confidential client (it has a secret); PKCE required.

The `--type` flag of `lumo apps create` (`web`, `spa`, `native`, `m2m`) does not change the
client that the Admin API creates. For a public client (a single-page or native app, which
must not hold a secret), send the fields that the API reads:

```bash
lumo api POST /clients -o json --data '{
  "name": "Acme SPA",
  "redirectUris": ["http://localhost:3000/callback"],
  "isConfidential": false
}'
```

A redirect URI must be `https`, `http` on a loopback address, or a custom scheme of a native
app. Never put a client secret in browser or mobile code. For the settings of a client and
the choice between client types, use `lumoauth-oauth-oidc`.

## `agents` (alias `agent`): AI agents

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo agents list` | no | `--search <name>` |
| `lumo agents get <agent-id>` | no | |
| `lumo agents create` | yes | `--name` (required), `--type <identity type>`, `--description`, `--capabilities <cap,...>`, `--act-on-behalf`, key lifetime flags. Prints the response, which holds the credential once |
| `lumo agents update <agent-id>` | yes | `--name`, `--description`, `--capabilities <cap,...>`, key lifetime flags (they change the expiry of the current API key) |
| `lumo agents delete <agent-id>` | yes | |
| `lumo agents enable <agent-id>` | yes | Activates the agent |
| `lumo agents disable <agent-id>` | yes | Deactivates the agent |
| `lumo agents rotate-credentials <agent-id>` | yes | Issues a new API key or client secret. The current one stops working at once. Key lifetime flags apply to the new key |
| `lumo agents token <agent-id>` | yes | Mints a bearer token for the agent: `--ttl <seconds>`, `--scopes <cap,...>` (narrows the token), `--resource <resource URI>` (binds the token to a registered MCP server) |

`--type` values: `api_key` (default), `client_secret`, `workload`, `aauth`,
`private_key_jwt`, `custom`.

Key lifetime flags (for an API key agent; use at most one):

| Flag | Value |
|---|---|
| `--key-expires-in-days <n>` | 1 to 3650 |
| `--key-expires-at <when>` | A date `YYYY-MM-DD` (end of that day, UTC) or an RFC 3339 time, in the future |
| `--key-never-expires` | The key is valid until it is revoked or rotated |

```bash
lumo agents create --name "invoice-bot" --type api_key \
  --capabilities invoices.read,invoices.send --key-expires-in-days 90 -o json
lumo agents rotate-credentials agt_3f9a51c07be24d18 --key-expires-in-days 90 -o json
```

A token that is minted with `--resource` is for that MCP server; the LumoAuth API refuses
it. To choose the identity type and to use the credential, use `lumoauth-agent-identity`.

## `mcp`: MCP servers

| Command | Changes | Purpose |
|---|---|---|
| `lumo mcp servers` | no | Lists the registered MCP servers |
| `lumo mcp discovery <server-id>` | no | Fetches the public protected resource metadata (RFC 9728) of one server |
| `lumo mcp test <server-id> <agent-id>` | mints a token | End-to-end check: mints a short-lived token for the agent, bound to the server's resource URI, and sends one JSON-RPC request to the server's endpoint |
| `lumo mcp check-tool <server-id> <tool>` | no | Asks whether a user or an agent may run one tool of the server |

`lumo mcp test` flags: `--scope <scope>` (default: the first scope that the server
advertises), `--ttl <seconds>` (default 300), `--method <JSON-RPC method>` (default
`tools/list`), `--params '<json object>'`. It prints the HTTP status on standard error and
the JSON response on standard output. An HTTP 401 means that the MCP server rejected the
token: compare the server's configuration with the discovery document.

`lumo mcp check-tool` flags:

| Flag | Purpose |
|---|---|
| `--subject <subject>` | Required. `agent:<agent id>` or `user:<user id>` |
| `--client-id <id>` | Required. The MCP server's own OAuth client. It must be listed under "Per-tool authorization" on the MCP server |
| `--client-secret <secret>` | The client's secret. Prefer the `LUMO_MCP_CLIENT_SECRET` environment variable |

`<server-id>` is the registered server ID (`mcp_...`), not the resource URI. The command
gets a client credentials token with scope `mcp:authorize` for that client, then asks the
per-tool question. Exit status 0 means allowed, 1 means denied.

```bash
LUMO_MCP_CLIENT_SECRET="$MCP_CLIENT_SECRET" lumo mcp check-tool mcp_0123abcd send_reminder \
  --subject agent:agt_3f9a51c07be24d18 --client-id invoices-mcp-server -o json
```

To register and protect an MCP server, use `lumoauth-mcp-server`.

## `webhooks` (aliases `webhook`, `wh`)

| Command | Changes | Flags and notes |
|---|---|---|
| `lumo webhooks list` | no | `--page` |
| `lumo webhooks get <webhook-id>` | no | |
| `lumo webhooks create` | yes | `--url <https url>` (required), `--events <event,...>` (required). Returns `data.secret`, the signing secret, once |
| `lumo webhooks update <webhook-id>` | yes | `--url`, `--events <event,...>` (replaces the list) |
| `lumo webhooks delete <webhook-id>` | yes | |
| `lumo webhooks deliveries list <webhook-id>` | no | `--status pending\|success\|failed\|dead_lettered`, `--limit <n>` |
| `lumo webhooks deliveries get <webhook-id> <delivery-id>` | no | One delivery with its attempt history |
| `lumo webhooks deliveries replay <webhook-id> <delivery-id>` | yes | Queues the delivery again with the same delivery ID |

Notes:

- The URL must be a public `https` URL. A private or loopback address is refused with HTTP
  400. For local development use `lumo tunnel`.
- The Admin API generates the signing secret. The `--secret` and `--description` flags of
  `create` and `update` do not change what the API stores.
- The status of a delivered event is `success`. The `--status` help text of some CLI
  versions lists `delivered`; the API answers HTTP 400 for that value.
- Endpoints without a command:

```bash
lumo api GET /webhooks/events -o json                 # the event catalogue
lumo api POST /webhooks/42/rotate-secret -o json      # new signing secret, shown once
lumo api POST /webhooks/42/disable -o json
lumo api POST /webhooks/42/enable -o json
```

To write the receiver and verify signatures, use `lumoauth-webhooks`.

## `social` (alias `social-providers`): social login providers

| Command | Changes | Purpose |
|---|---|---|
| `lumo social list` | no | Lists the configured providers |
| `lumo social get <provider-id>` | no | |
| `lumo social delete <provider-id>` | yes | |

Create a provider through `lumo api`. The Admin API requires `provider`, `clientId`,
`clientSecret` and `displayName`, and a new provider is disabled unless `enabled` is `true`.
`lumo social create` (`--provider`, `--client-id`, `--client-secret`, `--name`, `--scopes`)
does not send `displayName`, so the API refuses its request. Build the body from an
environment variable so that the provider's secret stays out of the shell history:

```bash
BODY=$(jq -n --arg secret "$GOOGLE_CLIENT_SECRET" '{
  provider: "google",
  clientId: "1234567890-example.apps.googleusercontent.com",
  clientSecret: $secret,
  displayName: "Google",
  enabled: true
}')
lumo api POST /social-providers --data "$BODY" -o json
```

For the provider console setup and callback URLs, use `lumoauth-login-methods`.
