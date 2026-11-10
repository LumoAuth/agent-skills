# Error responses, scope design and audience design

How an API answers a request that it does not accept, and how to design the scopes and the
audience so that the checks stay simple.

## Status codes

| Situation | Status | Meaning for the client |
|---|---|---|
| No credential | `401` | Get a token |
| Token invalid: malformed, bad signature, expired, wrong issuer, wrong audience, wrong type | `401` | Get a new token; a retry with the same token will fail |
| Token valid, but it lacks the scope | `403` | Ask for a token with the scope; the user may have to consent |
| Token valid, scope present, but this caller may not touch this object | `403` (or `404` when the existence of the object is itself private) | Do not retry |
| The sign-in is too old or too weak for this operation | `401` with a step-up challenge | Send the user through a new authorization request |
| Two credentials, or the token in the query string | `400` | Fix the request |

Use `401` only for problems with the credential and `403` only for a valid credential that is not
allowed. Clients decide whether to refresh the token from this difference.

## The `WWW-Authenticate` header

Every `401` carries the header. A `403` for a missing scope carries it too.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api"
```

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"
```

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer realm="api", error="insufficient_scope", scope="write:reports"
```

Rules:

- When the request has no credential at all, send no `error` attribute.
- `error` is one of `invalid_request` (`400`), `invalid_token` (`401`) or `insufficient_scope`
  (`403`).
- `scope` lists the scope that the route needs, space-separated when there are several.
- Keep `error_description` generic. Do not say whether the signature, the issuer or the audience
  failed; write the reason to the server log without the token.
- Add `Cache-Control: no-store` to responses that depend on the token.

Body: a small JSON object is enough, for example `{"error": "insufficient_scope"}`. Clients read
the status and the header.

## Step-up: a stronger or more recent sign-in

User access tokens from an authorization code exchange carry `auth_time`, `amr` and, when a second
factor was completed, `acr`. A route that needs a recent or strong sign-in checks these claims
and answers with a step-up challenge:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="insufficient_user_authentication", error_description="A recent sign-in with a second factor is required", acr_values="urn:lumoauth:acr:mfa", max_age=600
```

The client then runs a new authorization request with the same `acr_values` and `max_age` and
calls again with the new token. LumoAuth's `acr` values, from strongest to weakest:

| `acr` | Satisfied by |
|---|---|
| `urn:lumoauth:acr:mfa:phr` | A passkey |
| `urn:lumoauth:acr:mfa:strong` | Push approval in the LumoAuth app, or stronger |
| `urn:lumoauth:acr:mfa` | An authenticator app, or stronger |
| `urn:lumoauth:acr:mfa:basic` | A text message or email code, or stronger |

A token from a refresh has no `auth_time`, `acr` or `amr`. Treat missing claims as "not met" and
send the challenge. For MFA setup see `lumoauth-mfa-passkeys`.

## Scope design

A scope says what an application may do at an API on behalf of its caller. It is coarse on
purpose.

| Guideline | Example |
|---|---|
| Name scopes by resource and action | `read:reports`, `write:reports`, `delete:reports` |
| One scope per route group, not per route | All `GET /reports/*` routes need `read:reports` |
| Separate reading from writing | A reporting tool gets only `read:reports` |
| Keep dangerous actions in their own scope | `delete:reports`, `admin:billing` |
| Do not encode object IDs or tenants in scopes | Not `read:report:4821`. Use an authorization check for objects |
| Match scope strings exactly | Split the `scope` claim on spaces and compare whole strings; no prefix matching |
| Give each application the smallest set | Under **Configuration → Allowed scopes** |

Facts about scopes in LumoAuth:

- Custom scopes are created with `POST {base}/orgs/{orgId}/api/v1/admin/scopes` and are unique
  per organization. A name that exists, or that equals a system scope, answers `409`.
- An application can request only the scopes in its **Allowed scopes**. A request for another
  scope fails with `invalid_scope`.
- For user tokens, the user sees the requested scopes on the consent page.
- The `scope` field of the token response and the `scope` claim are what was granted.
- Avoid names that LumoAuth uses for its own APIs: `openid`, `profile`, `email`, `phone`,
  `address`, `offline_access`, `admin`, names that start with `admin:`, `authz:`, `mfa:`, `abac:`,
  `mcp:` or `jit:`.

Scopes answer "may this application do this kind of thing". They do not answer "may this user
edit this report". After the scope check, decide per object with roles, attributes or
relationships: `lumoauth-authorization` explains the choice, and `lumoauth-rbac`, `lumoauth-abac`
and `lumoauth-rebac` the models.

## Audience design

The audience binds a token to one API, so a token for API A cannot be replayed at API B.

| Guideline | Detail |
|---|---|
| One identifier per API | An absolute `https` URI, for example `https://api.example.com`. No fragment. `http` is accepted only for loopback and private-network hosts |
| The API checks `aud` on every request | A string, or an array when the token names several resources |
| Callers send `resource` | In the authorization request and the token request for user tokens; in the token request for client credentials |
| Register identifiers per application | **Configuration → Resource indicators**. An entry without a trailing slash matches exactly. An entry that ends in `/` also allows every URI under it. An empty list allows any resource |
| Ask for one resource per token | A token for several resources can be replayed between them |

An authorization request can name several resources. The client then asks the token endpoint for
a token for one of them (`resource=...` with the code or the refresh token); the result must be
within what was granted, otherwise the answer is `invalid_target`. See
`lumoauth-oauth-advanced` for the full rules.

Without `resource`, `aud` is the client ID of the application. If the API must accept such
tokens, it keeps a list of the client IDs that may call it and checks `aud` or `client_id`
against the list.

## Access token lifetime

The lifetime is set per application (**Security → Token settings → Lifetimes**). A shorter
lifetime narrows the window in which a revoked or stolen token still passes offline validation.
Choose it with the user; do not hard-code an expectation in the API. The API reads `exp`.

## Sources

- https://docs.lumoauth.dev/oauth/scopes
- https://docs.lumoauth.dev/oauth/resource-indicators
- https://docs.lumoauth.dev/oauth/authorize
- https://docs.lumoauth.dev/api-reference/authentication
