# Client reference (Go)

`lumoauth.Client` is the API client for server-side code. Build it with `lumoauth.New`, or get one
for the signed-in user from `auth.ClientForRequest(req)`. A `Client` is safe for concurrent use:
build it once and share it.

## Build a client

```go
package main

import (
	"log"
	"os"
	"time"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	client, err := lumoauth.New(
		lumoauth.WithBaseURL("https://app.lumoauth.dev"),
		lumoauth.WithOrgID("acme-corp"),
		lumoauth.WithAPIKey(os.Getenv("LUMOAUTH_API_KEY")),
		lumoauth.WithTimeout(10*time.Second),
	)
	if err != nil {
		log.Fatal(err) // *lumoauth.ConfigError when no credential is configured
	}
	log.Print(client.BaseURL(), " ", client.OrgID())
}
```

| Option | Sets | Default |
|---|---|---|
| `WithBaseURL(url)` | LumoAuth region URL | `$LUMOAUTH_URL`, then `https://app.lumoauth.dev` |
| `WithOrgID(slug)` | Organization slug | `$LUMOAUTH_ORG_ID` |
| `WithAPIKey(key)` | Organization API key, sent as `X-API-Key` | `$LUMOAUTH_API_KEY` |
| `WithAccessToken(token)` | A fixed bearer token | none |
| `WithTokenProvider(fn)` | `func(ctx) (string, error)` that returns a bearer token for each request | none |
| `WithTimeout(d)` | Timeout of each request | 30 seconds |
| `WithHTTPClient(c)` | Your own `*http.Client` | a new client |
| `WithHeader(name, value)` | An extra header on every request | none |
| `WithUserAgent(ua)` | The `User-Agent` header | `lumoauth-go/<version>` |
| `WithDPoP(signer)` | Binds tokens that the client obtains to a DPoP key | off |

`New` needs an API key, an access token or a token provider. A value in code wins over the
environment variable. When a token and an API key are both configured, the SDK sends the token
only.

## Which credential works where

| Credential | Sent as | Accepted on |
|---|---|---|
| Organization API key (`lmk_...`) | `X-API-Key` | Permission checks, `Zanzibar.Check` and `Expand`, the Admin API, client registration. Not ABAC, agent or JIT routes. |
| User access token | `Authorization: Bearer` | Calls about the signed-in user. Some need a scope (below). |
| Agent credential | `Authorization: Bearer` | Agent, approval, JIT and MCP calls, and the permission checks. See `lumoauth-agent-identity`. |

An API key acts for the organization member who created it. Create it in the portal under
**API keys** and tick only the scopes that the service needs. Add `authz:check` when the service
asks about other users.

## Permissions (RBAC)

| Method | Returns | Needs |
|---|---|---|
| `Check(ctx, permission, opts)` | `(bool, error)` | any credential |
| `CheckDetailed(ctx, permission, opts)` | `(*PermissionCheck, error)` | any credential |
| `CheckBulk(ctx, permissions, opts)` | `(*PermissionBulkCheck, error)`; `Results` maps slug to bool | any credential |
| `CheckAny(ctx, permissions, opts)`, `CheckAnyDetailed` | true when at least one is granted | any credential |
| `CheckAll(ctx, permissions, opts)`, `CheckAllDetailed` | true when all are granted | any credential |
| `List(ctx)`, `ListSlugs(ctx)` | every permission of the caller | user token with `authz:read` |

`opts` is `*lumoauth.CheckOptions` or nil:

| Field | Meaning |
|---|---|
| `Context map[string]any` | Attributes for policies that apply to the same decision. |
| `UserID string` | Ask about another user. It is the LumoAuth user ID (a UUID, the `sub` claim). Needs `authz:check`. |
| `AgentID string` | Ask about an agent (`agt_...`). Needs `authz:check`. Set at most one of `UserID` and `AgentID`. |

```go
bulk, err := client.Permissions.CheckBulk(ctx, []string{"document.read", "document.edit"}, nil)
if err != nil {
	return err
}
canEdit := bulk.Results["document.edit"]
```

## Zanzibar (ReBAC)

Objects are `type:id`. Subjects are `type:id` or `type:id#relation`.

| Method | Returns | Needs |
|---|---|---|
| `Check(ctx, object, relation, subject)` | `(bool, error)` | any credential; another subject needs `authz:check` |
| `CheckDetailed(ctx, object, relation, subject)` | `(*ZanzibarCheck, error)` | same |
| `IsViewer`, `IsEditor`, `IsOwner`, `IsMember`, `IsAdmin` `(ctx, object, subject)` | `Check` with a fixed relation | same |
| `Expand(ctx, object, relation)` | `(*ZanzibarUsersetNode, error)`: `Type` (`union`, `intersection`, `leaf`), `Children`, `Subjects` | `authz:check` scope or `authz.check` permission |

Relation constants: `RelationViewer`, `RelationEditor`, `RelationOwner`, `RelationMember`,
`RelationAdmin`. A malformed object or subject returns a `*ValidationError` before any request.

## ABAC

ABAC calls need an organization ID and a user access token. API keys are refused.

```go
client, err := auth.ClientForRequest(req) // WebConfig.Scope includes abac:read
if err != nil {
	return err
}
decision, err := client.Abac.Check(req.Context(), lumoauth.AbacCheckParams{
	ResourceType: "document",
	Action:       "read",
	ResourceID:   "doc-123",
	Context:      map[string]any{"pep": map[string]any{"ip": "203.0.113.7"}},
})
if err != nil {
	return err
}
if !decision.Allowed {
	log.Printf("denied: %s", decision.Reason)
}
```

| Method | Needs |
|---|---|
| `Check(ctx, params)` returns `*AbacDecision` (`Allowed`, `Reason`, `MatchedPolicies`) | `abac:read` |
| `IsAllowed(ctx, params)` returns bool | `abac:read` |
| `CheckBulk(ctx, checks)` returns `[]AbacDecision` in request order; at most `AbacMaxBulkRequests` (100) | `abac:read` |
| `MyAttributes(ctx)`, `ResourceAttributes(ctx, type, id)`, `AttributeDefinitions(ctx, attributeType)` | `abac:read` |
| `SetUserAttribute(ctx, userID, slug, value)`, `SetResourceAttribute(ctx, type, id, slug, value)` | `abac:write` and the `abac.manage` permission |

`AbacCheckParams.Context` is sent as the request's `environment`. LumoAuth sets `ip`, `userAgent`,
`requestMethod` and `requestPath` from the request that it receives from your server. Values that
you send under those names are kept under `pep`, so send the end user's IP address as
`{"pep": {"ip": ...}}` and write policies against `pep.ip`. In `CheckBulk`, every entry must carry
the same `Context` or none; otherwise the SDK returns a `*ValidationError`.

`AttributeDefinitions` takes `AttributeTypeUser`, `AttributeTypeResource`,
`AttributeTypeEnvironment` or `""` for all types.

## OAuth calls (`client.Auth`)

`WebAuth` uses these internally. Call them directly only when the app manages its own sessions.

| Method | Purpose |
|---|---|
| `AuthorizationURL(params)` | Builds the authorization URL. `CodeChallenge` enables PKCE with `S256`. |
| `ExchangeCode(ctx, params)` | Exchanges the authorization code (`Code`, `RedirectURI`, `ClientID`, `ClientSecret`, `CodeVerifier`). |
| `RefreshToken(ctx, params)` | Redeems a refresh token. |
| `ClientCredentials(ctx, clientID, clientSecret, scopes...)` | Machine-to-machine grant. |
| `Revoke(ctx, params)` | Revokes an access or refresh token. |
| `UserInfo(ctx, accessToken)` | Returns the OpenID Connect UserInfo claims; `Raw` holds every claim. |

Token and revocation calls authenticate with the client ID and secret in the form body. They never
send the client's API key or bearer token. When you build the flow yourself, generate a random
`state`, store it server-side, compare it on the callback, and always send a PKCE challenge.

## Any other endpoint

```go
path, err := client.OrgPath("/admin/users") // /orgs/acme-corp/api/v1/admin/users
if err != nil {
	return err
}
var page struct {
	Data []map[string]any `json:"data"`
}
if err := client.Do(ctx, http.MethodGet, path, nil, &page); err != nil {
	return err
}
```

`Do(ctx, method, path, body, out)` sends the client's credential and maps errors like every other
call. `DoRaw` returns the `*http.Response`; close its body. `client.APIConfig(ctx)` returns the
base URL, one credential header and the HTTP client for the generated client
`github.com/lumoauth/api-clients/go`. For the Admin API itself use `lumoauth-admin-api`.

## Errors

| Sentinel (`errors.Is`) | Meaning | `lumoauth.ErrorCode(err)` |
|---|---|---|
| `ErrLumoAuth` | Any error from the SDK | the code below |
| `ErrAPI` | Any response that is not 2xx | `API_ERROR` or the code in the body |
| `ErrAuthentication` | 401 | `AUTHENTICATION_ERROR` |
| `ErrPermissionDenied` | 403 | `PERMISSION_DENIED`, or the code in the body such as `forbidden` |
| `ErrNotFound` | 404 | `NOT_FOUND` |
| `ErrRateLimited` | 429 | `RATE_LIMITED` |
| `ErrValidation` | Bad input, or a response that the SDK cannot use | `VALIDATION_ERROR` |
| `ErrConfig` | A required option is missing | `CONFIG_ERROR` |
| `ErrNetwork` | No HTTP response (DNS, TLS, timeout, cancelled context) | `NETWORK_ERROR` |

Concrete types for `errors.As`: `*APIError` (`StatusCode`, `Body`, `RetryAfter`, `RequiredScopes`,
plus `Code` and `Message`), `*ValidationError` (`Issues`, `Reason`), `*ConfigError`,
`*NetworkError`. Helpers: `lumoauth.AsAPIError(err)`, `lumoauth.StatusCode(err)`,
`lumoauth.ErrorCode(err)`.

A permission check that is denied is not an error: `Check` returns `false, nil`. An error means
that the question could not be answered. Deny access in that case.

The approval and budget errors (`ErrApprovalDenied`, `ErrApprovalTimeout`,
`ErrApprovalNotDelivered`, `ErrBudgetExceeded`) belong to agents; see `lumoauth-agent-approvals`.

## Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `LUMOAUTH_URL` | `New`, `NewWebAuth` | Region URL |
| `LUMOAUTH_ORG_ID` | `New`, `NewWebAuth` | Organization slug |
| `LUMOAUTH_API_KEY` | `New` | Organization API key |
