# Cross-app access (identity assertion grant, ID-JAG)

Cross-app access lets one application or agent reach another application's API for a user,
without a second consent screen, when both trust the same identity provider. It implements the
IETF Identity Assertion Authorization Grant draft (ID-JAG; also called Cross App Access or XAA),
which the MCP Enterprise-Managed Authorization extension uses.

Use it when the target API has **its own authorization server**. When the caller and the API are
in the same LumoAuth organization, use the token exchange in `SKILL.md` instead.

The flow has two requests:

1. The requesting app holds the user's **ID token**. It asks the user's identity provider for an
   **identity assertion** (the ID-JAG) that is addressed to the target app's authorization server.
2. It presents the assertion to that authorization server with the `jwt-bearer` grant and gets an
   access token for the target API.

A LumoAuth organization can play either role, or both:

| Role | What the organization does | Switch |
|---|---|---|
| Identity provider | Issues ID-JAGs for its users | **Issue identity assertions** |
| Resource authorization server | Accepts ID-JAGs from a trusted identity provider and issues its own access tokens | **Accept identity assertions** |

Both switches are off by default. An admin sets everything on one page: **AI Agents → Agent rules
→ Cross-app access** (`/orgs/{orgId}/portal/delegation`). The same switches are under **Security →
Sign-in settings → Platform security**. Tell the user which settings are needed; an agent cannot
change them without an admin.

## Role 1: the organization issues the assertion

### Admin setup

1. **Step 1 · Roles**: switch on **Issue identity assertions**, then **Save switches**.
2. **Step 3 · Applications**: on the requesting application's row, turn on **Can obtain
   assertions**.
3. **Step 4 · Which app may reach which service**: **Add policy** with the **Application** (the
   requesting app), the **Target authorization server** (its issuer URL) and the **Allowed scopes**.

Without an active policy for the pair (application, target) the request fails with
`invalid_target`.

### Request

The requesting application authenticates as itself (it is a confidential OAuth client) and sends
the user's ID token:

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:id-jag" \
  -d "subject_token=$USER_ID_TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:id_token" \
  -d "audience=https://auth.partner.example.com" \
  -d "scope=documents.read"
```

| Parameter | Value |
|---|---|
| `requested_token_type` | `urn:ietf:params:oauth:token-type:id-jag` |
| `subject_token` | An ID token that this organization issued to this client (`aud` or `azp` is the client) |
| `subject_token_type` | `urn:ietf:params:oauth:token-type:id_token` |
| `audience` | The issuer URL of the **target** authorization server |
| `scope` | Optional. The result is the intersection with the policy's allowed scopes |

This is the one request in this skill where `audience` is the right parameter: it names the
authorization server that will receive the assertion, not an API.

Response:

```json
{
  "access_token": "eyJ0eXAiOiJvYXV0aC1pZC1qYWcrand0Iiwi...",
  "issued_token_type": "urn:ietf:params:oauth:token-type:id-jag",
  "token_type": "N_A",
  "expires_in": 300,
  "scope": "documents.read"
}
```

The value in `access_token` is the assertion: a JWT with the header `typ: oauth-id-jag+jwt`, signed
with the organization's key, with `iss` (this organization), `sub` (the user), `aud` (the target
authorization server), `client_id`, `scope`, `jti`, `iat` and `exp`. It is valid for 5 minutes and
for one use. It is not an access token: do not send it to an API.

Only an application can make this request. An agent credential cannot: the agent's backend uses
the application through which the user signed in.

## Role 2: the organization accepts the assertion

### Admin setup

1. **Step 1 · Roles**: switch on **Accept identity assertions**, then **Save switches**.
   Optionally switch on **Require an explicit scope when redeeming**.
2. **Step 2 · Trusted identity providers**: **Register provider** with the provider's **Issuer
   URL**, optionally its **Keys (JWKS URL)**, **How to match the user** (by verified e-mail, the
   default, or by a linked external subject), optionally **Only from this client at the provider**,
   and **Who may redeem these assertions**.
3. **Step 3 · Applications**: on each application that redeems assertions, turn on **Can redeem
   assertions**. Only confidential clients can.

### Request

The application that fronts the target API authenticates with its own client credentials at this
organization and presents the assertion:

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  -d "assertion=$ID_JAG"
```

The response is a normal token response (`access_token`, `token_type`, `expires_in`, `scope`, and
a `refresh_token` when the client is registered for it).

What LumoAuth checks on the assertion:

- Header `typ` is `oauth-id-jag+jwt`; the algorithm is from the RS, ES or PS families.
- `iss` is a registered, enabled trusted provider, and the signature verifies with its keys.
- `aud` equals this organization's issuer URL exactly.
- `exp` and `iat` are sane (at most 24 hours old, 60 seconds of clock difference).
- `jti` was not used before.
- The user maps to an active local account. With e-mail matching, the assertion needs `email` and
  `email_verified: true`.
- The redeeming client is allowed (its own switch, and the provider's list).

Scopes: the assertion's `scope` is intersected with the redeeming client's registered scopes. An
assertion without `scope` gives a token with an empty scope (or `invalid_grant` when **Require an
explicit scope when redeeming** is on). A `scope` request parameter can only narrow further.

Audience: when the assertion carries a `resource` claim, the access token's `aud` is that
resource, not the redeeming client. When the resource is a registered MCP server, that server's
policy applies (allowed clients, lifetime, scope vocabulary, Require DPoP).

The JWT access token records where the request came from in `act`:

```json
{
  "sub": "8b1f6c1e-2d0a-4f6b-9c57-0c2f4a9e7d11",
  "aud": "https://api.example.com",
  "client_id": "partner_backend",
  "scope": "documents.read",
  "act": {
    "sub": "client_abc123",
    "iss": "https://idp.customer.example.com",
    "sub_profile": "workload"
  }
}
```

Here `act.iss` is the external identity provider, and `act.sub` is the requesting client there.
The downstream API applies the same checks as for any delegated token (see `SKILL.md`, step 5).

Send a `DPoP` proof with the `jwt-bearer` request to get a token that is bound to the client's key
(`token_type: "DPoP"`).

## Discovery

The organization's discovery documents show what is on:

- `urn:ietf:params:oauth:grant-type:token-exchange` in `grant_types_supported` (always).
- With **Accept identity assertions** on: `urn:ietf:params:oauth:grant-type:jwt-bearer` in
  `grant_types_supported`, and
  `authorization_grant_profiles_supported: ["urn:ietf:params:oauth:grant-profile:id-jag"]`.

## Errors

| Error | Cause |
|---|---|
| `invalid_request` (role 1) / `unsupported_grant_type` (role 2) | The organization's switch for that role is off |
| `unauthorized_client` | The application is not allowed to obtain assertions (role 1), or to redeem them, or is not in the provider's list (role 2) |
| `invalid_target` | No active policy for (application, target); or the assertion's `resource` is an MCP server that does not allow the redeeming client |
| `invalid_grant` | The subject token is not a valid ID token of this organization for this client; or the assertion has an untrusted issuer, a wrong `aud`, a bad signature, is expired or replayed; or the user cannot be mapped; or `email_verified` is missing |
| `invalid_scope` | The requested scopes are all outside the policy |
| `access_denied` | The redeeming application's own rules refuse the user (user access mode, MFA requirement) |

Audit events: `xaa.id_jag_issued`, `xaa.id_jag_redeemed`, `xaa.id_jag_rejected` (with a `reason`).

The LumoAuth SDKs have no helper for these two requests. Send them with an HTTP client from the
application's backend. Keep the client secret, the ID token and the assertion on the server.

Docs: https://docs.lumoauth.dev/agents/cross-app-access
