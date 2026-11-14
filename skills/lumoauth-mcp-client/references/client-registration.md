# How an MCP client identifies itself: registered applications and dynamic registration

Read this file when the client cannot use a Client ID Metadata Document: it needs a pre-registered application, a custom-scheme redirect URI, or dynamic client registration. For metadata documents, read `client-id-metadata-documents.md`.

## The three methods

| | Client ID Metadata Document | Pre-registered application | Dynamic client registration |
|---|---|---|---|
| `client_id` | The `https://` URL of the document | `client_…`, issued by LumoAuth | Issued by the registration call |
| Who sets it up | The client's publisher, once, for every organization | An admin of the organization, in the portal | The client, through the API |
| Default in LumoAuth | On | Always available | Off |
| Status in MCP 2026-07-28 | Preferred | Supported | Deprecated |
| Loopback redirect (`http://127.0.0.1/…`) | Yes, unless the organization blocks it | Yes | Yes, with `application_type: "native"` |
| Custom-scheme redirect (`myapp://…`) | No | Ask the organization's admin | Yes, with `application_type: "native"` |
| Grants without a user (`client_credentials`) | Never | A separate **Machine to machine** application | Not covered here |

The authorization server metadata shows what an organization accepts: `client_id_metadata_document_supported: true` for metadata documents and `registration_endpoint` for dynamic registration.

## Pre-registered application

An organization admin creates the application. It changes the organization, so show the user the plan first.

1. In the portal open **Applications**, click **New application** and choose **Single-page or mobile app**. This type is a public client: it has no secret and must use PKCE.
2. Set **Application name** and **Redirect URI**. The redirect URI must equal the one that the client sends, character for character.
3. Click **Create application** and copy the **Client ID** (`client_…`).
4. On the **Configuration** tab, set **Scopes** to every scope that the client sends: the MCP server's scopes (`mcp:read`), the identity scopes that it asks for (`openid profile email`), and `offline_access` if the client adds it. Click **Save configuration**.

Check these settings of the application when token requests fail:

- **Resource indicators** (Configuration tab). When the list of allowed resource URIs is not empty, it must hold the MCP server's Resource URI. Otherwise the request fails with `invalid_target` and the text `Resource '…' is not registered for this client`. An empty list allows any resource.
- **Access token format.** The MCP server packages verify JWT access tokens and refuse opaque ones. Keep the application on JWT access tokens.
- **Grant types.** The application receives refresh tokens only when its grant types include `refresh_token`.
- **Allowed clients on the MCP server.** When the server lists chosen clients, the admin must add this application there.

Give the Client ID to the MCP client. Examples for Claude Code and the FastMCP client are in `SKILL.md`. A Client ID is not a secret, but it belongs to one organization: do not reuse it elsewhere.

## Redirect URI rules

LumoAuth validates every redirect URI of a client that registers itself or identifies itself with a metadata document:

| URI | Dynamically registered client | CIMD client |
|---|---|---|
| `https://…` with a host | Accepted for `application_type: web` (the default), rejected for `native` | Accepted |
| `http://localhost`, `http://127.0.0.1`, `http://[::1]` (any port, any path) | Accepted for `native`, rejected for `web` | Accepted, unless the organization's loopback policy is `block` |
| `http://` on any other host | Rejected (`invalid_redirect_uri`) | Rejected |
| Custom scheme such as `com.example.app:/callback` | Accepted for `native`, rejected for `web` | Rejected |
| `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`, `about:` | Never accepted | Never accepted |
| A URI with a fragment, whitespace, quotes or control characters | Rejected | Rejected |

For an application that an admin registers in the portal, the redirect URI that the client sends must be one of the application's registered URIs.

Loopback ports: LumoAuth accepts a changing port on `http://127.0.0.1` and `http://[::1]` for every application, and on `http://localhost` for a public application (no client secret). For a confidential application with `localhost`, register the exact port and give the client a fixed callback port. A CIMD document lists the loopback URI without a port; for a public client any port matches at run time.

## Dynamic client registration

Use it only for a client that cannot do anything else. Revision 2026-07-28 of the MCP specification deprecates it, and LumoAuth keeps it for older clients. The documentation names ChatGPT connectors as a client that still uses it.

It is off by default. While it is off, a registration request is refused with `403 access_denied` and the text `Dynamic client registration is not enabled`. An organization admin switches it on under **Security → Sign-in settings** (**Dynamic client registration**; in the Admin API `dynamic_client_registration_enabled`).

By default, a registration request also needs an initial access token that an admin issues. An API key with the scope `admin:clients:register` works too. An organization can allow anonymous registration by setting `require_initial_access_token` to `false` in its sign-in settings; weigh that carefully, because anyone can then create clients in the organization.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/connect/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INITIAL_ACCESS_TOKEN" \
  -d '{
    "client_name": "My MCP Client",
    "application_type": "native",
    "redirect_uris": ["http://127.0.0.1:8765/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'
```

- `application_type: "native"` is required for loopback and custom-scheme redirect URIs. The default `web` accepts only `https`.
- `token_endpoint_auth_method: "none"` creates a public client. It still sends the returned `client_id` on every token request, and it uses PKCE.
- A registration with one forbidden redirect URI fails with `invalid_redirect_uri`, and nothing is stored.
- A dynamically registered client never receives `admin`, `admin:*`, `*:write`, `mcp:*` or `offline_access`, even when it asks for them.
- LumoAuth does not process a `software_statement`.
- The registration is bound to the issuer that created it. Use the client only with that organization.

`lumoauth-oauth-oidc` covers dynamic client registration and client management in general.

## Which method for which client

- You publish an MCP client for many organizations: host a metadata document.
- You connect a third-party MCP client that accepts a client ID: pre-register an application.
- An organization wants to control exactly which clients reach a server: pre-register applications and list them under **Allowed clients** on the MCP server.
- A client can only self-register: the admin switches dynamic registration on and issues an initial access token.
- An agent or a backend service without a user: none of these. Register an agent (`lumoauth-agent-identity`) and use token exchange (`agent-tokens.md`).
