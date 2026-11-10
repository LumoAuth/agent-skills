# Register an MCP server in LumoAuth

Read this file when you need a registration setting that `SKILL.md` does not explain, when you create the server through the Admin API, or when a token request for the server fails with `invalid_target`, `invalid_scope` or `invalid_dpop_proof`.

## Where registration happens

| Way | What it can do |
|---|---|
| Portal, `{base}/orgs/{orgId}/portal/mcp-servers` (**AI Agents → MCP servers**) | Register, view, edit, delete. Registration and editing use the same three-step wizard |
| Admin API, `{base}/orgs/{orgId}/api/v1/admin/mcp/servers` | List, create, get, delete. There is no update route: change a server in the portal |
| `lumo` CLI | `lumo mcp servers` (list), `lumo mcp discovery <server-id>` (print the metadata document), `lumo api POST /mcp/servers --data '…'` (create through the Admin API) |

Permissions: the portal pages and the Admin API use the agent permissions. `agents.view` opens them; `agents.create`, `agents.edit` and `agents.delete` change a server. The **Allowed clients** picker also needs `clients.view`. An API key needs the scope `admin:agents:read` to read and `admin:agents:write` to create or delete.

Availability of MCP servers and of the per-tool grants depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Settings

API field names are shown. The portal wizard has a control for each.

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Human-readable name of the server |
| `resource_uri` | required | The canonical URI of the server. Clients send it as the `resource` parameter and it becomes the `aud` claim of tokens. It cannot be changed after registration |
| `endpoint_url` | none | The URL where the server accepts MCP connections. `lumo mcp test` and the client snippets in the portal use it |
| `description` | none | Free text |
| `transport` | `http_streamable` | `http_streamable`, `http_sse` or `stdio`. `http_sse` is deprecated in MCP 2026-07-28 and the API marks it with `transport_deprecated: true` |
| `auth_mode` | `oauth` | `oauth` (**OAuth 2.1 protected**) or `none` (**Public**). LumoAuth issues no tokens for a Public server |
| `scopes_supported` | `[]` | The scope vocabulary of the server. See "Scopes" below |
| `basic_scopes` | `[]` | The few scopes that every client needs to start. They are the only scopes in the `401` challenge and in the metadata. Empty means that every scope is advertised |
| `allowed_client_ids` | `[]` | Only these OAuth clients of the organization may get tokens for the server. Empty means every client of the organization, and that includes clients that identify themselves later with a Client ID Metadata Document or dynamic registration |
| `tool_authorizer_client_ids` | `[]` | The MCP server's own OAuth clients. Only these may call the per-tool authorization endpoint for this server (**Per-tool authorization** in the portal) |
| `require_pkce` | `true` | Authorization requests and code exchanges for this resource must use PKCE |
| `require_resource_param` | `true` | A request that evidently targets this server (the client is on the allow-list, or it asks for one of the server's scopes) must carry `resource`, or it fails with `invalid_target` |
| `require_dpop` | `false` in the API, on in the portal wizard for new servers | Only DPoP-bound tokens are issued for the server, and the server must accept nothing else |
| `token_lifetime` | `3600` | Access token lifetime in seconds, 60 to 86400. A value outside that range is refused with `422` |

The create response and every admin `GET` also return a `posture` object: a checklist that LumoAuth computes from these settings (server active, `https` Resource URI, endpoint URL set, OAuth protected, PKCE required, allowed clients set, scopes defined, resource parameter effective, DPoP required, token lifetime at most 3600 s). The portal shows the same list as **Security posture**, and each failing check links to the wizard step that fixes it.

## Resource URI rules

The portal and the Admin API apply the same rules:

- `https://` only. Plain `http://` is accepted for `localhost`, `127.0.0.1` and `[::1]` during local development.
- No whitespace, no fragment (`#`), no user name or password.
- It must be the MCP server's own address. An address on a LumoAuth host, or on a custom domain that points to LumoAuth, is refused.
- It must be unique in the organization. `https://mcp.example.com/` and `https://MCP.example.com` count as the same URI.

LumoAuth compares resource URIs in a normal form: scheme and host in lower case, default port dropped, trailing slashes dropped from the path. The token's `aud` carries the value as the client spelled it, so a verifier should compare in the same normal form. `lumoauth-fastmcp` and `@lumoauth/mcp` do this.

Use the exact URL that clients connect to as the Resource URI. MCP clients compare the `resource` in the metadata document with the URL that they called, and `localhost` and `127.0.0.1` are different values to them.

## Scopes

- When `scopes_supported` is not empty, a token for this resource may carry only those scopes, plus the OIDC identity scopes (`openid profile email phone address offline_access`). Any other scope fails with `invalid_scope` at `/authorize`, PAR and every token grant.
- Refused scope names (`422`): `*`, `all`, `full-access`, `offline_access`, and LumoAuth's own `admin` and `scim` scopes.
- `basic_scopes` must come from `scopes_supported` and may not hold wildcards such as `files:*`.
- **Use defaults** in the wizard sets `mcp:read` and `mcp:write`, and `mcp:read` as the basic scope. Clients then start with `mcp:read` and step up to `mcp:write` when a tool needs it.
- Scope values are case-sensitive strings. LumoAuth stores each scope as typed and puts it in tokens unchanged: `files:read`, `files.read` and `Files:Read` are three scopes.
- An application may only ask for scopes that are in its own **Scopes** list (**Applications → the application → Configuration**). Add a new scope there too.
- `offline_access` never appears in the challenge or in the metadata.

Agent tokens: an agent asks for the scope as the server spells it, with `resource` set to the server. LumoAuth allows the scope when one of the agent's capabilities covers it. Capabilities match in any spelling (`files:read`, `files.read` and `files.*` all cover `files:read`). Without `scope`, the token gets the vocabulary entries that the agent's capabilities cover, and the request fails with `invalid_scope` when none is covered.

## What LumoAuth enforces for the server

A request whose `resource` matches an active server's Resource URI is checked against that server's settings at `/authorize`, PAR and the token endpoint.

- **One MCP server per token.** A `resource` that names a registered MCP server may not be combined with another resource (`invalid_target`).
- **No new target at the token endpoint.** When the authorization request carried no `resource`, the token request may not add one that names an MCP server. This also applies to refresh tokens.
- **Consent per server.** Approval of a client for one MCP server does not cover another server, even with the same scope names. The consent screen names the server.
- **Device, CIBA and token-exchange grants** are accepted for the server only when the user already approved that server for the client on a consent page, or when a token exchange presents a subject token that is already bound to the server.
- **An inactive server** as `resource` fails with `invalid_target`.
- **A token for an MCP server works only there.** The LumoAuth API refuses a token whose audience is an MCP server.
- The client allow-list does not apply to agents: an agent is not an OAuth client. Per-tool grants determine what an agent may call.

## Create a server through the Admin API

Show the user the request before you send it: it creates a server in the organization.

```bash
lumo api POST /mcp/servers --data '{
  "name": "Invoices",
  "description": "Invoices MCP server",
  "resource_uri": "https://mcp.example.com/mcp",
  "endpoint_url": "https://mcp.example.com/mcp",
  "transport": "http_streamable",
  "auth_mode": "oauth",
  "scopes_supported": ["mcp:read", "mcp:write", "invoices:refund"],
  "basic_scopes": ["mcp:read"],
  "require_dpop": false,
  "token_lifetime": 3600
}'
```

`lumo api` paths are relative to `/orgs/{orgId}/api/v1/admin`. The response is `201` with `{"data": {"server_id": "mcp_…", …}, "message": "MCP server created"}`. An entry of `allowed_client_ids` or `tool_authorizer_client_ids` that is not a client of the organization is refused with `422 validation_error`, and nothing is stored.

Other routes:

```bash
lumo api GET /mcp/servers                                   # every server, inactive ones included
lumo api GET /mcp/servers/mcp_0123456789abcdef01234567      # full configuration and posture
lumo api DELETE /mcp/servers/mcp_0123456789abcdef01234567   # deletes the server: show it first
```

Use `lumoauth-admin-api` for API keys, key scopes and calls without the CLI.

## Documents that LumoAuth serves for a registered server

All are public and need no token.

| URL | Content |
|---|---|
| `{base}/orgs/{orgId}/api/v1/.well-known/oauth-protected-resource/mcp/{serverId}` | The server's protected resource metadata. The two packages read the registration from this document |
| `{base}/.well-known/oauth-protected-resource/orgs/{orgId}/api/v1/mcp/{serverId}` | The same document in the well-known suffix form |
| `{base}/orgs/{orgId}/api/v1/.well-known/oauth-protected-resource` | One server's document, or `{"resources": […]}` for several, or `404` when the organization has no OAuth-protected MCP server |
| `GET` or `POST` `{base}/orgs/{orgId}/api/v1/mcp/{serverId}/challenge` | A reference implementation of the challenge: `401` without a valid token for this server, `403 insufficient_scope` that lists only the missing scopes, `200 {"status": "authenticated", …}` for a valid token. Add `?scope=mcp:read mcp:write` to state the scopes of the operation |

The Resource URI is on the MCP server's own host, so MCP clients look for the metadata document on that host. The packages serve it there. A server that is written by hand must serve it too (see `manual-implementation.md`).

## Before production

- Register a separate server with the public `https://` address.
- Under **Allowed clients**, choose **Only the clients I pick**.
- Switch on **Require DPoP sender-constrained tokens** when every client can send proofs.
- Keep the token lifetime at 3600 seconds or less.
- Run the server behind TLS with a certificate from a public certificate authority.
