# AAuth at the resource server

The resource is the API that agents call. It has two jobs:

1. Issue a **resource token** to an agent that asks for access.
2. Verify each request: the **auth token**, and the **request signature** made with the key in the
   token's `cnf.jwk` (proof of possession).

SDK support for verification:

| SDK | Auth token (`auth+jwt`) | Request signature |
|---|---|---|
| JS `@lumoauth/agent` | `verifyAuthToken` | No single call. Use `buildSignatureBase` and `verifySignatureBase` (complete code below) |
| Go | `lumoauth.VerifyAuthToken` | `claims.VerifyProofOfPossession(r, body)` |
| Java | `AAuthVerifier.verifyAuthToken` | `claims.verifyProofOfPossession(request)` |
| .NET | `AAuthVerifier.VerifyAuthTokenAsync` | `claims.VerifyProofOfPossession(request)` |
| Python, PHP | None. `verify_access_token` in Python is for ordinary OAuth access tokens, not for AAuth | None |

Register the resource first: portal, **AI Agents → Agents → AAuth resources → Register resource**,
with the resource identifier, the resource's JWKS, its scopes and the default auth level.

## Issue a resource token

The resource asks LumoAuth for the token with a request that it signs with its own registered key.
There is no bearer alternative. The resource decides here which scopes the agent may ask for.

`POST {issuer}/aauth/resource/token`

| Body field | Required | Meaning |
|---|---|---|
| `resource` | Yes | The resource identifier. LumoAuth finds the registration and its keys from it |
| `agent` | Yes | The identifier of the agent that asked |
| `agent_jkt` | Yes | RFC 7638 thumbprint of the key that the agent will sign with |
| `scope` | No | Space-separated scopes. Each must be one of the resource's registered scopes |

Response: `{"resource_token": "…", "token_type": "resource+jwt", "expires_in": 300}`. The lifetime
is the one configured on the resource.

```ts
import { signRequest } from '@lumoauth/agent';

const ISSUER = `${process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev'}/orgs/${process.env.LUMOAUTH_ORG_ID}/api/v1`;
const RESOURCE = 'https://api.example.com';
const RESOURCE_PRIVATE_KEY = process.env.RESOURCE_PRIVATE_KEY!; // your own variable: the resource's PEM key

export async function createResourceToken(agent: string, agentJkt: string, scope: string): Promise<string> {
  const url = `${ISSUER}/aauth/resource/token`;
  const body = JSON.stringify({ resource: RESOURCE, agent, agent_jkt: agentJkt, scope });
  const headers = signRequest(RESOURCE_PRIVATE_KEY, 'POST', url, { body });
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`resource token request failed: HTTP ${res.status}`);
  const data = (await res.json()) as { resource_token: string };
  return data.resource_token;
}
```

`generateKeypair()` from `@lumoauth/agent` also creates the resource's key pair. Keep the resource's
private key as secret as the agent's.

How an agent asks the resource for this token is your API's design: for example an endpoint that
takes `{ "agent": "...", "agent_jkt": "..." }`. Nothing in the answer is secret from the agent, and
the token is useless to anyone who does not hold the agent's key.

## Verify a request in Node.js

`verifyAuthToken` checks the token. The function below adds the request signature and the checks
that the token cannot give: which parts of the request are signed, how old the signature is,
whether the nonce was used before, and whether the body matches its digest.

```ts
// aauth-verify.ts
import { createPublicKey, type JsonWebKey } from 'node:crypto';
import {
  buildSignatureBase,
  contentDigestSha256,
  jwkThumbprint,
  verifyAuthToken,
  verifySignatureBase,
  type AAuthTokenClaims,
} from '@lumoauth/agent';

const ISSUER = `${process.env.LUMOAUTH_URL ?? 'https://app.lumoauth.dev'}/orgs/${process.env.LUMOAUTH_ORG_ID}/api/v1`;
const RESOURCE = 'https://api.example.com';
const MAX_AGE_SECONDS = 60;

// One process only. With several instances, keep the nonces in a shared store (Redis, a database).
const seenNonces = new Map<string, number>();

export interface IncomingAAuthRequest {
  method: string;
  /** Path and query as received, for example "/v1/data?limit=10". */
  url: string;
  /** Header names in lower case. */
  headers: Record<string, string | undefined>;
  /** The exact body bytes that were received. An empty buffer when there is no body. */
  body: Buffer;
}

export async function verifyAAuthRequest(req: IncomingAAuthRequest): Promise<AAuthTokenClaims> {
  const authorization = req.headers['authorization'] ?? '';
  const bearer = /^Bearer (\S+)$/.exec(authorization);
  if (!bearer) throw new Error('missing bearer token');

  // 1. The auth token: typ, issuer, JWS signature, exp, aud, cnf.jwk.
  const claims = await verifyAuthToken(bearer[1], { issuer: ISSUER, resource: RESOURCE });

  // 2. Signature-Input, in the form that the LumoAuth SDK signers send.
  const input = /^([A-Za-z0-9_-]+)=\(([^)]*)\);created=(\d+);nonce="([A-Za-z0-9_-]+)"$/.exec(
    (req.headers['signature-input'] ?? '').trim(),
  );
  if (!input) throw new Error('missing or unsupported Signature-Input');
  const [, label, list, createdText, nonce] = input;
  const components = list.split(' ').filter(Boolean).map((c) => c.replace(/"/g, ''));
  const created = Number(createdText);

  const mark = req.url.indexOf('?');
  const path = mark === -1 ? req.url : req.url.slice(0, mark);
  const query = mark === -1 || mark === req.url.length - 1 ? '' : req.url.slice(mark);

  // 3. The signature must cover the request line, the body digest and the token.
  const required = ['@method', '@authority', '@path', 'content-digest', 'authorization'];
  if (query !== '') required.push('@query');
  for (const name of required) {
    if (!components.includes(name)) throw new Error(`signature does not cover ${name}`);
  }
  if (query === '' && components.includes('@query')) throw new Error('unexpected @query');

  // 4. Fresh, and not seen before.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - created) > MAX_AGE_SECONDS) throw new Error('signature too old');
  for (const [key, expires] of seenNonces) if (expires < now) seenNonces.delete(key);
  const nonceKey = `${jwkThumbprint(claims.cnf.jwk)}:${nonce}`;
  if (seenNonces.has(nonceKey)) throw new Error('nonce already used');

  // 5. The digest matches the body that arrived.
  const digest = req.headers['content-digest'] ?? '';
  if (digest !== contentDigestSha256(req.body)) throw new Error('Content-Digest mismatch');

  // 6. The signature verifies with the key that the token is bound to.
  const signature = new RegExp(`^${label}=:([A-Za-z0-9_+/=-]+):$`).exec((req.headers['signature'] ?? '').trim());
  if (!signature) throw new Error('missing Signature');
  const values: Record<string, string> = {
    '@method': req.method.toUpperCase(),
    '@authority': (req.headers['host'] ?? '').toLowerCase(),
    '@path': path,
    '@query': query,
    'signature-key': req.headers['signature-key'] ?? '',
    'content-digest': digest,
    'content-type': req.headers['content-type'] ?? '',
    authorization,
  };
  for (const name of components) {
    if (!(name in values)) values[name] = req.headers[name] ?? '';
  }
  const base = buildSignatureBase(components, values, created, nonce);
  const key = createPublicKey({ key: claims.cnf.jwk as JsonWebKey, format: 'jwk' });
  let valid = false;
  try {
    valid = verifySignatureBase(base, signature[1], key);
  } catch {
    valid = false;
  }
  if (!valid) throw new Error('request signature does not verify');

  seenNonces.set(nonceKey, now + 2 * MAX_AGE_SECONDS);
  return claims;
}
```

Use it in Express. The body must reach the verifier as raw bytes, so use `express.raw`, not
`express.json`, on these routes, and parse JSON after verification.

```ts
import express from 'express';
import { verifyAAuthRequest } from './aauth-verify';

const app = express();
app.use(express.raw({ type: '*/*' }));

app.get('/v1/data', async (req, res) => {
  try {
    const claims = await verifyAAuthRequest({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers as Record<string, string | undefined>,
      body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    });
    if (!(claims.scope ?? '').split(' ').includes('read')) {
      res.status(403).json({ error: 'insufficient_scope' });
      return;
    }
    res.json({ agent: claims.agent ?? claims.aud, user: claims.sub ?? null, items: [] });
  } catch {
    res.status(401).json({ error: 'invalid_request' }); // do not echo the reason to the caller
  }
});

app.listen(3000);
```

Notes:

- `verifySignatureBase` verifies Ed25519 and RSA-PSS-SHA512 signatures. The LumoAuth SDK signers
  use those two.
- `@authority` is the `Host` header that your server sees. Behind a proxy that rewrites `Host`,
  restore the public host name before verification, from a header that only your proxy can set.
- `verifyAuthToken` fetches `{issuer}/aauth/jwks.json` on each call unless you pass `jwks`. Fetch
  the key set once, pass it as `jwks`, and fetch it again when a token names an unknown `kid`.
- Local verification does not see revocation. See "Revocation-aware check" below.

## What the token tells you

| Claim | Meaning |
|---|---|
| `aud` | Your resource identifier |
| `agent` | The agent identifier. Absent when it equals `aud` |
| `agent_delegate` | The session or delegate of the agent, when there is one |
| `scope` | Space-separated resource scopes. Identity scopes such as `openid` are never listed here |
| `sub` | The user, only when a user is bound and `openid` was granted. Depending on the resource's default auth level it is the real user ID or a per-resource pseudonym |
| `email`, `name` | Present with the `email` / `profile` scopes at the identified level |
| `act` | The chain of earlier agents when the token came from an exchange: `agent`, optional `agent_delegate` and `sub`, and a nested `act` (at most 5 levels) |
| `cnf.jwk` | The public key that must have signed the request |
| `jti` | The token ID, for revocation |

Authorize on `scope`, and on `agent` when only certain agents may call an operation. When the
token has an `act` chain, log it: it shows which agents handed the request on.

## Go

```go
package main

import (
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

var (
	issuer   = "https://app.lumoauth.dev/orgs/" + os.Getenv("LUMOAUTH_ORG_ID") + "/api/v1"
	resource = "https://api.example.com"
	keys     = lumoauth.NewJWKSCache(issuer, 0, nil) // caches the issuer's keys for one hour
	created  = regexp.MustCompile(`;created=(\d+)`)
)

func covered(signatureInput, component string) bool {
	return strings.Contains(signatureInput, `"`+component+`"`)
}

func data(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	jwks, err := keys.Get(r.Context())
	if err != nil {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	claims, err := lumoauth.VerifyAuthToken(r.Context(), token, lumoauth.VerifyOptions{
		Issuer: issuer, Resource: resource, JWKS: jwks,
	})
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// The signature must cover the request line, the body digest and the token, and be fresh.
	input := r.Header.Get("Signature-Input")
	for _, c := range []string{"@method", "@authority", "@path", "content-digest", "authorization"} {
		if !covered(input, c) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	if (r.URL.RawQuery != "") != covered(input, "@query") {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	m := created.FindStringSubmatch(input)
	if m == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	at, _ := strconv.ParseInt(m[1], 10, 64)
	if age := time.Now().Unix() - at; age > 60 || age < -60 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// The request was signed with the key in cnf.jwk, and the digest matches the body.
	if err := claims.VerifyProofOfPossession(r, body); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !claims.HasScope("read") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"items":[]}`))
}

func main() {
	http.HandleFunc("/v1/data", data)
	_ = http.ListenAndServe(":3000", nil)
}
```

Call `keys.Invalidate()` and retry once when verification fails on an unknown `kid`: the
organization may have rotated its signing key.

## Java

```java
import io.lumoauth.aauth.AAuthClaims;
import io.lumoauth.aauth.AAuthVerifier;
import io.lumoauth.aauth.IncomingRequest;
import io.lumoauth.aauth.JwksCache;

import java.net.URI;
import java.util.Map;

public final class AAuthGuard {
    private static final String ISSUER = "https://app.lumoauth.dev/orgs/acme-corp/api/v1";
    private static final String RESOURCE = "https://api.example.com";
    private final JwksCache keys = new JwksCache(ISSUER);

    /** Throws when the token or the request signature is not valid. */
    public AAuthClaims verify(String method, URI uri, Map<String, String> headers, byte[] body) {
        String authorization = headers.getOrDefault("Authorization", "");
        String token = authorization.startsWith("Bearer ") ? authorization.substring(7) : "";
        AAuthClaims claims = AAuthVerifier.verifyAuthToken(token, keys.verifyOptions(RESOURCE));
        claims.verifyProofOfPossession(new IncomingRequest(method, uri, headers, body));
        if (!claims.hasScope("read")) {
            throw new SecurityException("insufficient scope");
        }
        return claims;
    }
}
```

## .NET

```csharp
using LumoAuth.AAuth;

public sealed class AAuthGuard
{
    private const string Issuer = "https://app.lumoauth.dev/orgs/acme-corp/api/v1";
    private const string Resource = "https://api.example.com";
    private readonly JwksCache _keys = new(Issuer);

    /// <summary>Throws when the token or the request signature is not valid.</summary>
    public async Task<AAuthClaims> VerifyAsync(string method, Uri uri, IDictionary<string, string> headers, byte[] body)
    {
        var authorization = headers.TryGetValue("Authorization", out var value) ? value : "";
        var token = authorization.StartsWith("Bearer ") ? authorization["Bearer ".Length..] : "";
        var claims = await AAuthVerifier.VerifyAuthTokenAsync(token, await _keys.VerifyOptionsAsync(Resource));
        claims.VerifyProofOfPossession(new IncomingRequest(method, uri, headers, body));
        if (!claims.HasScope("read"))
        {
            throw new UnauthorizedAccessException("insufficient scope");
        }
        return claims;
    }
}
```

## Checks that the Go, Java and .NET verifiers leave to you

`VerifyProofOfPossession` rebuilds the signature base from the components that the request lists
and checks the signature and the body digest. It does not check:

- **Which components are covered.** Require `@method`, `@authority`, `@path`, `content-digest` and
  `authorization`, and `@query` exactly when the URL has a query string. Without `authorization`
  in the list, a signature from one request could be attached to another token.
- **The age of the signature.** Reject a `created` value more than 60 seconds from your clock.
- **Nonce reuse.** Remember each `nonce` per signing key for about two minutes and reject a
  repeat.

The Go example above shows the first two. Add the same checks in Java and .NET by reading the
`Signature-Input` header before you call the verifier.

## Revocation-aware check

Local verification accepts a token until it expires, even after the agent revoked it or an admin
revoked the agent's credentials. For operations where that matters, ask LumoAuth:

`POST {issuer}/aauth/auth/token/verify`, signed by the resource like the resource token request,
with the body `{"resource": "https://api.example.com", "auth_token": "<the auth token>"}`.

It answers `200` with `{"active": true, "agent": …, "agent_delegate": …, "resource": …, "sub": …,
"scope": …, "cnf_jkt": …, "act": …, "pop_required": true}`, or `{"active": false, "error": "…"}`.
`pop_required` is always `true`: the resource must still verify the request signature, against the
key whose thumbprint is `cnf_jkt`. A resource can verify only tokens that were issued for itself
(`403 forbidden` otherwise).

In Node.js, build that call exactly like `createResourceToken` above, with the other URL and body.

Docs: https://docs.lumoauth.dev/agents/aauth-spec
