# The AAuth request signature profile

AAuth uses HTTP message signatures (RFC 9421) with fixed rules. The LumoAuth SDK signers produce
exactly this form. Read this file when you sign or verify without an SDK, or when a signature is
rejected and you need to find out why.

## Headers on a signed request

| Header | Value |
|---|---|
| `Signature-Input` | `sig1=("@method" "@authority" "@path" "signature-key" "content-digest" "content-type" "authorization");created=1750000000;nonce="AAECAwQFBgcICQoLDA0ODw"` |
| `Signature` | `sig1=:<signature>:`, the signature bytes in base64url (standard base64 is also accepted; do not mix the alphabets) |
| `Content-Digest` | `sha-256=:<standard base64 of SHA-256 of the body>:` over the exact body bytes. Required on a request with a body; the SDK signers always send it, also for an empty body |
| `Content-Type` | The media type of the body. The SDKs send `application/json` |
| `Agent-Auth` | `agent_token=<agent+jwt>`, on requests to the agent token endpoint and the revocation endpoint. `Authorization: AAuth agent_token=<agent+jwt>` is the alternative form |
| `Authorization` | `Bearer <auth+jwt>`, on requests to a resource |
| `Signature-Key` | Only when the key is not taken from an agent token; see below |

The label (`sig1`) must be the same in `Signature-Input`, `Signature` and `Signature-Key`.

## Covered components

Always: `@method`, `@authority`, `@path`, `signature-key`.

`@query`: if and only if the URL has a query string. Covering it without a query string, or
leaving it out with one, is rejected.

In addition, per endpoint:

| Endpoint | Also required |
|---|---|
| `/aauth/agent/token`, `/aauth/token/revoke` | `content-digest`, `content-type`, `authorization` |
| `/aauth/agent/platform-token` | `content-digest`, `content-type` |
| `/aauth/agent/issue` | `content-digest` |
| `/aauth/resource/token`, `/aauth/resource/token/verify`, `/aauth/auth/token/verify` | `content-digest`, `content-type`, plus any components that an admin configured for the resource |

Covering more components than required is allowed. The SDK signers always cover the seven
components in the first table row, with `@query` inserted after `@path` when needed (the Python and
PHP signers never add `@query`: do not use a query string with them).

Values:

| Component | Value |
|---|---|
| `@method` | Upper case |
| `@authority` | Lower-case host, with `:port` only when the port is not the default for the scheme |
| `@path` | The request path |
| `@query` | `?` plus the raw query string |
| `signature-key` | The raw `Signature-Key` header value, or the empty string when the header is absent |
| Other names | The header value. A covered header that is absent counts as the empty string (`authorization` on the token endpoint, for example) |

## The signature base

One line per covered component, in the listed order, then the parameters line. Lines are joined
with `\n`; there is no trailing newline.

```
"@method": POST
"@authority": app.lumoauth.dev
"@path": /orgs/acme-corp/api/v1/aauth/agent/token
"signature-key": 
"content-digest": sha-256=:maoKTEBGVoe/uXlHmt4EeWj7K7xo71Ag/qIPObi3vPw=:
"content-type": application/json
"authorization": 
"@signature-params": ("@method" "@authority" "@path" "signature-key" "content-digest" "content-type" "authorization");created=1750000000;nonce="AAECAwQFBgcICQoLDA0ODw"
```

The parameters line is the `Signature-Input` value without the label, exactly as sent. A verifier
rebuilds it from the received header.

## Parameters

| Parameter | Rule |
|---|---|
| `created` | Required. An integer, not quoted. Rejected when more than 60 seconds from the server's clock |
| `nonce` | Required. A quoted string: base64url of at least 12 random bytes. Single-use per host and key; LumoAuth remembers nonces for 120 seconds |
| `expires` | Optional integer. When present, the signature is rejected after that time |
| `alg` | Optional. When present it must be the algorithm of the key (below) |
| `keyid`, `tag` | Accepted and covered, not interpreted. The key always comes from the agent token or from `Signature-Key` |

Any other parameter, a repeated parameter, or a wrongly typed value is rejected.

## Algorithms

The algorithm follows from the key type. Leave `alg` out.

| Key | Algorithm name | Signature bytes |
|---|---|---|
| OKP, Ed25519 | `ed25519` | 64 bytes |
| EC, P-256 | `ecdsa-p256-sha256` | Raw `r` then `s`, 32 bytes each. Not ASN.1 DER |
| RSA | `rsa-pss-sha512` | RSASSA-PSS with SHA-512, MGF1 with SHA-512, 64-byte salt |

SDK signers: JS, Go, Java and .NET sign with Ed25519 and RSA keys; Python and PHP with Ed25519
only. No LumoAuth SDK signer produces `ecdsa-p256-sha256`.

These are HTTP signature algorithm names. They are not the JWS `alg` values of the tokens
(`RS256`, `ES256`, `EdDSA` and others), which the issuer metadata lists separately in
`token_signing_algs_supported`.

## Which key verifies the signature

| Request | Key |
|---|---|
| To the agent token endpoint, the revocation endpoint and the platform token endpoint | The key in the agent token's `cnf` (`cnf.jwk`, or the token's own signing key with `cnf.jkt`) |
| To `/aauth/agent/issue` | The agent's registered key that `Signature-Key` names |
| To the resource endpoints | Any key in the resource's registered JWKS |
| To a resource, with an auth token | The key in the auth token's `cnf.jwk` |

`Signature-Key` formats:

| Scheme | Form | Use |
|---|---|---|
| `jwks_uri` | `sig1=jwks_uri;id="https://my-agent.example.com";kid="key-1"` | Required on `/aauth/agent/issue`: `id` is the agent identifier, `kid` a key in its registered JWKS |
| `hwk` | `sig1=hwk;kty="OKP";crv="Ed25519";x="…"` | An inline public key |
| `jwt` | `sig1=jwt;jwt="…"` | A key bound inside a presented token |
| `x509` | `sig1=x509;x5u="…";x5t="…"` | A certificate reference |

## Discovery

All under `{issuer}` = `https://app.lumoauth.dev/orgs/{orgId}/api/v1`, cacheable for one hour.

| Document | Path |
|---|---|
| Issuer metadata | `/.well-known/aauth-issuer` |
| Issuer keys (verify agent, resource and auth tokens that LumoAuth signed) | `/aauth/jwks.json` |
| All active agents | `/.well-known/aauth-agent` |
| All active resources | `/.well-known/aauth-resource` |
| One agent: metadata, keys | `/aauth/agents/{agentId}/metadata`, `/aauth/agents/{agentId}/jwks.json` |
| One resource: metadata, keys | `/aauth/resources/{resourceId}/metadata`, `/aauth/resources/{resourceId}/jwks.json` |

LumoAuth signs the tokens that it issues with the organization's signing key. After a key
rotation the previous key stays in the JWKS for a grace period, so cache the JWKS and fetch it
again when a token names an unknown `kid`.

## Errors

Bodies are `{"error": "<code>", "error_description": "…"}`.

| Code | HTTP | When |
|---|---|---|
| `authentication_required` | 401 | The agent token is missing or invalid, or the signature failed, at the agent token endpoint. The response also carries `Agent-Auth` and `WWW-Authenticate: AAuth` headers with one of five fixed reasons |
| `unauthorized` | 401 | A resource failed to authenticate at a resource endpoint |
| `invalid_request` | 400 | Bad JSON, a missing field, an unknown `request_type`, or an actor chain deeper than 5 |
| `invalid_grant` | 400 | A bad, expired or reused code or refresh token; a code for another agent, delegate, key or redirect URI; a user who is no longer valid |
| `invalid_scope` | 400 | A scope that is not pre-authorized, not supported by the resource, or wider than the grant |
| `invalid_resource_token` | 400 | The resource token failed validation |
| `invalid_token` | 400 | The upstream auth token of an exchange is invalid |
| `invalid_redirect_uri` | 400 | The redirect URI is not registered for the agent |
| `unauthorized_agent` | 400 | The agent is not registered or not active, or the feature is disabled for it |
| `forbidden` | 403 | A resource asked to verify a token of another resource |
| `rate_limit_exceeded` | 429 | The rate limit of the endpoint (60 requests per minute per IP address on most AAuth endpoints) |

The five reasons in a `401` challenge are deliberately general: `Missing or invalid Agent-Auth
header`, `Request signature verification failed`, `Signature nonce already used`, `Invalid agent
token`, `Signature key does not match agent token binding`. The response never says whether an
agent is registered or which key was unknown. An organization admin finds the detail in the audit
log: `aauth.signature_verification_failed` for signature failures and
`aauth.agent_token_rejected` for requests that were refused after the signature verified.

## Check a signer against the shared test vector

Every LumoAuth SDK signer reproduces one fixed Ed25519 vector byte for byte (Ed25519 signatures
are deterministic): key seed bytes `00` to `1f`, `created=1750000000`, nonce bytes `00` to `0f`
(`AAECAwQFBgcICQoLDA0ODw`), `POST https://auth.acme.test/orgs/acme-corp/api/v1/aauth/agent/token`
with the body `{"request_type": "auth", "resource_token": "RESOURCE_TOKEN_FIXED", "scope": "read write"}`.
The expected `Content-Digest` is `sha-256=:maoKTEBGVoe/uXlHmt4EeWj7K7xo71Ag/qIPObi3vPw=:`. A signer
that you write yourself should produce the same digest for that body before you test it against
LumoAuth.

Docs: https://docs.lumoauth.dev/agents/aauth-spec
