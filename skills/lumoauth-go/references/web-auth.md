# WebAuth reference (Go)

Details of browser sign-in with `lumoauth.NewWebAuth`. All names are in
`github.com/lumoauth/lumo-auth-go`, imported as `lumoauth`.

## WebConfig fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `BaseURL` | `string` | `$LUMOAUTH_URL`, then `https://app.lumoauth.dev` | LumoAuth region URL. EU: `https://eu.app.lumoauth.dev`. |
| `Organization` | `string` | `$LUMOAUTH_ORG_ID` | Organization slug. Required (directly or through the variable). |
| `ClientID` | `string` | none | OAuth client ID. Required. |
| `ClientSecret` | `string` | empty | Secret of a confidential client. Leave empty for a public client, which uses PKCE alone. |
| `SessionSecret` | `string` | none | Key of the cookie store. Required. Use at least 32 random bytes and keep it stable. |
| `CallbackPath` | `string` | `/auth/callback` | Absolute path of the callback. `{origin}{CallbackPath}` must be a registered redirect URI. |
| `Scope` | `string` | `openid profile email` | Scopes, separated by spaces. |
| `PostLoginRedirect` | `string` | `/` | Page after sign-in when no `return_to` was given. |
| `PostLogoutRedirect` | `string` | `/` | Page after sign-out. |
| `HTTPClient` | `*http.Client` | client with a 10 s timeout | Used for the token, UserInfo and revocation calls. |
| `CookieName` | `string` | `lumo_session` | Name of the session cookie. |
| `CookieSecure` | `*bool` | nil (true) | `Secure` flag of the cookie. Set `lumoauth.Bool(false)` only for plain-HTTP local development. |
| `SessionMaxAge` | `time.Duration` | 30 days | Lifetime of the session cookie. |
| `SkipCertValidation` | `bool` | false | Turns off TLS verification. Do not use it with the hosted service. |

`NewWebAuth` returns a `*ConfigError` (matches `lumoauth.ErrConfig`) when `Organization`, `ClientID`
or `SessionSecret` is missing.

## Routes and handlers

`auth.Router()` returns an `http.Handler` that serves three paths. The prefix is the directory of
`CallbackPath`, so the default gives `/auth/login`, `/auth/callback` and `/auth/logout`. The bare
paths `/login`, `/callback` and `/logout` are registered too, so the router also works behind
`http.StripPrefix`.

| Path | Behaviour |
|---|---|
| `/auth/login` | Starts the flow. Optional `?return_to=/local/path`. A value that does not start with one `/` is replaced by `PostLoginRedirect`. |
| `/auth/callback` | Answers 400 for an `error` parameter, a missing `code` or `state`, a missing login (`no login in progress`) or a different `state` (`CSRF state mismatch`). Answers 502 when the token exchange or UserInfo call fails. On success it redirects to the return page. |
| `/auth/logout` | Revokes the stored refresh token (best effort), expires the cookie, redirects to `PostLogoutRedirect`. |

`/auth/logout` ends the session of the Go app. It does not end the user's session at LumoAuth, so
the next `/auth/login` can complete without a password prompt. For sign-out at LumoAuth itself, see
`lumoauth-oauth-oidc` (logout endpoint and `id_token_hint`).

To wire routes yourself, mount the handlers one by one:

```go
package main

import (
	"log"
	"net/http"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	auth, err := lumoauth.NewWebAuth(lumoauth.WebConfig{
		Organization:  os.Getenv("LUMO_ORG_ID"),
		ClientID:      os.Getenv("LUMO_CLIENT_ID"),
		ClientSecret:  os.Getenv("LUMO_CLIENT_SECRET"),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		CallbackPath:  "/oauth/return",
	})
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/signin", auth.LoginHandler())
	mux.Handle("/oauth/return", auth.CallbackHandler())
	mux.Handle("/signout", auth.LogoutHandler())
	log.Fatal(http.ListenAndServe(":3000", mux))
}
```

Register `{origin}/oauth/return` as the redirect URI in that case.

## chi

`auth.Router()`, `auth.Middleware`, `auth.RequireAuth` and `auth.RequireAuthRedirect(...)` are plain
`net/http` types, so they fit chi without an adapter. This is what `lumo init --framework go`
scaffolds.

```go
package main

import (
	"fmt"
	"html"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	auth, err := lumoauth.NewWebAuth(lumoauth.WebConfig{
		BaseURL:       os.Getenv("LUMO_BASE_URL"),
		Organization:  os.Getenv("LUMO_ORG_ID"),
		ClientID:      os.Getenv("LUMO_CLIENT_ID"),
		ClientSecret:  os.Getenv("LUMO_CLIENT_SECRET"),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		CookieSecure:  lumoauth.Bool(os.Getenv("LOCAL_HTTP") != "1"),
	})
	if err != nil {
		log.Fatal(err)
	}

	r := chi.NewRouter()
	r.Mount("/auth", auth.Router())

	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware)

		r.With(auth.RequireAuthRedirect("/auth/login")).Get("/dashboard",
			func(w http.ResponseWriter, req *http.Request) {
				user := lumoauth.UserFromContext(req.Context())
				fmt.Fprintf(w, "<h1>Hello %s</h1>", html.EscapeString(user.Email))
			})

		r.With(auth.RequireAuth).Get("/api/me",
			func(w http.ResponseWriter, req *http.Request) {
				user := lumoauth.UserFromContext(req.Context())
				fmt.Fprintln(w, user.Sub)
			})
	})

	log.Fatal(http.ListenAndServe(":3000", r))
}
```

Install chi with `go get github.com/go-chi/chi/v5`.

## Session helpers

| Helper | Returns |
|---|---|
| `lumoauth.UserFromContext(ctx)` | `*lumoauth.User` or nil. Needs `auth.Middleware`. |
| `lumoauth.TokensFromContext(ctx)` | `*lumoauth.SessionTokens` or nil. Needs `auth.Middleware`. |
| `auth.User(req)` | `(*User, error)` read from the cookie, without `Middleware`. Nil user when nobody is signed in. |
| `auth.Tokens(req)` | `(*SessionTokens, error)` read from the cookie. |
| `auth.ClientForRequest(req)` | `(*Client, error)`: a client that sends the user's access token. `ConfigError` when nobody is signed in. |
| `auth.Client()` | `*Client` for the same region and organization, with no credential. |
| `auth.RefreshSession(w, req)` | `(bool, error)`: renews an expired access token; see below. |

`SessionTokens` has `AccessToken`, `RefreshToken`, `IDToken`, `TokenType`, `ExpiresAt`, `Scope` and
the method `Expired()`. Treat every field as a secret. Do not log or render them.

## Refresh an expired access token

The SDK does not refresh on its own. `RefreshSession` does nothing unless the stored access token
has expired and a refresh token exists. LumoAuth issues a refresh token when the application's
grant types include `refresh_token`.

`auth.Middleware` copies the tokens into the request context once. Run the refresh step before it,
so that `UserFromContext`, `TokensFromContext` and `ClientForRequest` see the new token.

```go
package web

import (
	"net/http"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

// WithSession refreshes the session when needed, then loads it into the context.
func WithSession(auth *lumoauth.WebAuth, next http.Handler) http.Handler {
	loaded := auth.Middleware(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.RefreshSession(w, r); err != nil {
			// The refresh token was refused. Start a new sign-in.
			http.Redirect(w, r, "/auth/login", http.StatusFound)
			return
		}
		loaded.ServeHTTP(w, r)
	})
}
```

Use it as `mux.Handle("/dashboard", web.WithSession(auth, auth.RequireAuth(handler)))`.

LumoAuth rotates refresh tokens by default. `RefreshSession` stores the new refresh token in the
session cookie, so two parallel requests with the same expired session can race: the second one
presents a refresh token that was already used. Keep the access token lifetime long enough for a
page load, or serialize refreshes per session in your app.

## Scopes

Set `WebConfig.Scope` to the scopes that the app uses as the user. Examples:

| Need | Scope string |
|---|---|
| Sign-in and profile | `openid profile email` |
| `Permissions.List` / `ListSlugs` as the user | `openid profile email authz:read` |
| `client.Abac` checks as the user | `openid profile email abac:read` |

The OAuth application must be allowed to request each scope. A missing scope shows up as 403 with
`APIError.RequiredScopes`.

## Behind a reverse proxy

The SDK builds the redirect URI from the incoming request: scheme from `X-Forwarded-Proto` (else
TLS or not), host from `X-Forwarded-Host` (else `Host`), then `CallbackPath`.

- Configure the proxy to set `X-Forwarded-Proto: https` and, when it rewrites the host,
  `X-Forwarded-Host`.
- Configure the proxy to overwrite these headers on every request, so that a client cannot supply
  its own values.
- Register the public URL (`https://app.example.com/auth/callback`) as the redirect URI.

## Cookie store limits

The session uses `gorilla/sessions` with a cookie store. The cookie is signed with `SessionSecret`
and not encrypted, and its encoded value is limited to 4096 bytes. The user, the access token, the
ID token and the refresh token all go into this one cookie. When sign-in fails with
`could not save the session: ... the value is too long`, reduce the token size: request fewer
scopes and remove unused custom claims from the application's token settings.
