# Tokens, scopes and claims

What the token endpoint returns, what each token contains, how to validate an ID token, and how
refresh tokens, UserInfo and revocation behave.

## Token response

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

| Field | Notes |
|---|---|
| `access_token` | A JWT by default. An application can be switched to opaque tokens under **Security → Token settings**. The client treats it as an opaque string either way |
| `token_type` | `Bearer`, or `DPoP` when the request carried a DPoP proof (see `lumoauth-oauth-advanced`) |
| `expires_in` | Lifetime of the access token in seconds. Set per application under **Security → Token settings → Lifetimes**. Use the value from the response |
| `scope` | The granted scopes |
| `refresh_token` | Only when the application has the `refresh_token` grant type and a refresh token lifetime above zero |
| `id_token` | Only when `openid` was granted |

## ID token

A signed JWT that states who signed in. It is for the client application only. Never send it to an
API as a bearer token: LumoAuth and correct resource servers refuse it.

| Claim | Value |
|---|---|
| `iss` | The discovery `issuer` |
| `sub` | The user's ID as a string. Stable; use it as the key for the user in the app's database |
| `aud` | The client ID |
| `iat`, `exp` | Issue time and expiry. An ID token expires one hour after it is issued |
| `nonce` | The `nonce` of the authorization request, when one was sent |
| `auth_time` | When the user signed in. Absent when the session was restored from the remember-me cookie; send `max_age` when you need it |
| `amr` | How the user signed in, for example `["pwd", "otp", "mfa"]` |
| `acr` | The strongest MFA tier completed in the session, for example `urn:lumoauth:acr:mfa`. Absent when no second factor was completed |
| `sid` | The LumoAuth session ID. Store it if the app handles back-channel or front-channel logout |
| `at_hash` | Hash of the access token issued with it |
| `name`, `given_name`, `family_name`, `middle_name`, `nickname`, `preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`, `zoneinfo`, `locale`, `updated_at` | With the `profile` scope, when the user has a value |
| `email`, `email_verified` | With the `email` scope |
| `phone_number`, `phone_number_verified` | With the `phone` scope |
| `address` | With the `address` scope |

The ID token never carries roles.

Validation, all steps required:

1. Verify the signature with the key from `jwks_uri` whose `kid` equals the token header's `kid`.
   Accept only asymmetric algorithms (`RS*`, `ES*`, `PS*`). Never accept `none` or `HS*`.
2. `iss` equals the discovery `issuer` exactly.
3. `aud` equals the client ID.
4. `exp` is in the future (allow at most a minute of clock difference).
5. `nonce` equals the value that the app stored before the redirect.
6. When the request asked for `max_age` or `acr_values`: check `auth_time` and `acr` yourself. Do
   not assume that the request was honoured.

Cache the JWKS. Fetch it again when a token carries an unknown `kid`: signing keys rotate, and a
replaced key stays in the JWKS for a grace period.

## Access token

Clients do not parse the access token. The API that receives it validates it; that is the subject
of `lumoauth-api-protection`. In short, a JWT access token has the header `typ: at+jwt` and
carries `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `client_id` and `scope`, plus user claims that
follow the granted scopes (`email` with `email`, `name` and the profile claims with `profile`).

`aud` is the client ID unless the request named an API with the `resource` parameter. To get a
token for one API, request `resource=https://api.example.com` (see `lumoauth-oauth-advanced`).

## Scopes

| Scope | Effect |
|---|---|
| `openid` | Required for an ID token and for UserInfo with a user token. Adds `sub` |
| `profile` | Name and profile claims |
| `email` | `email`, `email_verified` |
| `phone` | `phone_number`, `phone_number_verified` |
| `address` | `address` |
| `offline_access` | Accepted. It does not decide whether a refresh token is issued |
| Custom scopes, for example `read:reports` | Created in the organization and allowed per application. They appear in the access token's `scope` claim for the API to check |

Rules:

- A scope must be in the application's **Allowed scopes**. Otherwise the authorization request
  fails with `invalid_scope`.
- The `scope` field of the token response is what was granted.
- Role names are not requested with a scope. Tick **User roles** under **Applications → your app →
  Security → Token settings → JWT claims**; `roles` then appears in the access token and in
  UserInfo. The same section has **Static custom claims (JSON)** for fixed claims of your own; a
  custom claim cannot use the name of a claim that LumoAuth sets (`sub`, `aud`, `scope`, `roles`,
  `email` and so on).
- Scopes such as `admin`, `admin:users:read`, `authz:read` or `mfa:manage` unlock LumoAuth's own
  APIs. See `lumoauth-admin-api`. Do not add them to a customer-facing application without a
  reason.

## Refresh tokens

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN"
```

A public client sends `client_id` in the body and no secret.

| Behaviour | Detail |
|---|---|
| Rotation (default) | Each refresh returns a new `refresh_token` and invalidates the presented one |
| Reuse detection | Presenting an invalidated refresh token revokes the whole sign-in: every refresh token and access token that came from it |
| Static mode | An organization admin can switch confidential applications to static refresh tokens (**Security → Sign-in settings → OAuth security** for the organization, **Applications → your app → Security → Lifetimes** per application). The same token stays valid and refresh responses carry no `refresh_token`. Public clients always rotate |
| Lifetime | Each refresh token lives for the application's refresh token lifetime (**Security → Lifetimes**) |
| Absolute limit | The chain of refresh tokens from one sign-in has a fixed end (90 days after sign-in, or the application's refresh token lifetime when that is longer). Rotation never extends it. Afterwards the user signs in again |
| Early end | `invalid_grant` once the user is blocked, deactivated or deleted, signs out everywhere, or has the password changed or reset |
| Grant removed | An application that lost the `refresh_token` grant type gets `unauthorized_client` (HTTP 403) for a refresh token that it still holds |

Implementation rules:

- Write code that handles both modes: when the response has a `refresh_token`, replace the stored
  one; when it has none, keep the stored one.
- Serialize refreshes per session. Two parallel refreshes with the same rotating token look like
  theft and end the sign-in.
- On `invalid_grant`, delete the stored tokens and start a new authorization request.

## UserInfo

**GET** or **POST** `{issuer}/oauth/userinfo` with `Authorization: Bearer <access_token>`.

```json
{
  "sub": "12345",
  "name": "Jane Example",
  "email": "jane@example.com",
  "email_verified": true,
  "tenant": "acme-corp"
}
```

- The claims follow the token's scopes, like the ID token. Claims without a value are left out.
- `tenant` is the organization slug and is always present.
- `roles` is present only when the application enables **User roles**.
- A token from the client credentials grant returns `sub` (`client_<client_id>`), `client_id`,
  `name`, `tenant` and `identity_type: "client"`.

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | No `Authorization` header, or a scheme other than `Bearer` or `DPoP` |
| 401 | `invalid_token` | Token missing, expired, revoked or from another issuer; or the user was blocked, signed out everywhere or reset the password |
| 403 | `insufficient_scope` | A user token without `openid` |

Use the ID token for the sign-in itself and UserInfo for current profile data. Do not call
UserInfo on every request.

## Revoking tokens at sign-out

**POST** `{issuer}/oauth/revoke`, authenticated as the client that the token was issued to.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/revoke \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "token=$REFRESH_TOKEN" \
  -d "token_type_hint=refresh_token"
```

Revoking a refresh token also ends every access token of the same sign-in. The answer is `200`
with an empty JSON body whether or not the token existed; check the status and ignore the body. A public client sends `client_id` in the body.
An API that validates JWT access tokens offline keeps accepting a revoked token until `exp`; see
`lumoauth-api-protection` for introspection.

## Sources

- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/oauth/token-management
- https://docs.lumoauth.dev/oauth/scopes
- https://docs.lumoauth.dev/oauth/userinfo
- https://docs.lumoauth.dev/oauth/clients
