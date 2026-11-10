# Client ID Metadata Documents (CIMD)

Read this file when a client should identify itself to LumoAuth with a URL and no registration: to write and host the metadata document, to check it, or to find out why LumoAuth rejected it.

## What it is

A Client ID Metadata Document is a JSON file that the client's publisher hosts at a public `https://` URL. That URL is the `client_id`. LumoAuth fetches the file when the client starts an authorization request, validates it, and treats the client like a registered one. The MCP Authorization specification (revision 2026-07-28) names this as the preferred way for an MCP client to identify itself. LumoAuth implements draft 02 of the OAuth Client ID Metadata Document specification.

CIMD is on by default in every organization. The authorization server metadata then holds `"client_id_metadata_document_supported": true`. An organization admin can switch it off, restrict it to chosen domains, or block one client.

Each organization keeps its own copy of the client, so one metadata URL works in any number of organizations. Tokens from one organization are unknown in another.

## Write the document

```json
{
  "client_id": "https://client.example.com/oauth/metadata.json",
  "client_name": "Example MCP Client",
  "client_uri": "https://client.example.com",
  "logo_uri": "https://client.example.com/logo.png",
  "redirect_uris": ["https://client.example.com/callback", "http://127.0.0.1/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "openid profile email mcp:read"
}
```

| Member | Rule |
|---|---|
| `client_id` | Required. Byte for byte the URL at which the file is served. A trailing slash, `www.`, a port or a different case makes it a mismatch |
| `client_name` | Required. LumoAuth removes control characters, `<`, `>`, backticks and `${`, and cuts the name to 100 characters |
| `redirect_uris` | Required. Each URI is `https`, or `http` on the loopback interface only (`localhost`, `127.0.0.1`, `[::1]`). A loopback URI matches any port at run time. No fragments, no custom schemes (`myapp://…`). One bad URI rejects the whole document |
| `grant_types` | `authorization_code` and `refresh_token` only. The client receives refresh tokens only when `refresh_token` is listed |
| `token_endpoint_auth_method` | `none` (the default, a public client) or `private_key_jwt` |
| `jwks` or `jwks_uri` | Required with `private_key_jwt`. `jwks_uri` must be `https` |
| `scope` | The scopes that the client may ask for. See "Scopes" below |
| `logo_uri`, `client_uri` | Kept only when they are well-formed `https` URLs |

## Host the document

- A stable, public `https://` URL **with a path**, for example `https://client.example.com/oauth/metadata.json`. No query, no fragment, no user name, no `.` or `..` path segments, at most 191 characters.
- Status `200`, `Content-Type: application/json` (or `application/…+json`), at most 64 KB.
- No redirects. A URL shortener or a redirect to `www.` fails.
- The host must be publicly resolvable. LumoAuth refuses loopback, private and link-local hosts.
- Add `Cache-Control: max-age=…` to set how long LumoAuth caches a valid document: between 60 seconds and 1 hour, 300 seconds without the header. Use 60 while you change the file. A rejected document is never cached, so a fix applies on the next request.
- Any static host works: the application itself, an object storage bucket, a pages service.

## Use it

Send the URL as `client_id`, with PKCE (`S256`), in the normal flow:

```text
GET https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize
    ?response_type=code
    &client_id=https%3A%2F%2Fclient.example.com%2Foauth%2Fmetadata.json
    &redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback
    &scope=mcp%3Aread
    &resource=https%3A%2F%2Fmcp.example.com%2Fmcp
    &code_challenge=<S256 challenge>&code_challenge_method=S256
    &state=<random>
```

The token request sends the same `client_id`, the `code_verifier` and the `resource`. A public client sends no secret. The complete script in `authorization-flow.md` works with a metadata URL as `MCP_CLIENT_ID`.

On the consent screen the user sees the client as an **external client** with the host of its URL. When the redirect goes to the loopback interface, the user also sees a warning about it.

## What is not allowed

- **No `client_credentials`.** A metadata document identifies a client; it does not make the organization trust it. Grants without user consent are never available to a CIMD client, whatever the document lists. For machine-to-machine tokens, register an application or an agent in the organization.
- **No shared secret.** `client_secret_basic` and `client_secret_post` are impossible for a self-published client.
- **No custom-scheme redirect URIs.** A client that needs `myapp://callback` must be registered (see `client-registration.md`).
- **No plain `http` except loopback.**
- **No privileged scopes from the document.** See below.
- **No request without PKCE.**

## Scopes

LumoAuth takes from the document only the identity scopes (`openid`, `profile`, `email`, `phone`, `address`), `mcp:read`, and the scopes of the organization's active MCP servers. It drops everything else without an error: `admin`, `admin:*`, `scim`, `offline_access`, `*:write` and so on. A dropped scope does not appear on the consent screen.

An organization admin can allow more scopes for CIMD clients with the setting `cimd_allowed_scopes`. Show the user this command before you run it: it changes the organization's sign-in settings. It needs the `settings.manage` permission (an API key needs `admin:settings:write`).

```bash
lumo api PATCH /settings/auth --data '{ "cimd_allowed_scopes": ["mcp:write"] }'
```

## Confidential clients: `private_key_jwt`

A client that can keep a private key publishes the public key and signs each token request:

```json
{
  "client_id": "https://client.example.com/oauth/metadata.json",
  "client_name": "Example MCP Client",
  "redirect_uris": ["https://client.example.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "private_key_jwt",
  "jwks_uri": "https://client.example.com/oauth/jwks.json"
}
```

Every token request then carries a client assertion (RFC 7523) with `iss` and `sub` equal to the document URL, signed with a key from `jwks` or `jwks_uri`. Such a client still acts only for a user who consented. `lumoauth-oauth-advanced` covers client assertions.

## Check a document before you use it

Both tools show the document as the authorization server processes it, and neither registers anything.

- **Portal:** **Applications → External clients (CIMD) → Check a metadata document**. Paste the URL and, to skip the cached copy, tick **Ignore the cached copy**.
- **Admin API:** needs the `clients.view` permission (an API key needs `admin:clients:read`).

```bash
lumo api POST /clients/cimd/check --data '{ "client_id": "https://client.example.com/oauth/metadata.json", "refresh": true }'
```

The answer holds `ok`, `reason`, `message`, the `document` as fetched and the `effective` client: `redirect_uris`, `dropped_redirect_uris`, `grant_types`, `scopes`, `dropped_scopes`, `public_client`, `pkce_required`, `has_loopback_redirect`. `"refresh": true` discards the cached copy first.

## Why a document is rejected

Every rejection carries a stable `reason`. The authorization error page shows it under **Technical details**. The token endpoint answers `401 invalid_client` with the reason in `error_description`. The check tools return it as `reason`.

| `reason` | What to fix |
|---|---|
| `invalid_client_id_url` | The `client_id` is not an absolute `https://` URL with a path, or it has a query, a fragment, a user name or a `.`/`..` segment |
| `client_id_too_long` | More than 191 characters. Publish at a shorter URL |
| `unsafe_url` | The host is loopback, private or link-local, or it does not resolve. Use a public `https` host |
| `fetch_failed` | Connection, TLS or timeout error (10 seconds per request), or the URL redirects |
| `http_status_NNN` | The URL answered a status other than `200` |
| `invalid_content_type` | Serve `application/json` or `application/*+json` |
| `document_too_large` | Larger than 64 KB |
| `invalid_json` | The body is not a JSON object |
| `client_id_mismatch` | The `client_id` member is not byte for byte the fetched URL |
| `missing_client_name` | No `client_name`, or it is empty |
| `missing_redirect_uris` | No `redirect_uris`, or the list is empty |
| `invalid_redirect_uri` | A redirect URI is not `https` or loopback `http`, or it has a fragment or a custom scheme |
| `unsupported_token_endpoint_auth_method` | Use `none` or `private_key_jwt` |
| `private_key_jwt_requires_jwks` | Publish `jwks` or an `https` `jwks_uri` |
| `invalid_grant_types` | `grant_types` must be an array of strings |
| `fetch_rate_limited` | More than 10 fetch attempts for this URL in one minute. Fix the document, wait, try again |
| `client_id_collision` | A registered application in the organization already uses this `client_id` |
| `cimd_disabled_for_tenant` | The organization switched CIMD off. Ask its admin to switch it on, or register the client |
| `domain_not_allowed` | The organization allows only listed domains. Ask its admin to add the domain |
| `cimd_not_in_plan` | The organization's plan does not include CIMD (see https://docs.lumoauth.dev/pricing-matrix) |
| `client_disabled` | An admin blocked this client. The document is valid. Ask the organization to unblock it |

Other surprises:

- **A scope never appears on the consent screen.** It was dropped. The check tool lists it under `dropped_scopes`.
- **A loopback redirect is refused although the document is valid.** The organization's loopback policy is `block`. The check tool lists the URI under `dropped_redirect_uris`.
- **No `refresh_token` in the token response.** `grant_types` does not list `refresh_token`.
- **A change is not picked up.** A valid document is cached. Lower `max-age`, or run a check with `"refresh": true`.
- **An error page in place of a redirect.** Until the signed-in user has approved the client, LumoAuth shows authorization errors (for example a missing `code_challenge`) on its own page with HTTP `400` and does not redirect them to the client.

## Local development

LumoAuth fetches documents only from public `https` hosts, so `https://localhost/…` is rejected with `unsafe_url`.

1. Host the file somewhere public and run the client locally. The file is static. A loopback redirect (`http://127.0.0.1/callback`) keeps the rest on the machine.
2. Or expose a local port through an HTTPS tunnel and use the tunnel URL plus a path as `client_id`. A new tunnel host name is a new client, so users consent again.

## What the organization's admin controls

All settings are under **Security → Sign-in settings → Platform security** in the portal and in the Admin API's `settings/auth` resource.

| Setting | Key | Default | Meaning |
|---|---|---|---|
| Client ID metadata documents (CIMD) | `cimd_enabled` | `true` | Master switch. Off means that only registered applications can sign users in |
| Allowed domains | `cimd_allowed_domains` | empty: any public `https` host | Restrict `client_id` URLs to listed domains and their subdomains |
| Localhost redirect URIs | `cimd_localhost_redirect_policy` | `warn` | `warn` adds a consent warning for a loopback redirect. `block` drops loopback redirect URIs |
| Extra scopes | `cimd_allowed_scopes` | `[]` | Scopes beyond the identity set that CIMD clients may ask for (Admin API only) |

**Block one client:** **Applications → External clients (CIMD)**, then **Block** on the client's row (needs `clients.edit`). The client can no longer start a sign-in or refresh a token, LumoAuth stops fetching its document, and every token that the client holds in the organization is revoked. **Unblock** lets it sign users in again; the revoked tokens stay revoked. A resource server that validates JWTs locally accepts a revoked access token until it expires, so keep the MCP server's token lifetime short.

An MCP server with **Allowed clients** set to chosen applications does not accept a CIMD client that is not on the list. With **Any client in this organization**, every CIMD client that passes the trust policy can ask for a token.
