---
name: lumoauth-oauth-oidc
description: >-
  Integrates LumoAuth sign-in with any standard OAuth 2.0 / OpenID Connect (OIDC) library when no
  LumoAuth SDK fits: NextAuth / Auth.js, openid-client, oidc-client-ts, AppAuth, Authlib, Spring
  Security, passport, Django. Covers the issuer and discovery URL of an organization, every endpoint
  path, creating an OAuth application and choosing the client type (web, SPA, native,
  machine-to-machine), the authorization code flow with PKCE in raw HTTP, the token response, refresh
  tokens and rotation, ID token validation, userinfo, scopes and claims, RP-initiated, back-channel
  and front-channel logout, and dynamic client registration. Use when the user asks to add LumoAuth
  login with OIDC or OAuth, to configure an issuer or .well-known/openid-configuration, to fix a
  redirect URI, invalid_client, invalid_grant or issuer mismatch error, or to connect a generic OAuth
  client to LumoAuth.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth with a standard OAuth 2.0 / OpenID Connect library

LumoAuth is a standard OpenID Connect provider. Each organization has its own issuer, discovery
document and endpoints. With this skill you can connect any OIDC or OAuth 2.0 library to a LumoAuth
organization, or write the authorization code flow with PKCE by hand, using only standard settings:
issuer, client ID, client secret, redirect URI and scopes.

## When to use

- The project uses a generic OIDC or OAuth library (Auth.js, openid-client, oidc-client-ts, AppAuth,
  Authlib, Spring Security, passport, Django) or a language that has no LumoAuth SDK.
- The user asks for the issuer, the discovery URL, an endpoint path, a scope or a claim.
- The user reports an OAuth error: redirect URI mismatch, `invalid_client`, `invalid_grant`,
  issuer mismatch, missing `refresh_token`.

Do not use it when a LumoAuth SDK fits the framework. The SDK skill is shorter and safer:
`lumoauth-nextjs`, `lumoauth-react`, `lumoauth-vue`, `lumoauth-angular`, `lumoauth-react-native`,
`lumoauth-express`, `lumoauth-fastapi`, `lumoauth-python`, `lumoauth-go`, `lumoauth-aspnetcore`,
`lumoauth-spring-boot`, `lumoauth-laravel`, `lumoauth-symfony`, `lumoauth-php`.

- To validate access tokens in an API, or for machine-to-machine tokens, use
  `lumoauth-api-protection`.
- For PAR, DPoP, FAPI 2.0, resource indicators, CIBA, the device flow, `private_key_jwt`,
  introspection and revocation, use `lumoauth-oauth-advanced`.

## Before you start

Collect these values. Ask the user for a value that you cannot find. Never guess one.

| Value | Example | Where it comes from |
|---|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) | The region of the organization |
| Organization slug | `acme-corp` | The portal URL: `/orgs/acme-corp/portal` |
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` | `{base}/orgs/{orgId}/api/v1`; confirm it in discovery (step 1) |
| Client ID | value from the portal | Portal: **Applications → your app → Credentials** |
| Client secret | confidential clients only | Shown once when the application is created. Stored hashed. If it is lost, **Regenerate** it |
| Redirect URI | `http://localhost:3000/callback`, `https://app.example.com/callback` | The callback route of the app. Must be registered on the application, character for character |

If the organization uses a verified custom domain (for example `https://auth.acme.com`), the issuer
is the bare domain with no path. Use one entry point per application and read the issuer from that
entry point's discovery document.

Security rules for the whole integration:

- Keep the client secret on the server. Never put it in browser or mobile code. A browser or mobile
  app is a public client: client ID plus PKCE, no secret.
- Never log tokens, codes or secrets.
- Show the user every command that creates or changes an application before you run it.

## Steps

### 1. Read the discovery document

```bash
curl -s https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/openid-configuration
```

Send no `Authorization` header. Take every endpoint URL and the `issuer` from this document. Do not
build endpoint URLs by hand in application code. The paths on the organization entry point are:

| Discovery field | Path under `{base}/orgs/{orgId}/api/v1` |
|---|---|
| `authorization_endpoint` | `/oauth/authorize` |
| `token_endpoint` | `/oauth/token` |
| `userinfo_endpoint` | `/oauth/userinfo` |
| `jwks_uri` | `/.well-known/jwks.json` |
| `end_session_endpoint` | `/oauth/logout` |
| `revocation_endpoint` | `/oauth/revoke` |
| `introspection_endpoint` | `/oauth/introspect` |
| `registration_endpoint` | `/connect/register` |
| `device_authorization_endpoint` | `/oauth/device_authorization` |
| `pushed_authorization_request_endpoint` | `/oauth/par` |

Read `references/endpoints-and-discovery.md` for the full metadata list (supported scopes, response
modes, algorithms, authentication methods) and the custom-domain rules.

### 2. Create the application and choose the client type

In the portal open **Applications → New application** (`/orgs/{orgId}/portal/applications`), keep
**OpenID Connect**, enter a name, choose what the application is, and enter the redirect URI.

| The app is | Portal choice | Client type | Authentication at the token endpoint |
|---|---|---|---|
| Web app with a backend | **Web application** | Confidential | Client secret (HTTP Basic or form body) |
| Single-page app | **Single-page or mobile app** | Public | None: `client_id` and PKCE |
| Mobile, desktop or CLI app | **Single-page or mobile app** | Public | None: `client_id` and PKCE |
| Service without a user | **Machine to machine** | Confidential | Client secret; see `lumoauth-api-protection` |

The choice only presets the grant types, default scopes and whether the client has a secret. All
three can be changed on the application's **Configuration** tab. For a single-page app, also add
its origin under **Browser CORS origins** on that tab.

Redirect URI rules:

- The `redirect_uri` that the app sends must equal a registered URI exactly: scheme, host, port,
  path and query. No wildcards.
- `https` everywhere, except loopback hosts (`localhost`, `127.0.0.1`, `[::1]`), where `http` is
  accepted for development and for native apps. Native apps can also register a private-use
  scheme such as `com.example.app:/callback`.

Read `references/client-registration.md` to create the application through the Admin API or
through dynamic client registration.

### 3. Configure the library

Give the library these standard settings and nothing else:

| Setting | Value |
|---|---|
| Issuer (authority, issuer URI, server metadata URL) | The discovery `issuer`. The metadata URL is `{issuer}/.well-known/openid-configuration` |
| Client ID | From step 2 |
| Client secret | Confidential clients only, from an environment variable |
| Redirect URI | The registered callback URL |
| Response type | `code` (the only one that LumoAuth supports) |
| Scopes | `openid profile email` |
| PKCE | On, method `S256` (`plain` is refused) |
| Checks | `state` and `nonce` on. Leave issuer validation on |

Read `references/library-configs.md` for ready configuration of Auth.js (NextAuth), openid-client,
oidc-client-ts, Authlib and Spring Security. If the project has no OIDC library, continue with
step 4. Otherwise go to step 5.

### 4. Without a library: authorization code flow with PKCE

1. Create a random `state`, a random `nonce` and a PKCE `code_verifier` (43 to 128 URL-safe
   characters). Store all three in the user's server-side session.
   `code_challenge = BASE64URL(SHA256(code_verifier))`.
2. Redirect the browser to the authorization endpoint:

   ```text
   https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize
     ?response_type=code
     &client_id=CLIENT_ID
     &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
     &scope=openid%20profile%20email
     &state=STATE
     &nonce=NONCE
     &code_challenge=CODE_CHALLENGE
     &code_challenge_method=S256
   ```

   LumoAuth shows the organization's hosted login page, then the consent page when needed.
3. LumoAuth redirects to `redirect_uri` with `code`, `state` and `iss` (on errors: `error`,
   `error_description`, `state`, `iss`). Reject the response unless `iss` equals the discovery
   `issuer` and `state` equals the stored value. Then check for `error`.
4. Exchange the code on the server:

   ```bash
   curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
     -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
     -d "grant_type=authorization_code" \
     -d "code=$CODE" \
     -d "redirect_uri=https://app.example.com/callback" \
     -d "code_verifier=$CODE_VERIFIER"
   ```

   A public client sends `-d "client_id=$LUMOAUTH_CLIENT_ID"` in place of `-u` and no secret.
   `redirect_uri` is required and must equal the value from the authorization request. A code is
   single-use and short-lived.
5. Read the token response:

   ```json
   {
     "access_token": "eyJ...",
     "token_type": "Bearer",
     "expires_in": 3600,
     "scope": "openid profile email",
     "refresh_token": "...",
     "id_token": "eyJ..."
   }
   ```

   `refresh_token` is present only when the application has the `refresh_token` grant type.
   `id_token` is present when `openid` was granted. Use `expires_in` from the response; the
   access token lifetime is set per application.
6. Validate the ID token before you create a session: signature against `jwks_uri`, `iss` equal to
   the discovery `issuer`, `aud` equal to the client ID, `exp` in the future, `nonce` equal to the
   stored value.

Read `references/authorization-code-pkce.md` for a complete TypeScript implementation, every
authorization parameter (`prompt`, `max_age`, `login_hint`, `acr_values`, `ui_locales`) and the
error codes.

### 5. Use the tokens

- **Who signed in:** the ID token. `sub` is the stable user ID. `email` and `email_verified` need
  the `email` scope; `name` and the other profile claims need `profile`.
- **Current profile:** call UserInfo with the access token. A user token needs the `openid` scope.

  ```bash
  curl https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/userinfo \
    -H "Authorization: Bearer $ACCESS_TOKEN"
  ```

- **Calling an API:** send the access token as `Authorization: Bearer <token>`. The API validates
  it as described in `lumoauth-api-protection`.
- **Roles:** `roles` appears in access tokens and UserInfo only when **User roles** is ticked for
  the application under **Security → Token settings → JWT claims**. The ID token never carries
  roles. For permission checks use `lumoauth-rbac`.

### 6. Refresh the access token

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN"
```

Refresh tokens rotate by default: each response carries a new `refresh_token` and the old one
stops working. Store the new one before you use the new access token. If an old refresh token is
used again, LumoAuth revokes every token of that sign-in. On `invalid_grant`, send the user
through the authorization request again. The `offline_access` scope does not decide whether a
refresh token is issued; the application's `refresh_token` grant type does.

Read `references/tokens-and-claims.md` for the claims in each token, scopes, refresh token
lifetimes, static refresh tokens and revocation.

### 7. Sign out

1. Clear the app's own session.
2. Redirect the browser to the discovery `end_session_endpoint`:

   ```text
   https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/logout
     ?id_token_hint=ID_TOKEN
     &post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F
     &state=STATE
   ```

Register the post-logout redirect URI under **Applications → your app → Configuration → Logout**.
Without a valid `id_token_hint` for the signed-in user, LumoAuth asks the user to confirm and does
not redirect back. Do not link to the hosted `/logout` route: it needs a CSRF token that only
LumoAuth pages have. Read `references/logout.md` for back-channel and front-channel logout and
session monitoring.

## Verify

1. The discovery request in step 1 returns `200` and an `issuer` that equals the configured issuer.
2. Start a sign-in. The browser reaches `/orgs/{orgId}/login`, and the callback receives `code`,
   `state` and `iss`.
3. The token response contains `access_token` and `id_token`. Decode the ID token header and
   payload locally: `iss` is the issuer, `aud` is the client ID, `nonce` matches.
4. The UserInfo call in step 5 returns `sub` and the claims of the granted scopes.
5. Sign out, then start a sign-in again: the login page appears instead of an immediate redirect.

In the portal, **Applications → your app → Test sign-in** runs a sign-in against the application
without any code.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Library reports an issuer mismatch | Issuer configured as `https://app.lumoauth.dev` or without `/api/v1` | Use the discovery `issuer`: `{base}/orgs/{orgId}/api/v1`, or the bare custom domain |
| "Invalid Redirect URL" page at `/authorize` | `redirect_uri` differs from the registered value (port, trailing slash, path) | Register the exact URI. If a loopback `http` URI is still refused, set **Configuration → Application metadata → Application type** to **Native application** |
| `invalid_client` at the token endpoint | Wrong secret, secret sent for a public client, or the application is disabled | Regenerate the secret, send `client_id` alone for a public client, or enable the application |
| `invalid_grant` on the code exchange | Code used twice or expired, `redirect_uri` differs, or `code_verifier` does not match | Start a new authorization request and keep the verifier in the session |
| `invalid_request`: `code_challenge` missing | The application requires PKCE | Turn PKCE on in the library with method `S256` |
| `invalid_scope` | A requested scope is not in the application's **Allowed scopes** | Add the scope on the **Configuration** tab or remove it from the request |
| No `refresh_token` in the response | The application lacks the `refresh_token` grant type | Tick it under **Configuration → Grant types**. `offline_access` alone does nothing |
| `invalid_grant` on refresh after it worked once | A rotated refresh token was reused | Persist the new refresh token from every response; guard against parallel refreshes |
| UserInfo returns `403 insufficient_scope` | The access token lacks `openid` | Request `openid` |
| UserInfo returns only `sub` and `tenant` | Only `openid` was granted | Request `profile` and `email` |
| `403` with `bearer_not_accepted` when the library fetches metadata | The HTTP client sends an `Authorization` header to a page outside the API | Fetch discovery and JWKS without credentials |
| "Sign out" answers `403 Invalid CSRF token` | The app links to `/logout` | Use `end_session_endpoint` with `id_token_hint` |

## Related skills

- `lumoauth-api-protection`: validate the access token in the API that the app calls.
- `lumoauth-oauth-advanced`: PAR, DPoP, FAPI 2.0, resource indicators, device flow, CIBA.
- `lumoauth-login-methods` and `lumoauth-mfa-passkeys`: what the hosted login page offers.
- `lumoauth-branding`: the look of the hosted login and consent pages.
- `lumoauth-getting-started`: choose an SDK instead of a generic library.

## References

- [Endpoints and discovery](references/endpoints-and-discovery.md): every path and metadata value.
- [Client registration](references/client-registration.md): client types, Admin API, dynamic
  client registration.
- [Authorization code flow with PKCE](references/authorization-code-pkce.md): full parameters,
  TypeScript implementation, errors.
- [Tokens and claims](references/tokens-and-claims.md): token response, ID token, access token,
  scopes, refresh, UserInfo, revocation.
- [Logout](references/logout.md): RP-initiated, back-channel, front-channel, session monitoring.
- [Library configurations](references/library-configs.md): Auth.js, openid-client, oidc-client-ts,
  Authlib, Spring Security.
- https://docs.lumoauth.dev/oauth
- https://docs.lumoauth.dev/oauth/authorize
- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/oauth/security
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
