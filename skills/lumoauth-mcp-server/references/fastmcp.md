# `lumoauth-fastmcp` reference

Read this file when a Python FastMCP server needs more than the quick start in `SKILL.md`: a provider argument, a custom domain, several workers with DPoP, step-up approval for a tool, or the Token Vault helper.

## Package

| | |
|---|---|
| PyPI name | `lumoauth-fastmcp` |
| Version described here | 1.3.1 |
| Python | 3.10 or later |
| Installs | `fastmcp>=4.1,<5`, `lumoauth[verify]>=1.4.0` |
| Import | `lumoauth_fastmcp` |

Public names (`lumoauth_fastmcp.__all__`): `LumoAuthProvider`, `current_caller`, `require_scopes`, `require_agent`, `require_user`, `require_jit`, `ensure_jit`, `LumoToolPolicy`, `ClientCredentialsToken`, `LumoVaultClient`, `VaultToken`, `LumoAccessToken`, `Registration`, `InsufficientAuthorizationDetailsError`, `scope_covered`, `missing_scopes`, `capability_covered`, `authorization_detail_covered`, `missing_authorization_details`, `build_authorization_detail`, `lumo_claims`, `current_traceparent`, `current_trace_id`, `parse_traceparent`, `normalize_resource`, `same_resource`, `resolve_vault_user_id`, `DEFAULT_LUMOAUTH_URL`.

## `LumoAuthProvider` arguments

Every argument is keyword-only and optional. Most fall back to an environment variable.

| Argument | Environment variable | Default and meaning |
|---|---|---|
| `org_id` | `LUMOAUTH_ORG_ID` | The organization slug. Required unless `issuer` is set |
| `server_id` | `LUMOAUTH_MCP_SERVER_ID` | The registered server id (`mcp_…`). With it, the provider fetches the registration once at start-up |
| `resource` | `LUMOAUTH_MCP_RESOURCE` | The Resource URI. Needed only without `server_id`. When both are given they must name the same resource |
| `lumoauth_url` | `LUMOAUTH_URL` | `https://app.lumoauth.dev`. Set `https://eu.app.lumoauth.dev` for the EU region |
| `issuer` | `LUMOAUTH_ISSUER` | `{lumoauth_url}/orgs/{org_id}/api/v1`. Set it for a custom domain |
| `client_id`, `client_secret` | `LUMOAUTH_MCP_CLIENT_ID`, `LUMOAUTH_MCP_CLIENT_SECRET` | The MCP server's own OAuth client, for `tool_policy()` |
| `agent_token` | `LUMOAUTH_AGENT_TOKEN` | An agent credential for `vault_token()` |
| `base_url` | none | This server's public base URL. Default: the origin of the Resource URI |
| `required_scopes` | none | Scopes that every request must carry. A granted `prefix:*` scope satisfies them |
| `scopes_supported` | none | Scopes to advertise in the metadata and the challenge. Default: the registration's basic scopes |
| `require_dpop` | none | Refuse tokens that are not DPoP-bound. Default: the registration's **Require DPoP** switch |
| `resource_name`, `resource_documentation` | none | Extra metadata fields |
| `registration` | none | A registration document (or a `Registration`) to use in place of the fetch, for tests |
| `fetch` | none | `fetch(url) -> dict` for the registration, discovery and JWKS requests |
| `replay_cache` | none | Store for DPoP proof ids. Default: in memory, per process |
| `clock_skew` | none | Seconds of leeway on `exp`, `nbf` and proof times. Default 60 |
| `request_url` | none | `request_url(scope) -> str` builds the public URL of a request for the DPoP `htu` check |
| `authorization_server_metadata` | none | Default `True`: also serve LumoAuth's metadata at `/.well-known/oauth-authorization-server` of this server, for older clients |

The provider raises `LumoAuthConfigError` (from `lumoauth.errors`) at construction when the organization is missing, when the Resource URI cannot be determined, when LumoAuth has no active server with that id, or when the server is registered as Public.

## What the provider adds to the server

- A route for the protected resource metadata. Its path is the well-known segment plus the path of the Resource URI: for `http://localhost:8000/mcp` it is `/.well-known/oauth-protected-resource/mcp`. The document holds `resource`, `authorization_servers` (the organization's issuer), `bearer_methods_supported`, `scopes_supported`, and the two `dpop_*` members when DPoP is required.
- A `401` challenge that points to that document and names the basic scopes. When a token is rejected, the challenge states the reason. With DPoP required, the challenge uses the `DPoP` scheme and lists `algs`.
- Local verification of each token: signature against the organization's keys, issuer, audience (compared in LumoAuth's normal form, so a trailing slash does not matter), expiry, the `at+jwt` type, and refusal of portal test tokens. A DPoP-bound token must arrive with the `DPoP` scheme and a valid proof for the request.
- Only JWT access tokens are accepted. An opaque token is refused: set the client application to the JWT access token format.

`provider.verify_claims(token, dpop=None)` verifies a token synchronously and returns `lumoauth.verify.AccessTokenClaims`, for custom routes. `provider.protected_resource_metadata()` returns the document, and `provider.resource_metadata_url` its URL.

## The caller

`current_caller()` returns `lumoauth.verify.AccessTokenClaims`, or `None` on a transport without OAuth (stdio, in-memory clients).

| Property | Meaning |
|---|---|
| `caller.sub` | The user id, or `agent_agt_…` for an agent |
| `caller.is_agent`, `caller.agent_id` | `True` for an AI agent, and its `agt_…` id |
| `caller.is_delegated`, `caller.actor` | `True` when an agent acts for the user `caller.sub`; `actor` is the agent's `sub` |
| `caller.scopes`, `caller.capabilities` | Granted scopes; the agent's capabilities |
| `caller.client_id` | The OAuth client (the agent id for an agent token) |
| `caller.is_jit`, `caller.authorization_details` | A just-in-time approval and its granted details |
| `caller.traceparent`, `caller.trace_id` | The validated W3C `traceparent` header of the request and its trace id |
| `caller.claims` | Every verified claim |

```python
import logging

from fastmcp import FastMCP
from lumoauth_fastmcp import LumoAuthProvider, current_caller

log = logging.getLogger("invoices")
mcp = FastMCP("Invoices", auth=LumoAuthProvider())


@mcp.tool
def whoami() -> dict:
    """Show who LumoAuth says is calling."""
    caller = current_caller()
    if caller is None:
        return {"transport": "stdio"}
    if caller.is_agent:
        log.info("agent %s", caller.agent_id)
    elif caller.is_delegated:
        log.info("agent %s for user %s", caller.actor, caller.sub)
    return {"subject": caller.sub, "agent": caller.agent_id, "actor": caller.actor, "scopes": list(caller.scopes)}
```

## Checks

`require_scopes(*scopes)`, `require_agent(*capabilities)` and `require_user(*, allow_delegation=False)` return FastMCP auth checks. Pass them to `auth=` of `@mcp.tool`, `@mcp.resource` or `@mcp.prompt`, or to `AuthMiddleware`.

- As `auth=` on a component, a failed check hides the component from the caller.
- In `AuthMiddleware(auth=require_scopes(...))`, a missing scope becomes an `insufficient_scope` step-up, so the client can ask the user for the scope.
- `require_scopes()` needs at least one scope. A granted scope that ends in `:*` covers the scopes under that prefix (`invoices:*` covers `invoices:refund`). Every other scope compares exactly, so `invoices.*` is an ordinary scope.
- `require_agent("billing.reminders")` admits only agent tokens that hold every listed capability. Capabilities match as LumoAuth stores them: lower case, with `:` and `-` read as `.`; `users.*` covers `users.delete`.
- `require_user()` admits people only. `require_user(allow_delegation=True)` also admits an agent that acts for a person.

## `auth.tool_policy()`: per-tool policy from LumoAuth

`auth.tool_policy(**options)` returns the `LumoToolPolicy` middleware. It needs `LUMOAUTH_MCP_CLIENT_ID` and `LUMOAUTH_MCP_CLIENT_SECRET` (the setup is in `per-tool-authorization.md`) and raises `LumoAuthConfigError` without them.

```python
from fastmcp import FastMCP
from lumoauth_fastmcp import LumoAuthProvider

auth = LumoAuthProvider()
mcp = FastMCP("Invoices", auth=auth, middleware=[auth.tool_policy()])
```

| Option | Default | Meaning |
|---|---|---|
| `cache_ttl` | `30.0` | Seconds to keep a decision. A change in LumoAuth takes effect within this time. `0` disables the cache |
| `filter_list` | `True` | Remove from `tools/list` the tools that the caller may not run |
| `max_concurrency` | `8` | Parallel questions while a list is filtered |
| `jit` | none | `{tool_name: requirement}`: also require a just-in-time approval for these tools |
| `server_id`, `org_id`, `lumoauth_url`, `client_id`, `client_secret` | from the provider | Overrides |

The middleware asks with the server's own client-credentials token (scope `mcp:authorize`) and never with the caller's token. Decisions fail closed: when LumoAuth cannot be reached, the tool is refused. Requests without OAuth (stdio, in-memory) are not checked.

## Step-up approval for a tool (just-in-time permissions)

A tool can require a short-lived approval for one action in addition to the standing token. The approval is an RFC 9396 `authorization_details` entry, which the caller presents inside its MCP token or as a second token in the `X-LumoAuth-Jit-Token` header. The provider verifies that token against the organization's keys and accepts it only when its `sub` equals the caller's `sub` or `actor`.

```python
from fastmcp import FastMCP
from lumoauth_fastmcp import LumoAuthProvider, ensure_jit

mcp = FastMCP("Invoices", auth=LumoAuthProvider())


@mcp.tool
def refund(invoice_id: str) -> str:
    """Refund one invoice. Needs an approval for this invoice."""
    ensure_jit("payment_initiation", actions=["refund"], identifier=invoice_id)
    return f"Refunded {invoice_id}"
```

- `ensure_jit(type, *, actions=None, locations=None, identifier=None)` runs inside the tool, so the requirement can depend on the arguments. The tool stays visible in `tools/list`.
- `require_jit(type, *, actions=None, locations=None, identifier=None)` is the same check for `@mcp.tool(auth=...)`. As a component check it hides the tool until the caller holds the approval.
- `auth.tool_policy(jit={"refund": {"type": "payment_initiation", "actions": ["refund"]}})` keeps the tool visible and checks at `tools/call`.
- A missing approval raises `InsufficientAuthorizationDetailsError`. The HTTP answer is `403` with `error="insufficient_authorization_details"` and an `Insufficient-Authorization-Details` header that holds the required details (base64 JSON), so the agent can request the approval and retry.

How an agent requests the approval is in `lumoauth-agent-approvals`.

## DPoP

With **Require DPoP** on, the provider accepts only DPoP-bound tokens and challenges with the `DPoP` scheme. A bound token is checked on every server, whatever the switch says.

- Proof ids are stored per process to stop replays. With several workers, pass a shared store: `LumoAuthProvider(replay_cache=store)`. The store has one method, `check_and_add(key, ttl)`. It returns `True` for a key that it already holds (a replay). Otherwise it stores the key for `ttl` seconds and returns `False`.
- The proof's `htu` must equal the URL that the client called. The provider builds that URL from the origin of the Resource URI and the request path, which suits a TLS-terminating proxy that keeps paths. For a proxy that rewrites paths, pass `request_url=`.

## Tracing

When a request carries a W3C `traceparent` header, the package validates it and exposes it as `current_caller().traceparent` and `.trace_id` (also `current_traceparent()` and `current_trace_id()`). `tool_policy()` forwards the header to LumoAuth, which records the trace id on the `mcp.tool.authorization` audit event. LumoAuth stores the id for correlation; it does not emit spans.

## Token Vault helper

`auth.vault_token(connection_id, *, user_id=None)` returns a `VaultToken` (`.access_token`, `.headers()`) for an outbound API such as GitHub. It calls `POST {issuer}/agents/me/connections/{connection_id}/token`, and that endpoint accepts only an agent's credential: set `LUMOAUTH_AGENT_TOKEN`. For a person or a delegated agent, the helper sends `user_id = caller.sub`; for an autonomous agent it asks for the agent's own connection. Tokens are cached until 30 seconds before they expire. Connections and their grants are in `lumoauth-agent-delegation`.

## Errors at start-up and at run time

| Message | Cause | Fix |
|---|---|---|
| `LumoAuthProvider needs the organization` | `LUMOAUTH_ORG_ID` is not set | Export it in the shell that starts the server |
| `LumoAuthProvider needs this server's Resource URI` | No server id, `resource` or `base_url` | Set `LUMOAUTH_MCP_SERVER_ID` |
| `LumoAuth has no active MCP server` | Wrong server id, slug or region | Copy them from the portal; set `LUMOAUTH_URL` for the EU region |
| `resource … is not the Resource URI … registered` | `LUMOAUTH_MCP_RESOURCE` differs from the registration | Remove the variable or correct it |
| `the tool policy asks LumoAuth as the MCP server itself` | `tool_policy()` without client credentials | Set `LUMOAUTH_MCP_CLIENT_ID` and `LUMOAUTH_MCP_CLIENT_SECRET` |
| Log line `Refused a token that is not a JWT` | The client application issues opaque tokens | Switch the application to JWT access tokens |
| The client reports `Protected resource … does not match expected …` | The client connects to `127.0.0.1` while `localhost` is registered (FastMCP's start-up banner prints `127.0.0.1`) | Connect to the Resource URI exactly |
