# Implement MCP authorization by hand

Read this file when the MCP server is not built with FastMCP or the official TypeScript MCP SDK, and the checks must be in the server's own code. If the code may stay unchanged, `npx lumoauth secure` (see `typescript.md`) does all of this in front of the server.

## What the server must do

1. **Publish protected resource metadata** (RFC 9728) on its own host.
2. **Answer `401`** to a request without a valid token, with a `WWW-Authenticate` header that points to that document.
3. **Validate the token** on every request: signature, issuer, audience equal to its own Resource URI, expiry, token type, and the scopes that the operation needs.
4. **Answer `403`** with `error="insufficient_scope"` when a valid token lacks a scope.
5. **Check the DPoP proof** when the token is DPoP-bound, and accept nothing else when the registration has **Require DPoP** on.
6. **Never forward the token** to another service.

Other duties of an MCP server over Streamable HTTP: refuse a request with an invalid `Origin` header (`403`), and never treat a handle from a tool argument (a cart id, a session id) as proof of identity. Store such handles under the user id from the verified token.

## Values

| Value | Example |
|---|---|
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` (EU: `https://eu.app.lumoauth.dev/orgs/acme-corp/api/v1`; on a verified custom domain, the bare domain) |
| Resource URI | `https://mcp.example.com/mcp`, exactly as registered |
| Metadata URL on your host | `https://mcp.example.com/.well-known/oauth-protected-resource/mcp` |
| The registration, as LumoAuth publishes it | `{issuer}/.well-known/oauth-protected-resource/mcp/{serverId}` |

The metadata URL is built from the Resource URI: the segment `/.well-known/oauth-protected-resource` goes between the host and the path. A Resource URI without a path gives `https://mcp.example.com/.well-known/oauth-protected-resource`.

## 1. The metadata document

Serve it with `GET`, `Content-Type: application/json`, no authentication, and CORS open for browser-based clients.

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://app.lumoauth.dev/orgs/acme-corp/api/v1"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp:read"]
}
```

- `resource` must equal the URL that clients connect to. Clients refuse a document whose `resource` differs.
- `authorization_servers` holds the issuer, not the URL of a document. Clients derive LumoAuth's metadata location from it.
- `scopes_supported` holds the basic scopes: the few that every client needs to start.
- When the registration requires DPoP, add `"dpop_bound_access_tokens_required": true` and `"dpop_signing_alg_values_supported": ["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "EdDSA"]`.

The document that LumoAuth publishes for the registration has the same content. A server can fetch it at start-up and serve it unchanged: `curl https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/oauth-protected-resource/mcp/mcp_0123456789abcdef01234567`, or `lumo mcp discovery mcp_0123456789abcdef01234567`.

## 2. The challenges

No token, or an invalid or expired token:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="the token has expired", scope="mcp:read", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

Leave out `error` and `error_description` when the request carried no token. `scope` names the basic scopes, so the client asks for them first.

A valid token that lacks a scope:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

A server that requires DPoP uses the `DPoP` scheme and adds `algs`:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: DPoP error="invalid_token", algs="ES256 ES384 ES512 RS256 RS384 RS512 PS256 PS384 PS512 EdDSA", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

Add `Access-Control-Expose-Headers: WWW-Authenticate` so that browser-based clients can read the challenge. To compare your answers with a reference, call LumoAuth's own challenge endpoint with `curl -i https://app.lumoauth.dev/orgs/acme-corp/api/v1/mcp/mcp_0123456789abcdef01234567/challenge`.

## 3. Token validation checklist

LumoAuth access tokens are JWTs by default (type `at+jwt`).

1. Read the token from `Authorization: Bearer <token>` or `Authorization: DPoP <token>`. Never accept a token in the query string.
2. Find the keys: fetch `{issuer}/.well-known/openid-configuration` (or the RFC 8414 location `https://app.lumoauth.dev/.well-known/oauth-authorization-server/orgs/acme-corp/api/v1`), check that its `issuer` equals your issuer, and read `jwks_uri`. Do not build the JWKS path yourself. Cache the keys and fetch them again when a token names an unknown `kid`.
3. Header: `typ` is `at+jwt`; `alg` is an asymmetric algorithm (refuse `none` and `HS*`).
4. Verify the signature.
5. `iss` equals the issuer.
6. `aud` (a string or an array) contains the Resource URI. LumoAuth copies the client's `resource` value into `aud` as the client spelled it, so compare in normal form: scheme and host in lower case, default port dropped, trailing slashes dropped.
7. `exp` is in the future; `nbf`, when present, is not. Allow about 60 seconds of clock difference.
8. `token_use` is not `test`. Portal test tokens are not for resource servers.
9. `scope` (space separated) covers what the operation needs. Scopes compare exactly, with one rule: a granted scope that ends in `:*` covers the scopes under that prefix (`invoices:*` covers `invoices:refund`).
10. When the token has `cnf.jkt`: the request must use the `DPoP` scheme and carry a `DPoP` header with a proof JWT. Check `typ: dpop+jwt`, the `jwk` header, the signature, `htm` equal to the method, `htu` equal to the request URL without query, a recent `iat`, an unused `jti`, `ath` equal to `base64url(sha256(token))`, and the thumbprint of `jwk` equal to `cnf.jkt`. Never treat a bound token without a valid proof as a bearer token.

Claims to use after validation: `sub` (a user id, or `agent_agt_…` for an agent), `is_agent`, `capabilities`, `act` (present when an agent acts for the user in `sub`), `client_id`, `scope`.

Local validation does not see a revocation before `exp`. Keep the server's token lifetime short. Before an action that matters, the server can introspect the token at `POST {issuer}/oauth/introspect` with its own client credentials: a revoked token answers `active: false`. Introspection at the issuer is not token passthrough.

## 4. Use an SDK verifier

The LumoAuth JavaScript, Python and Go SDKs include a verifier that does steps 2 to 8 and step 10. They do not write the MCP challenge: the ready-made middleware in the Python SDK (`lumoauth.fastapi.require_access_token`) and the Go SDK (`RequireAccessToken`) answer `401` without `resource_metadata`, so an MCP client cannot find LumoAuth from it. Call the verifier and write the challenge yourself, as below.

### TypeScript (Express)

`npm install @lumoauth/agent express`. `@lumoauth/agent` needs Node 18 or later.

```ts
import express, { type NextFunction, type Request, type Response } from 'express';
import {
    AccessTokenError,
    accessTokenScopes,
    createAccessTokenVerifier,
    type AccessTokenClaims,
} from '@lumoauth/agent';

const ISSUER = 'https://app.lumoauth.dev/orgs/acme-corp/api/v1';
const RESOURCE = 'https://mcp.example.com/mcp';
const PUBLIC_ORIGIN = new URL(RESOURCE).origin;
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const METADATA_URL = `${PUBLIC_ORIGIN}${METADATA_PATH}`;
const BASIC_SCOPES = ['mcp:read'];

const verifier = createAccessTokenVerifier({ issuer: ISSUER, resource: RESOURCE });

function covered(required: string, granted: string[]): boolean {
    return granted.some(
        (g) => g === required || (g.endsWith(':*') && g !== ':*' && required.startsWith(g.slice(0, -1)) && required.length > g.length - 1),
    );
}

function challenge(res: Response, status: 401 | 403, error?: string, description?: string, scopes = BASIC_SCOPES): void {
    const parts = [
        error ? `error="${error}"` : '',
        description ? `error_description="${description.replace(/["\\]/g, "'")}"` : '',
        `scope="${scopes.join(' ')}"`,
        `resource_metadata="${METADATA_URL}"`,
    ].filter(Boolean);
    res.status(status)
        .set('WWW-Authenticate', `Bearer ${parts.join(', ')}`)
        .set('Access-Control-Expose-Headers', 'WWW-Authenticate')
        .json({ error: error ?? 'invalid_token', error_description: description });
}

function requireToken(...scopes: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.headers.authorization) return challenge(res, 401);
        let claims: AccessTokenClaims;
        try {
            claims = await verifier.verifyRequest({
                method: req.method,
                url: `${PUBLIC_ORIGIN}${req.originalUrl.split('?')[0]}`,
                headers: req.headers,
            });
        } catch (error) {
            if (error instanceof AccessTokenError && error.code !== 'jwks_fetch_failed') {
                return challenge(res, 401, error.code, error.message);
            }
            res.status(503).json({ error: 'temporarily_unavailable' });
            return;
        }
        const missing = scopes.filter((s) => !covered(s, accessTokenScopes(claims)));
        if (missing.length > 0) return challenge(res, 403, 'insufficient_scope', `Missing scope: ${missing.join(' ')}`, scopes);
        res.locals.caller = claims;
        next();
    };
}

const app = express();
app.use(express.json());

app.get(METADATA_PATH, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ['header'],
        scopes_supported: BASIC_SCOPES,
    });
});

app.post('/mcp', requireToken('mcp:read'), (req, res) => {
    const caller = res.locals.caller as AccessTokenClaims;
    // Hand req.body to the MCP implementation here. caller.sub is the user id, or agent_agt_… for an agent.
    res.json({ jsonrpc: '2.0', id: req.body?.id ?? null, result: { caller: caller.sub } });
});

app.listen(3000);
```

Pass `requireDpop: true` to `createAccessTokenVerifier` when the registration requires DPoP, and write the `DPoP` challenge from section 2. With several replicas, pass a shared `replayCache` (`{ add(key, ttlSeconds) }`).

### Python (FastAPI)

`pip install "lumoauth[verify]" fastapi`. `lumoauth` 1.4.0 needs Python 3.9 or later.

```python
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from lumoauth.errors import LumoAuthTokenError
from lumoauth.verify import AccessTokenClaims, AccessTokenVerifier, DpopRequest

ISSUER = "https://app.lumoauth.dev/orgs/acme-corp/api/v1"
RESOURCE = "https://mcp.example.com/mcp"
PUBLIC_ORIGIN = "https://mcp.example.com"
METADATA_PATH = "/.well-known/oauth-protected-resource/mcp"
METADATA_URL = PUBLIC_ORIGIN + METADATA_PATH
BASIC_SCOPES = ["mcp:read"]

verifier = AccessTokenVerifier(ISSUER, RESOURCE)
app = FastAPI()


def covered(required: str, granted: tuple[str, ...]) -> bool:
    return any(
        g == required or (g.endswith(":*") and g != ":*" and required.startswith(g[:-1]) and len(required) > len(g) - 1)
        for g in granted
    )


def challenge(status: int, error: Optional[str] = None, description: Optional[str] = None,
              scopes: Optional[list[str]] = None) -> HTTPException:
    parts = []
    if error:
        parts.append(f'error="{error}"')
    if description:
        parts.append('error_description="{}"'.format(description.replace('"', "'")))
    parts.append('scope="{}"'.format(" ".join(scopes or BASIC_SCOPES)))
    parts.append(f'resource_metadata="{METADATA_URL}"')
    return HTTPException(
        status_code=status,
        detail={"error": error or "invalid_token", "error_description": description},
        headers={"WWW-Authenticate": "Bearer " + ", ".join(parts), "Access-Control-Expose-Headers": "WWW-Authenticate"},
    )


def require_token(*scopes: str):
    def dependency(request: Request) -> AccessTokenClaims:
        scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
        if scheme.lower() not in ("bearer", "dpop") or not token.strip():
            raise challenge(401)
        dpop = DpopRequest(
            method=request.method,
            url=PUBLIC_ORIGIN + request.url.path,
            proof=request.headers.get("dpop"),
            scheme="DPoP" if scheme.lower() == "dpop" else "Bearer",
        )
        try:
            claims = verifier.verify(token.strip(), dpop=dpop)
        except LumoAuthTokenError as exc:
            raise challenge(401, exc.error, exc.message) from exc
        missing = [s for s in scopes if not covered(s, claims.scopes)]
        if missing:
            raise challenge(403, "insufficient_scope", "Missing scope: " + " ".join(missing), list(scopes))
        return claims

    return dependency


@app.get(METADATA_PATH)
def protected_resource_metadata() -> dict:
    return {
        "resource": RESOURCE,
        "authorization_servers": [ISSUER],
        "bearer_methods_supported": ["header"],
        "scopes_supported": BASIC_SCOPES,
    }


@app.post("/mcp")
async def mcp(request: Request, caller: AccessTokenClaims = Depends(require_token("mcp:read"))) -> dict:
    body = await request.json()
    # Hand the body to the MCP implementation here. caller.sub is the user id, or agent_agt_… for an agent.
    return {"jsonrpc": "2.0", "id": body.get("id"), "result": {"caller": caller.sub}}
```

`AccessTokenVerifier(issuer, resource, require_dpop=True)` refuses tokens that are not DPoP-bound. `replay_cache=` takes a shared store with `check_and_add(key, ttl)`. `caller.is_agent`, `caller.agent_id`, `caller.is_delegated`, `caller.actor`, `caller.scopes` and `caller.capabilities` describe the caller. The Python verifier compares `aud` with `resource` exactly, so pass the Resource URI as registered.

### Go (`net/http`)

Module `github.com/lumoauth/lumo-auth-go` (package `lumoauth`, Go 1.22).

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

const (
	issuer      = "https://app.lumoauth.dev/orgs/acme-corp/api/v1"
	resource    = "https://mcp.example.com/mcp"
	metadataURL = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
)

func challenge(w http.ResponseWriter, status int, params string) {
	if params != "" {
		params += ", "
	}
	w.Header().Set("WWW-Authenticate", `Bearer `+params+`scope="mcp:read", resource_metadata="`+metadataURL+`"`)
	w.Header().Set("Access-Control-Expose-Headers", "WWW-Authenticate")
	w.WriteHeader(status)
}

func mcpHandler(w http.ResponseWriter, r *http.Request) {
	scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if token == "" || (!strings.EqualFold(scheme, "Bearer") && !strings.EqualFold(scheme, "DPoP")) {
		challenge(w, http.StatusUnauthorized, "")
		return
	}
	claims, err := lumoauth.VerifyAccessToken(r.Context(), token, lumoauth.AccessTokenVerifyOptions{
		Issuer:   issuer,
		Resource: resource,
		DPoP:     lumoauth.DPoPRequestFromHTTP(r),
	})
	if err != nil {
		challenge(w, http.StatusUnauthorized, `error="invalid_token"`)
		return
	}
	if !claims.HasScope("mcp:read") {
		challenge(w, http.StatusForbidden, `error="insufficient_scope"`)
		return
	}
	// Hand the request to the MCP implementation here. claims.Subject is the caller.
	_ = json.NewEncoder(w).Encode(map[string]string{"caller": claims.Subject})
}

func metadataHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"resource":                 resource,
		"authorization_servers":    []string{issuer},
		"bearer_methods_supported": []string{"header"},
		"scopes_supported":         []string{"mcp:read"},
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp", metadataHandler)
	mux.HandleFunc("POST /mcp", mcpHandler)
	log.Fatal(http.ListenAndServe(":3000", mux))
}
```

`RequireDPoP: true` in the options refuses tokens that are not bound. `DPoPRequestFromHTTP(r)` reads the request as the server sees it; behind a proxy that changes the host or scheme, check that the proof's `htu` is compared with the public URL.

### Other languages

Use a JWT library and the checklist in section 3. For a server that must accept DPoP-bound tokens without an SDK verifier, put `npx lumoauth secure` in front of it. The language skills (`lumoauth-php`, `lumoauth-aspnetcore`, `lumoauth-spring-boot`) and `lumoauth-api-protection` cover token validation for ordinary APIs.

## 5. Per-tool decisions

After validation, the server can ask LumoAuth whether this caller may run this tool. Read `per-tool-authorization.md`.

## Check the result

```bash
curl -i -X POST https://mcp.example.com/mcp                                    # 401 with resource_metadata
curl https://mcp.example.com/.well-known/oauth-protected-resource/mcp          # the metadata document
lumo mcp test mcp_0123456789abcdef01234567 agt_0123456789abcdef --method tools/list   # mints a token: show it first
```

Then test the negative cases: a token for another Resource URI, an expired token, and a token without the scope must be refused with `401`, `401` and `403`.
