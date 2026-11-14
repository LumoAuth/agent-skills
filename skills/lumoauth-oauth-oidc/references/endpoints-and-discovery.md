# Endpoints and discovery

Every LumoAuth organization is its own OpenID Connect provider. This file lists the issuer rules,
every endpoint path and the values in the discovery document.

## Issuer

| Entry point | `issuer` |
|---|---|
| Organization path, US region | `https://app.lumoauth.dev/orgs/{orgId}/api/v1` |
| Organization path, EU region | `https://eu.app.lumoauth.dev/orgs/{orgId}/api/v1` |
| Verified custom domain | `https://auth.acme.com` (the bare domain, no path) |

`{orgId}` is the organization slug, for example `acme-corp`.

The same string is the `issuer` in discovery, the `iss` claim of every access token, ID token and
logout token, the `iss` field of introspection responses and the `iss` parameter on authorization
responses. Compare it byte for byte. Do not add or remove a trailing slash.

Use one entry point per application. A token that was issued on the organization path carries the
organization-path issuer; a token that was issued on the custom domain carries the custom-domain
issuer.

## Discovery documents

| Document | URL |
|---|---|
| OpenID Connect discovery | `{issuer}/.well-known/openid-configuration` |
| OAuth 2.0 authorization server metadata | `{issuer}/.well-known/oauth-authorization-server` |
| The same two documents at the path-inserted location | `{base}/.well-known/openid-configuration/orgs/{orgId}/api/v1` and `{base}/.well-known/oauth-authorization-server/orgs/{orgId}/api/v1` |
| JSON Web Key Set | `{issuer}/.well-known/jwks.json` on the organization path; read `jwks_uri` from discovery |

The documents are public and cacheable for one hour (`Cache-Control: public, max-age=3600`).
Request them without an `Authorization` header. An unknown or inactive organization answers
`404` with `{"error": "invalid_tenant"}`.

## Endpoints

Paths are relative to `{base}/orgs/{orgId}/api/v1`. On a custom domain the `/orgs/{orgId}` prefix is
dropped; read the real URLs from discovery.

| Endpoint | Method | Path | Discovery field |
|---|---|---|---|
| Authorization | `GET`, `POST` | `/oauth/authorize` | `authorization_endpoint` |
| Token | `POST` | `/oauth/token` | `token_endpoint` |
| UserInfo | `GET`, `POST` | `/oauth/userinfo` | `userinfo_endpoint` |
| JWKS | `GET` | `/.well-known/jwks.json` | `jwks_uri` |
| Revocation | `POST` | `/oauth/revoke` | `revocation_endpoint` |
| Introspection | `POST` | `/oauth/introspect` | `introspection_endpoint` |
| End session (logout) | `GET`, `POST` | `/oauth/logout` | `end_session_endpoint` |
| Session check iframe | `GET` | `/oauth/check_session` | `check_session_iframe` |
| Dynamic client registration | `POST` | `/connect/register` | `registration_endpoint` |
| Read a dynamic registration | `GET` | `/connect/register/{clientId}` | returned as `registration_client_uri` |
| Pushed authorization requests | `POST` | `/oauth/par` | `pushed_authorization_request_endpoint` |
| Device authorization | `POST` | `/oauth/device_authorization` | `device_authorization_endpoint` |
| Device verification page (for the user) | `GET` | `/oauth/device` | returned as `verification_uri` |
| Backchannel authentication (CIBA) | `POST` | `/oauth/bc-authorize` | `backchannel_authentication_endpoint` |

The token endpoint accepts `application/x-www-form-urlencoded` (the standard) and JSON bodies.
Token responses carry `Cache-Control: no-store`.

## Metadata values

These are the values that the discovery document returns. Read them at run time when the library
needs them; this table exists so that you can check a configuration quickly.

| Field | Value |
|---|---|
| `response_types_supported` | `["code"]`. No implicit or hybrid flow |
| `response_modes_supported` | `query`, `fragment`, `form_post`, and the signed modes `jwt`, `query.jwt`, `fragment.jwt`, `form_post.jwt` |
| `grant_types_supported` | `authorization_code`, `refresh_token`, `client_credentials`, `urn:openid:params:grant-type:ciba`, `urn:ietf:params:oauth:grant-type:device_code`, `urn:ietf:params:oauth:grant-type:token-exchange` |
| `code_challenge_methods_supported` | `["S256"]` |
| `scopes_supported` | `openid`, `profile`, `email`, `phone`, `address`, `offline_access`, plus the scopes of the organization's active MCP servers. Custom scopes are valid in requests but are not listed |
| `subject_types_supported` | `["public"]` |
| `id_token_signing_alg_values_supported` | `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512`. The real algorithm is that of the organization's signing key; read `alg` from the token header and the key from JWKS |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `attest_jwt_client_auth`, `none` |
| `token_endpoint_auth_signing_alg_values_supported` | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512` |
| `introspection_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post` |
| `revocation_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `none` |
| `claims_supported` | `sub`, `iss`, `aud`, `exp`, `iat`, `auth_time`, `nonce`, `acr`, `amr`, `sid`, `at_hash`, `c_hash`, `name`, `given_name`, `family_name`, `middle_name`, `nickname`, `preferred_username`, `profile`, `picture`, `website`, `email`, `email_verified`, `gender`, `birthdate`, `zoneinfo`, `locale`, `phone_number`, `phone_number_verified`, `address`, `updated_at` |
| `claims_parameter_supported` | `false` |
| `prompt_values_supported` | `none`, `login`, `consent`, `create` |
| `ui_locales_supported` | `en`, `es`, `fr`, `de`, `pt-BR`, `it`, `nl`, `ja`, `ar` |
| `acr_values_supported` | `urn:lumoauth:acr:mfa:phr`, `urn:lumoauth:acr:mfa:strong`, `urn:lumoauth:acr:mfa`, `urn:lumoauth:acr:mfa:basic`, `urn:lumoauth:acr:pwd` (the same list for every organization) |
| `op_policy_uri`, `op_tos_uri` | The Privacy policy URL and Terms of service URL of the organization's login page; each only when it is set |
| `authorization_response_iss_parameter_supported` | `true` |
| `request_parameter_supported` | `true` (signed request objects) |
| `request_uri_parameter_supported` | `true`, but only for the `request_uri` that the PAR endpoint returns |
| `require_pushed_authorization_requests` | `false` (an application can require PAR for itself) |
| `dpop_signing_alg_values_supported` | `ES256`, `ES384`, `ES512`, `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `EdDSA` |
| `resource_indicators_supported` | `true` |
| `frontchannel_logout_supported`, `frontchannel_logout_session_supported` | `true` |
| `backchannel_logout_supported`, `backchannel_logout_session_supported` | `true` |
| `backchannel_token_delivery_modes_supported` | `["poll"]` |
| `backchannel_user_code_parameter_supported` | `false` |
| `client_id_metadata_document_supported` | `true` unless the organization switched Client ID Metadata Documents off |

Not supported, so do not configure a library for them: the implicit and hybrid flows, the
`plain` PKCE method, `client_secret_jwt`, mutual TLS client authentication, certificate-bound
tokens, pairwise subject identifiers, encrypted ID tokens, encrypted request objects, and request
objects fetched from a client-hosted `request_uri`.

## Client authentication at the token endpoint

| Method | How | For |
|---|---|---|
| `client_secret_basic` | `Authorization: Basic base64(client_id:client_secret)` | Confidential clients; the default |
| `client_secret_post` | `client_id` and `client_secret` in the form body | Confidential clients whose library cannot send Basic |
| `none` | `client_id` in the form body, with PKCE | Public clients |
| `private_key_jwt` | A signed assertion; see `lumoauth-oauth-advanced` | Confidential clients without a shared secret |

Use one method per request. A request that authenticates in two ways is refused with
`invalid_request`. A disabled application is treated as unknown on every OAuth endpoint and gets
`invalid_client`.

## Rate limits

The OAuth endpoints are rate limited and answer `429` with
`{"error": "too_many_requests", "error_description": "Rate limit exceeded"}` and a `Retry-After`
header. Wait that many seconds before you retry. Do not introspect or call UserInfo on every request; cache the result for a short time.

## Sources

- https://docs.lumoauth.dev/oauth
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/reference/standards
