# Troubleshooting a connection to a LumoAuth-protected MCP server

Read this file when a client or an agent cannot get a token for an MCP server, or the server refuses the token. Find the place where the error appears, then the symptom.

## First, collect the facts

Run these read-only checks before you change anything.

```bash
# 1. What the MCP server says without a token
curl -i -X POST https://mcp.example.com/mcp

# 2. The metadata document that the challenge names (resource, authorization_servers, scopes_supported)
curl -s https://mcp.example.com/.well-known/oauth-protected-resource/mcp

# 3. What the organization's authorization server accepts
curl -s https://app.lumoauth.dev/.well-known/oauth-authorization-server/orgs/acme-corp/api/v1
```

Then read the access token's payload locally, for example with `jq`. Do not paste a token into a website, a chat or a log.

```bash
printf '%s' "$ACCESS_TOKEN" | cut -d. -f2 | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' | base64 -d | jq '{iss, aud, scope, exp, client_id, cnf}'
```

Compare:

| Claim | Must be |
|---|---|
| `iss` | The issuer in `authorization_servers` |
| `aud` | The MCP server's Resource URI |
| `scope` | The scopes that the tool needs |
| `exp` | In the future |
| `cnf.jkt` | Present when the server requires DPoP |

An organization admin can also read the audit log in the portal (**Audit logs**) for the refused request.

## The MCP client reports an error before the browser opens

| Symptom | Cause | Fix |
|---|---|---|
| `Protected resource … does not match expected …` | The URL that the client connects to differs from the `resource` in the metadata. `localhost` and `127.0.0.1` are different values, and so are different paths | Connect to the Resource URI exactly as the metadata shows it |
| The client finds no authorization server | The `401` has no `resource_metadata`, or the metadata document is not served on the MCP server's host | This is a fault of the server. Use `lumoauth-mcp-server` |
| `Dynamic client registration is not enabled` | The client has no client ID and tried to register itself | Give the client the Client ID of a pre-registered application, or use a client metadata document |

## The LumoAuth page in the browser shows an error

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid Redirect URL` | The redirect URI that the client sent is not registered for the application. A changing port is accepted on `127.0.0.1` and `[::1]`, and on `http://localhost` only for a public application | Register the exact URI, and give the client a fixed callback port |
| **Client metadata document rejected** | The CIMD file breaks a rule. **Technical details** shows the reason | Look up the reason in `client-id-metadata-documents.md` |
| **Application blocked** | An organization admin blocked this metadata-document client | Ask the admin to unblock it under **Applications → External clients (CIMD)** |
| An error about `code_challenge` | The request has no PKCE challenge, or a method other than `S256` | Send `code_challenge` and `code_challenge_method=S256` |
| `invalid_scope … not allowed for this client` | The application does not allow a scope that the client sends. Many MCP clients add `offline_access` | Add the scope to the application's **Scopes** |
| `invalid_scope` that names the MCP server | The scope is not in the server's scope list | Ask for the scopes from the challenge or from `scopes_supported` |
| `invalid_target` that names an expected `resource` | The request targets the server (by client or by scope) but has no `resource` parameter | Send `resource=<Resource URI>` |
| The consent screen appears again for a second server | Consent is per MCP server | Expected. The user approves each server once |

## The token endpoint answers with an error

| `error` | Cause | Fix |
|---|---|---|
| `invalid_target` | The `resource` is not a registered, active MCP server; or the client is not on the server's **Allowed clients** list; or two resources were sent; or the authorization request had no `resource` and the token request adds one | Send the exact Resource URI, and only that, in both requests. Ask the admin to add the client to the server |
| `invalid_target`, `Resource '…' is not registered for this client` | The application has a list of allowed resource URIs (**Resource indicators**) that lacks this server | Add the Resource URI on the application's **Configuration** tab |
| `invalid_target` on a device, CIBA or token-exchange grant of a client | The user never approved this MCP server for the client on a consent page | Run the authorization code flow with `resource` once |
| `invalid_scope` on an agent's exchange | None of the agent's capabilities covers a scope of the server, or the requested scope is not in the server's list | Give the agent a capability such as `mcp.read`; use the server's spelling of the scope |
| `invalid_dpop_proof` | The server requires DPoP and the request has no valid `DPoP` proof | Use a client or an SDK that sends proofs (`agent-tokens.md`), or ask the owner to switch **Require DPoP** off |
| `invalid_client` with `Client ID Metadata Document rejected (…)` | The reason is in the parentheses | `client-id-metadata-documents.md` |
| `invalid_client` with `client_disabled` | The client is blocked or disabled in the organization | Ask the admin |
| `invalid_grant` | The code was used twice, it is older than 5 minutes, the `code_verifier` is wrong, or the code was issued without PKCE for a server that requires it | Start the flow again and exchange the code at once |
| `invalid_request`, missing `client_id` | A public client sent no `client_id` | Send it on every token request |
| `unauthorized_client` on a refresh | The client's grant types no longer include `refresh_token` | Sign in again; ask the admin about the application's grant types |

## The MCP server refuses the token

| Symptom | Cause | Fix |
|---|---|---|
| `401`, `invalid_token`, the description names the audience | The token is for another resource: `resource` was missing, or it was another URL | Request the token with `resource=<Resource URI>` |
| `401`, the description says that the token is not a JWT | The application issues opaque access tokens | The admin sets the application to JWT access tokens |
| `401`, the description names the issuer | The token comes from another organization or region | Use the organization in the server's metadata. US and EU are separate |
| `401`, the token has expired | The client keeps an old token | Refresh the token, or exchange again |
| `401` for a token from the portal's test panel | Portal test tokens are not accepted by resource servers | Use a real token: the flow, the exchange, or `lumo agents token --resource` |
| `401` with the `DPoP` scheme and `algs` | The server requires DPoP and the client sent a bearer token or no proof | Send `Authorization: DPoP <token>` and a `DPoP` proof for each request |
| `401`, `invalid_dpop_proof` | The proof does not match the request: wrong `htu` (use the public URL without query), wrong `htm`, missing `ath`, a reused proof, or a clock that is off | Create a new proof for each request with the exact method and URL |
| `403`, `insufficient_scope` | The tool needs a scope that the token lacks | Authorize again with the scope in the challenge added |
| `403`, `insufficient_authorization_details`, with an `Insufficient-Authorization-Details` header | The tool needs a just-in-time approval | `lumoauth-agent-approvals` |
| `tools/list` is empty, or a tool call returns "policy does not allow this caller" | The server uses LumoAuth's per-tool policy and this caller has no grant | Ask the server's owner for a grant. An agent can check first with `agents.authorizeMcpTool` |
| The token worked and now fails before `exp` | The server introspects tokens, and the agent was suspended, the client was blocked or the sign-in was revoked | Ask the admin; then sign in again |

## LumoAuth refuses the token

| Symptom | Cause | Fix |
|---|---|---|
| The LumoAuth API refuses a token that works at the MCP server | A token whose audience is an MCP server works only there | Use the user's or agent's own token for LumoAuth calls |
| The MCP token exchange fails with a validation error before any request | The SDK got an id that is not a URL (`mcp_…`, `urn:…`) | Pass the Resource URI to the token call. The `mcp_…` id is for the self-check |
| The self-check answers `404 unknown_server` | The id is not an active registered server of this organization | Get the server id from the owner (`lumo mcp servers`) |
| The self-check answers `403 agent_required` | The credential is not an agent's | Use the agent's own token |
| The self-check answers `429` | The agent's budget is spent | `lumoauth-agent-identity` covers budgets |

## Connecting specific clients

- **Claude Code** with a pre-registered application: pass `--client-id` and `--callback-port` to `claude mcp add`, register `http://localhost:<port>/callback` on the application, and run `claude mcp login <name>`.
- **The FastMCP client**: `OAuth(client_id=…, callback_port=…)` from `fastmcp.client.auth`.
- **Clients that send no DPoP proofs** cannot reach a server that requires DPoP. The package READMEs name Claude Code and the FastMCP client, and the documentation names ChatGPT connectors.
- **ChatGPT connectors** use dynamic client registration, according to the documentation. The organization's admin must switch it on (`client-registration.md`).
- The server's page in the portal (**Discovery and client setup**) has snippets with the organization's real URLs for Claude, ChatGPT, a generic `mcp.json` client and `curl`.
