---
name: lumoauth-go
description: >-
  Adds LumoAuth to Go web apps and services with the Go SDK github.com/lumoauth/lumo-auth-go:
  browser sign-in (OAuth 2.1 authorization code with PKCE and a cookie session) through
  NewWebAuth, WebConfig, Router, Middleware, RequireAuth, RequireAuthRedirect and UserFromContext
  on net/http, chi or gorilla/mux; server-side RBAC, Zanzibar (ReBAC) and ABAC checks through
  lumoauth.New and Client.Permissions, Client.Zanzibar and Client.Abac; local verification of
  access tokens on a Go API with RequireAccessToken and VerifyAccessToken; and error handling with
  errors.Is. Use when the user asks to add login, logout, sessions, protected routes, permission
  checks or bearer token validation to a Go or Golang project, mentions lumo-auth-go, WebAuth,
  ClientForRequest, RefreshSession or `lumo init --framework go`, or calls LumoAuth from a Go
  backend. Not for AI agent identity or AAuth in Go; the agent skills cover those.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Go

Add LumoAuth sign-in to a Go web app, check permissions from Go code, and verify LumoAuth access
tokens on a Go API. The SDK is one module, `github.com/lumoauth/lumo-auth-go`, imported as
`lumoauth`. It needs Go 1.22 or later and has one dependency (`github.com/gorilla/sessions`).

## When to use

- A Go web app needs login, logout and a session (`net/http`, chi, gorilla/mux, or any router that
  accepts `http.Handler`).
- A Go service needs to ask LumoAuth whether a user may do something (RBAC, Zanzibar, ABAC).
- A Go API receives LumoAuth access tokens and must verify them.

Do not use this skill for:

- AI agents written in Go (`NewAgent`, approvals, JIT, delegation): use `lumoauth-agent-identity`,
  `lumoauth-agent-approvals` and `lumoauth-agent-delegation`.
- AAuth signed requests (`NewAAuthClient`, `VerifyAuthToken`): use `lumoauth-aauth`.
- An MCP server in Go: use `lumoauth-mcp-server` (it uses the same `RequireAccessToken` middleware).
- A Go app that uses another OIDC library: use `lumoauth-oauth-oidc`.

## Before you start

Collect these values. Ask the user for any value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU). Ask which region the organization is in. |
| Organization slug | The `{orgId}` in the portal URL `/orgs/{orgId}/portal/`, for example `acme-corp`. |
| Client ID and client secret | An OAuth application in the organization (see below). The secret is shown once. |
| Redirect URI | `{app origin}/auth/callback`. In development: `http://localhost:3000/auth/callback`. In production: `https://app.example.com/auth/callback`. |
| Session secret | You generate it: `openssl rand -hex 32`. Keep it the same across restarts. |
| API key (`lmk_...`) | Only for server-side checks without a signed-in user. Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`). |

Create or find the OAuth application in one of these ways:

- Portal: **Applications → New application**, choose **Web application**, enter the redirect URI,
  click **Create application**. Copy the client secret from the page that opens next. The portal's
  **Quickstarts** page has a **Go** tab that shows the values for the organization.
- CLI: show the user this command before you run it, because it creates an application.

```bash
lumo login --org acme-corp
lumo apps list
lumo apps create --name "My Go app" \
  --redirect-uris http://localhost:3000/auth/callback -o json
```

The JSON output contains `clientId` and `secret`. The secret is not shown again. Put it in the
environment of the server, never in source control, logs or browser code.

The redirect URI must match a registered URI exactly (scheme, host, port, path). The portal and
the CLI accept `http://` only for `localhost`, `127.0.0.1` and `[::1]`. Every other host needs
`https://`.

## Steps

### 1. Install

```bash
go get github.com/lumoauth/lumo-auth-go
```

To start a new project instead, scaffold a chi starter and skip to step 4:

```bash
lumo login --org acme-corp
lumo init --framework go --dir ./my-app --client-id "$LUMO_CLIENT_ID"
cd ./my-app && go get github.com/lumoauth/lumo-auth-go@latest && go mod tidy && go run .
```

The scaffold writes `main.go`, `go.mod`, `.gitignore` and a `.env` that holds the base URL, the
organization slug, the client ID and a generated `SESSION_SECRET`. Add `LUMO_CLIENT_SECRET` to
`.env` for a confidential client.

### 2. Set the environment

```bash
export LUMO_BASE_URL=https://app.lumoauth.dev
export LUMO_ORG_ID=acme-corp
export LUMO_CLIENT_ID=...        # from the OAuth application
export LUMO_CLIENT_SECRET=...    # from the OAuth application; server only
export SESSION_SECRET=...        # openssl rand -hex 32
export LOCAL_HTTP=1              # development over http://localhost only
export PORT=3000
```

These names are read by the code in step 3. When `BaseURL` or `Organization` is empty, the SDK
falls back to `LUMOAUTH_URL` (then `https://app.lumoauth.dev`) and `LUMOAUTH_ORG_ID`.

### 3. Add sign-in (net/http)

```go
package main

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	auth, err := lumoauth.NewWebAuth(lumoauth.WebConfig{
		BaseURL:       os.Getenv("LUMO_BASE_URL"),
		Organization:  os.Getenv("LUMO_ORG_ID"),
		ClientID:      os.Getenv("LUMO_CLIENT_ID"),
		ClientSecret:  os.Getenv("LUMO_CLIENT_SECRET"),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		// The session cookie is Secure by default. Plain-HTTP localhost needs it off.
		CookieSecure: lumoauth.Bool(os.Getenv("LOCAL_HTTP") != "1"),
	})
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()

	// /auth/login, /auth/callback and /auth/logout.
	mux.Handle("/auth/", auth.Router())

	// HTML page: anonymous visitors are sent to sign in and come back afterwards.
	mux.Handle("/dashboard", auth.Middleware(
		auth.RequireAuthRedirect("/auth/login")(http.HandlerFunc(dashboard))))

	// JSON route: anonymous callers get 401.
	mux.Handle("/api/me", auth.Middleware(auth.RequireAuth(http.HandlerFunc(me))))

	mux.HandleFunc("/", home)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func home(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, `<a href="/auth/login?return_to=/dashboard">Sign in</a>`)
}

func dashboard(w http.ResponseWriter, r *http.Request) {
	user := lumoauth.UserFromContext(r.Context())
	fmt.Fprintf(w, `<h1>Hello %s</h1><a href="/auth/logout">Sign out</a>`,
		html.EscapeString(user.Email))
}

func me(w http.ResponseWriter, r *http.Request) {
	user := lumoauth.UserFromContext(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"sub": user.Sub, "email": user.Email})
}
```

What the SDK does:

- `/auth/login` creates a PKCE pair (S256) and a random `state`, stores them in the session and
  redirects to LumoAuth. `?return_to=/path` sets the page to return to; only local paths are
  accepted.
- `/auth/callback` compares `state`, exchanges the code, calls UserInfo and stores the user and the
  tokens in the session.
- `/auth/logout` revokes the refresh token, clears the session and redirects to
  `PostLogoutRedirect` (default `/`).
- `auth.Middleware` only reads the session into the request context. It does not block anyone.
  `auth.RequireAuth` (401) and `auth.RequireAuthRedirect(loginPath)` (redirect) must run inside it.
- `lumoauth.UserFromContext(ctx)` returns `*lumoauth.User` (`Sub`, `Email`, `EmailVerified`, `Name`,
  `GivenName`, `FamilyName`, `Picture`) or nil.

The session cookie (`lumo_session`) is `HttpOnly` and `SameSite=Lax`. It is signed with
`SessionSecret` and holds the user and the tokens.

Read [references/web-auth.md](references/web-auth.md) for the chi variant, every `WebConfig` field,
token refresh, reverse proxies and mounting the three handlers one by one.

### 4. Check a permission for the signed-in user

`ClientForRequest` returns a `*lumoauth.Client` that sends the user's own access token, so the
check is about that user.

```go
func editDocument(auth *lumoauth.WebAuth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client, err := auth.ClientForRequest(r)
		if err != nil {
			http.Error(w, "sign in first", http.StatusUnauthorized)
			return
		}
		allowed, err := client.Permissions.Check(r.Context(), "document.edit", nil)
		if err != nil {
			log.Printf("permission check failed: %v", err) // never log the token
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if !allowed {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		fmt.Fprint(w, "saved")
	})
}
```

Mount it with `mux.Handle("/documents/edit", auth.Middleware(auth.RequireAuth(editDocument(auth))))`.
Deny when the check returns an error. For roles, groups and permission design use `lumoauth-rbac`.

### 5. Check from a backend service (no browser session)

```go
package main

import (
	"context"
	"fmt"
	"log"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY.
	client, err := lumoauth.New()
	if err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()

	// RBAC for another user. UserID is the LumoAuth user ID (the `sub` of the user's tokens).
	allowed, err := client.Permissions.Check(ctx, "invoice.approve",
		&lumoauth.CheckOptions{UserID: "01a176cb-4095-7bb1-b3fe-7a9b8943e0cf"})
	if err != nil {
		log.Fatal(err)
	}

	// Zanzibar: is this user a viewer of the document?
	canView, err := client.Zanzibar.Check(ctx, "document:readme", lumoauth.RelationViewer,
		"user:01a176cb-4095-7bb1-b3fe-7a9b8943e0cf")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(allowed, canView)
}
```

Rules that the server applies:

- An organization API key works on the permission checks, `Zanzibar.Check`, `Zanzibar.Expand` and
  the Admin API. It does not work on the ABAC, agent or JIT routes.
- A check about someone other than the caller (`CheckOptions.UserID`, `CheckOptions.AgentID`, a
  Zanzibar subject that is not the caller, `Zanzibar.Expand`) needs the `authz:check` scope on the
  API key or token, or the `authz.check` permission. Without `CheckOptions`, an API key check is
  about the member who created the key.
- ABAC (`client.Abac`) needs a user access token with `abac:read`. Add the scope to
  `WebConfig.Scope` and call it through `auth.ClientForRequest(r)`.

Read [references/client.md](references/client.md) for the options of `lumoauth.New`, every method
of `Permissions`, `Zanzibar` and `Abac`, the scopes that each call needs, `Client.Do` for other
endpoints, and the full error table. Model design belongs to `lumoauth-authorization`,
`lumoauth-rebac` and `lumoauth-abac`.

### 6. Verify access tokens on a Go API

Use this on a service that receives `Authorization: Bearer <access token>` from other clients. It
verifies JWT access tokens locally against the organization's keys.

```go
protect := lumoauth.RequireAccessToken(lumoauth.AccessTokenVerifyOptions{
	Issuer:   lumoauth.IssuerFor("https://app.lumoauth.dev", "acme-corp"),
	Resource: "https://api.example.com", // must appear in the token's aud
})
mux.Handle("/reports", protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	claims, ok := lumoauth.AccessTokenFromContext(r.Context())
	if !ok || !claims.HasScope("read:reports") {
		http.Error(w, "insufficient scope", http.StatusForbidden)
		return
	}
	fmt.Fprintf(w, "reports for %s", claims.Subject)
})))
```

The middleware checks the `at+jwt` type, the signature, `iss`, `exp`, `nbf` and that `aud` contains
`Resource`. A missing or invalid token gets 401 with a `WWW-Authenticate` header. The client must
request the token with `resource=https://api.example.com`, or the API URI must be registered as the
application's audience. Local verification does not see revocation.

Read [references/verify-access-tokens.md](references/verify-access-tokens.md) for a complete
program with imports, the claims, the
rejection reasons, key caching, custom domains and DPoP-bound tokens. For how clients get such
tokens and for introspection, use `lumoauth-api-protection`.

### 7. Handle errors

Every SDK error matches `lumoauth.ErrLumoAuth`. Match with `errors.Is` and read details with
`errors.As`.

```go
var apiErr *lumoauth.APIError
switch {
case errors.Is(err, lumoauth.ErrAuthentication): // 401: credential missing, invalid or expired
case errors.Is(err, lumoauth.ErrPermissionDenied): // 403
	if errors.As(err, &apiErr) && len(apiErr.RequiredScopes) > 0 {
		log.Printf("token lacks scopes: %v", apiErr.RequiredScopes)
	}
case errors.Is(err, lumoauth.ErrRateLimited): // 429: wait for apiErr.RetryAfter
case errors.Is(err, lumoauth.ErrNetwork): // no response from LumoAuth
}
```

A denied check is `false, nil`, not an error. The sentinels and error types are listed in
`references/client.md`.

## Verify

1. Run `go run .` and open `http://localhost:3000/dashboard`. The browser goes to the LumoAuth
   login page of the organization, then returns to `/auth/callback` and shows the dashboard.
2. `curl -i http://localhost:3000/api/me` without a cookie returns `401 unauthenticated`.
3. Open `/auth/logout`, then `/dashboard` again. The browser is sent to sign in.
4. For the API: `curl -i http://localhost:8080/reports` returns 401 with `WWW-Authenticate`.
   With `-H "Authorization: Bearer $TOKEN"` and a token for this resource it returns 200.
5. For a backend check: run the program in step 5 with a known user ID and a permission that the
   user holds, then with one that the user does not hold.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows a redirect URI error | The URI that the app sends is not registered exactly | Register `{origin}/auth/callback` with the same scheme, host and port. Behind a proxy, see `references/web-auth.md`. |
| `no login in progress` or `CSRF state mismatch` on the callback | The session cookie did not come back: `Secure` cookie over plain HTTP, or login started on `localhost` and the callback used `127.0.0.1` | Set `CookieSecure: lumoauth.Bool(false)` for local HTTP only, and use one host name. |
| Every user is signed out after a restart or deploy | `SessionSecret` changes at each start | Load a fixed secret from the environment. Share it between replicas. |
| `RequireAuth` always answers 401 | It runs without `auth.Middleware` around it | Wrap as `auth.Middleware(auth.RequireAuth(h))`. |
| `could not save the session: ... the value is too long` | The signed cookie exceeds the 4096-byte limit of the cookie store | Request fewer scopes and remove unused custom claims from the application's tokens. |
| `token exchange failed` on the callback | Wrong or missing client secret for a confidential client | Use the secret of this client ID. Leave `ClientSecret` empty only for a public client. |
| 401 from `client.Abac` with an API key | ABAC routes do not accept API keys | Call ABAC with the user's token (`ClientForRequest`) and the `abac:read` scope. |
| 403 with `RequiredScopes` `["authz:read"]` from `Permissions.List` | The token lacks the scope; an API key cannot hold it | Add `authz:read` to `WebConfig.Scope` and sign in again. |
| 403 `INSUFFICIENT_PERMISSIONS` with `CheckOptions.UserID` | The caller may only ask about itself | Give the API key the `authz:check` scope. |
| 404 `SUBJECT_NOT_FOUND` | `UserID` is an email or a local ID | Pass the LumoAuth user ID (`user.Sub`). |
| `wrong_audience` from `VerifyAccessToken` | The token was not issued for this API | Request the token with the `resource` parameter that equals `Resource`. |
| Calls fail after the access token expires | Nothing refreshed the session | Call `auth.RefreshSession` before `auth.Middleware`; see `references/web-auth.md`. |

Security rules for this integration:

- Keep `LUMO_CLIENT_SECRET`, `SESSION_SECRET` and API keys on the server. Never send them to the
  browser and never commit them.
- Never log access tokens, refresh tokens, ID tokens or the session cookie.
- Leave `CookieSecure` unset (true) in production. Do not use `SkipCertValidation`.
- Request only the scopes that the app uses.

## Related skills

- `lumoauth-getting-started`: organizations, regions and credentials.
- `lumoauth-cli`: `lumo login`, `lumo apps` and `lumo init` in detail.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac`, `lumoauth-authorization`: design the model that
  these checks read.
- `lumoauth-api-protection`: token validation rules, machine-to-machine clients and introspection.
- `lumoauth-oauth-oidc`: the protocol behind `WebAuth`, for other libraries.
- `lumoauth-agent-identity`, `lumoauth-aauth`, `lumoauth-mcp-server`: agents, AAuth and MCP in Go.

## References

- [references/web-auth.md](references/web-auth.md): `WebConfig`, chi, refresh, proxies, logout.
- [references/client.md](references/client.md): `lumoauth.New`, check methods, scopes, errors.
- [references/verify-access-tokens.md](references/verify-access-tokens.md): token verification.
- https://docs.lumoauth.dev/quickstarts/go
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/cli/init
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/user-guide/applications/api-keys
