# Access token claims

What a LumoAuth JWT access token contains, by token kind. Use this file to decide which claims an
API may rely on.

An application can also be set to issue opaque access tokens (**Applications → your app →
Security → Token settings**). An opaque token is a random string without claims; validate it with
introspection.

## JOSE header

| Header | Value |
|---|---|
| `typ` | `at+jwt` on every access token |
| `alg` | The algorithm of the organization's signing key: one of `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512` |
| `kid` | The ID of the signing key. Find the key with this ID in the JWKS |

Other JWTs that the same organization key signs have another type and must be refused as access
tokens: ID tokens (`typ` is `JWT`) and back-channel logout tokens (`typ` is `logout+jwt`).

## Claims on every access token

| Claim | Type | Value |
|---|---|---|
| `iss` | string | The issuer: `{base}/orgs/{orgId}/api/v1`, or the bare custom domain. Equal to the discovery `issuer` |
| `sub` | string | Who the token is about. See the table below |
| `aud` | string or array of strings | The resource that the token is for. One `resource` gives a string; several give an array. Without `resource` it is the client ID |
| `exp` | number | Expiry, seconds since the epoch |
| `iat` | number | Issue time |
| `jti` | string | Unique token ID |
| `client_id` | string | The application (or agent) that obtained the token |
| `scope` | string | Granted scopes, separated by single spaces. Absent when no scope was granted |

| Token kind | `sub` |
|---|---|
| User (authorization code, refresh, device, CIBA grants) | The user's ID as a string |
| Machine (client credentials grant) | `client_` followed by the client ID |
| AI agent | `agent_` followed by the agent ID |

## Optional claims

| Claim | When present | Value |
|---|---|---|
| `nbf` | When the application's JWT claims include it; always on agent tokens | Not-before time |
| `cnf` | The token is bound to a DPoP key | `{"jkt": "<JWK thumbprint>"}`. The caller must prove possession of the key on every request |
| `auth_time` | User tokens from an authorization code exchange, when the sign-in time is known | When the user signed in |
| `acr` | User tokens from an authorization code exchange, when a second factor was completed in the session | For example `urn:lumoauth:acr:mfa` |
| `amr` | User tokens from an authorization code exchange | Sign-in methods, for example `["pwd", "otp", "mfa"]` |
| `act` | Delegated tokens from token exchange | The actor: `{"sub": "...", "iss": "...", "sub_profile": "user" or "ai_agent"}`, with a nested `act` for each earlier actor |

An access token that comes from a refresh token request does not carry `auth_time`, `acr` or
`amr`. An API that needs them asks the client for a new sign-in (see the step-up response in
`responses-and-scope-design.md`).

## User tokens

| Claim | Condition |
|---|---|
| `email`, `email_verified` | The `email` scope was granted |
| `name` | The `profile` scope was granted and the user has a name |
| `given_name`, `family_name`, `middle_name`, `nickname`, `preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`, `zoneinfo`, `locale`, `updated_at` | The `profile` scope was granted, the application's JWT claims include the claim, and the user has a value |
| `phone_number`, `phone_number_verified` | The `phone` scope was granted and the application's JWT claims include them |
| `address` | The `address` scope was granted and the application's JWT claims include it |
| `roles` | Only when **User roles** is explicitly enabled in the application's JWT claims. An array of role names |
| `tenant_id` | The internal numeric ID of the organization. Use `iss` to identify the organization |
| `org_id`, `org_slug`, `org_name`, `org_role` | The user signed in to a customer organization of which the user is an active member. See `lumoauth-b2b-saas` |
| Static custom claims | Configured per application under **Security → Token settings → JWT claims → Static custom claims (JSON)**. They cannot use a name that LumoAuth sets itself |

The application's JWT claims settings can only remove claims from what the scopes allow. They
never add a claim that the granted scopes do not cover.

Example payload of a user token for one API:

```json
{
  "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "sub": "4821",
  "aud": "https://api.example.com",
  "exp": 1767229200,
  "iat": 1767225600,
  "jti": "9f2c4e5a7b8d4c1e9a3f6b2d8c7e5f41",
  "client_id": "<client_id>",
  "scope": "openid email read:reports",
  "auth_time": 1767225590,
  "amr": ["pwd"],
  "email": "user@example.com",
  "email_verified": true,
  "tenant_id": 12
}
```

## Machine tokens (client credentials)

| Claim | Value |
|---|---|
| `sub` | `client_<client_id>` |
| `client_id`, `azp` | The client ID |
| `gty` | `client_credentials` |
| `scope` | The requested scopes, or all of the application's allowed scopes when the request named none |

```json
{
  "iss": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "sub": "client_<client_id>",
  "aud": "https://api.example.com",
  "exp": 1767229200,
  "iat": 1767225600,
  "jti": "5d1e8a...",
  "client_id": "<client_id>",
  "scope": "read:reports",
  "azp": "<client_id>",
  "gty": "client_credentials"
}
```

To tell a machine token from a user token, check `gty` or the `client_` prefix of `sub`. Do not
assume that `sub` is a user.

## AI agent tokens

| Claim | Value |
|---|---|
| `sub` | `agent_<agent_id>` |
| `client_id` | The agent ID |
| `is_agent` | `true` |
| `name` | The agent's name |
| `capabilities` | The agent's capabilities, when it has any |
| `scope` | The scopes of this token |
| `aud` | The `resource` that the agent requested; otherwise the organization slug |

A token in which a user is the subject and an agent acts for the user has the user's `sub` and an
`act` claim with the agent's `agent_<agent_id>`. For agent credentials and delegation use
`lumoauth-agent-identity` and `lumoauth-agent-delegation`.

## What an API should rely on

- Identity: `iss` + `sub`. Store both when you keep a record about a caller.
- Authorization: `aud`, `scope`, and `client_id` when only some applications may call the API.
- Strength of the sign-in: `acr`, `amr`, `auth_time`, for routes that need a recent or strong
  sign-in.
- Do not rely on: `email` as an identifier (it can change), `roles` for decisions that must
  follow a role change at once (the token keeps its content until `exp`), or any claim from a
  token that failed validation.

## Sources

- https://docs.lumoauth.dev/oauth/token-management
- https://docs.lumoauth.dev/oauth/clients
- https://docs.lumoauth.dev/oauth/resource-indicators
