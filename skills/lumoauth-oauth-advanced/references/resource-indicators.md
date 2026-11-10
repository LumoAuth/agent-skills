# Resource indicators and audience-restricted tokens

The `resource` parameter names the API that an access token is for. LumoAuth puts that value in
the token's `aud` claim, and the API accepts only tokens whose `aud` names it. A token for API A
then cannot be used at API B.

## Rules for a resource value

| Rule | Detail |
|---|---|
| Form | An absolute URI with scheme and host, for example `https://api.example.com` |
| Scheme | `https`. `http` only for loopback and private-network hosts (development) |
| Fragment | Not allowed |
| Allowed per application | The value must match the application's resource indicators (**Applications → your app → Configuration → Resource indicators**). An empty list allows any valid resource |
| Matching | An entry without a trailing slash matches only itself. An entry that ends in `/` also matches every URI that starts with it (`https://api.example.com/` allows `https://api.example.com/v2`) |

The comparison is on the exact string. `https://api.example.com` and `https://api.example.com/`
are different values: use one spelling in the registration, in the requests and in the API's
audience check.

With dynamic client registration, the allowed list is the `audience_uris` field.

## Where to send `resource`

| Request | Effect |
|---|---|
| Authorization request (`/oauth/authorize`) | Validated and stored with the grant. May be repeated for several APIs |
| PAR request (`/oauth/par`) | The same; validated when the request is pushed |
| Token request, authorization code grant | Optional. Narrows the token to a subset of what the grant holds. Without it, the token gets all resources of the grant |
| Token request, refresh token grant | Optional. A subset of the grant; without it, all resources of the grant |
| Token request, client credentials grant | Sets the audience directly |
| Token request, device code, CIBA and token exchange grants | Sets the audience, within what the application may request |

Authorization request for one API:

```text
https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/authorize
  ?response_type=code
  &client_id=CLIENT_ID
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
  &scope=openid%20read%3Areports
  &state=STATE
  &code_challenge=CODE_CHALLENGE
  &code_challenge_method=S256
  &resource=https%3A%2F%2Fapi.example.com
```

Authorize for two APIs, then get one token per API:

```bash
# The authorization request carried resource=https://api.example.com
# and resource=https://billing.example.com

curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=https://app.example.com/callback" \
  -d "code_verifier=$CODE_VERIFIER" \
  -d "resource=https://api.example.com"

curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "resource=https://billing.example.com"
```

The refresh token stays bound to the full set of resources of the grant. Each access token names
only the resource that was requested for it.

Machine to machine:

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=read:reports" \
  -d "resource=https://api.example.com"
```

## The `aud` claim

| Request | `aud` in the access token |
|---|---|
| One resource | A string: `"https://api.example.com"` |
| Several resources | An array: `["https://api.example.com", "https://billing.example.com"]` |
| No resource | The client ID of the application |

Introspection reports the same `aud`. For opaque tokens, the resources are stored with the token
and returned by introspection.

Prefer one resource per token. A token that names several APIs can be replayed by any of them at
the others.

## What the API does

The API compares its own identifier with `aud`, as a string or as a member of the array, on every
request. The full validation is in `lumoauth-api-protection`.

```ts
// audience.ts
export function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}
```

## `invalid_target`

| Where | Cause |
|---|---|
| Authorization endpoint (redirected as an error), PAR, token endpoint | The value is not an absolute URI, has a fragment, or uses `http` on a public host |
| The same | The value is not in the application's resource indicators |
| Token endpoint | The requested resources are not a subset of what the grant holds |
| Token endpoint | The resource is a registered MCP server that is not active, or that the user has not approved for this application |

```json
{
  "error": "invalid_target",
  "error_description": "Resource \"https://api.example.com\" is not registered for this client"
}
```

Resources that are MCP servers carry extra policy (required `resource`, scope vocabulary, token
lifetime cap, optional DPoP). See `lumoauth-mcp-server` and `lumoauth-mcp-client`.

## Checklist

- One identifier per API, written the same way everywhere.
- The identifier is in the resource indicators of every application that calls the API.
- User flows send `resource` on the authorization request; every flow sends it on the token
  request when it wants a token for one API.
- The API checks `aud` and refuses tokens whose `aud` is a client ID or another API.

## Sources

- https://docs.lumoauth.dev/oauth/resource-indicators
- https://docs.lumoauth.dev/oauth/token-management
