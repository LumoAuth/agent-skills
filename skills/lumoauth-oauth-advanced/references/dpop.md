# DPoP: sender-constrained tokens

DPoP binds an access token (and its refresh token) to a key pair that the client holds. Every
request carries a short proof signed with that key. A copy of the token is useless without the
key. DPoP is LumoAuth's only sender constraint; there are no certificate-bound tokens.

Two readers use this file: a client that obtains and uses DPoP-bound tokens, and an API (resource
server) that must verify them.

## The proof JWT

| Part | Field | Value |
|---|---|---|
| Header | `typ` | `dpop+jwt` |
| Header | `alg` | `ES256`, `ES384`, `ES512`, `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512` or `EdDSA` |
| Header | `jwk` | The public key. Never include private key members |
| Claim | `htm` | The HTTP method of this request, for example `POST` |
| Claim | `htu` | The URL of this request: scheme, host, port and path, without query string and fragment |
| Claim | `iat` | Now. LumoAuth accepts a proof up to 60 seconds ahead of its clock and up to 300 seconds old |
| Claim | `jti` | A unique value of at least 16 characters. A `jti` is accepted once per key |
| Claim | `ath` | Only on requests that present an access token: `BASE64URL(SHA256(access_token))` |
| Claim | `nonce` | Only when the server asked for one (see "Server nonces") |

Create a new proof for every request. Never reuse one.

## Client: obtain a bound token

Send the proof in the `DPoP` header of the token request. This works with every grant
(authorization code, refresh token, client credentials, device code, CIBA, token exchange).

```http
POST /orgs/acme-corp/api/v1/oauth/token HTTP/1.1
Host: app.lumoauth.dev
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...

grant_type=authorization_code&code=...&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&code_verifier=...
```

```json
{
  "access_token": "eyJ...",
  "token_type": "DPoP",
  "expires_in": 3600,
  "scope": "openid profile email",
  "refresh_token": "..."
}
```

- `token_type` is `DPoP`. A JWT access token carries `cnf.jkt`, the thumbprint of the proof key.
- The refresh token is bound to the same key. Every refresh request needs a proof with that key.
- A proof on the PAR request binds the authorization code: the code exchange must then use the
  same key, otherwise it fails with `invalid_dpop_proof`.
- A public client (single-page or mobile app) gains the most: its refresh token cannot be used
  from another device.

## Client: call an API

```http
GET /reports HTTP/1.1
Host: api.example.com
Authorization: DPoP eyJ...
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...
```

The scheme is `DPoP`, not `Bearer`. The proof for this request has `htm: "GET"`,
`htu: "https://api.example.com/reports"` and `ath`. LumoAuth's own APIs and UserInfo follow the
same rule: a bound token as `Bearer`, or without a valid proof, gets `401`.

## Server nonces

An organization can require a server-provided nonce in every proof (the organization setting
`settings.security.dpop_require_nonce`, off by default). Implement the retry once and the client
works with both settings:

| Where | Answer without a fresh nonce | What to do |
|---|---|---|
| Token endpoint, PAR | `400` with `{"error": "use_dpop_nonce"}` and a `DPoP-Nonce` header | New proof with `nonce` = header value, new `jti`, fresh `iat`; repeat the request once |
| UserInfo and other LumoAuth APIs | `401` with `use_dpop_nonce`, a `DPoP-Nonce` header and `WWW-Authenticate: DPoP error="use_dpop_nonce"` | The same |

A nonce works once. Responses can carry a new `DPoP-Nonce` header; when one is present, use it
for the next request to that endpoint.

## Client implementation in TypeScript

```bash
npm install jose
```

```ts
// dpop-client.ts
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export type ProofFn = (
  method: string,
  url: string,
  options?: { accessToken?: string; nonce?: string },
) => Promise<string>;

/** Creates one key pair and returns a function that signs proofs with it. */
export async function createDpopSigner(): Promise<ProofFn> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);

  return async (method, url, options = {}) => {
    const target = new URL(url);
    target.search = "";
    target.hash = "";
    const claims: Record<string, string> = {
      htm: method.toUpperCase(),
      htu: target.toString(),
      jti: randomUUID(),
    };
    if (options.accessToken) {
      claims.ath = createHash("sha256").update(options.accessToken).digest("base64url");
    }
    if (options.nonce) claims.nonce = options.nonce;

    return new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setIssuedAt()
      .sign(privateKey);
  };
}

export interface DpopTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}

/** Token request with a DPoP proof and one retry for use_dpop_nonce. */
export async function tokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams,
  proof: ProofFn,
  clientAuthHeader?: string,
): Promise<DpopTokenResponse> {
  let nonce: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: await proof("POST", tokenEndpoint, { nonce }),
    };
    if (clientAuthHeader) headers.Authorization = clientAuthHeader;

    const res = await fetch(tokenEndpoint, { method: "POST", headers, body: body.toString() });
    const json = (await res.json()) as DpopTokenResponse & { error?: string };
    if (res.ok) return json;

    const serverNonce = res.headers.get("DPoP-Nonce");
    if (json.error === "use_dpop_nonce" && serverNonce && attempt === 0) {
      nonce = serverNonce;
      continue;
    }
    throw new Error(`Token request failed: ${json.error ?? res.status}`);
  }
  throw new Error("Token request failed after the DPoP nonce retry");
}

/** API call with a bound token. */
export async function callApi(url: string, accessToken: string, proof: ProofFn): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `DPoP ${accessToken}`,
      DPoP: await proof("GET", url, { accessToken }),
    },
  });
}
```

Keep the signer for as long as its tokens live: the refresh token only works with the same key.
A server keeps the private key in its secret store or key service. A browser app creates the key
with WebCrypto as non-extractable and stores the `CryptoKey` in IndexedDB. A mobile app uses the
platform key store.

The LumoAuth JavaScript, Python and Go SDKs can sign DPoP proofs for you; when the project uses
one of them, prefer the SDK skill (`lumoauth-node-backend`, `lumoauth-python`, `lumoauth-go`).

## Require DPoP for an application

Portal: **Applications → your app → Security → FAPI 2.0 and client authentication → Require
DPoP**, then **Save FAPI settings**. A token request for this application without a proof then
fails with `invalid_dpop_proof`. Availability of this switch depends on the organization's plan
(see https://docs.lumoauth.dev/pricing-matrix). Without the switch, a client can still send
proofs and receives bound tokens.

## Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_dpop_proof` | Proof missing for an application that requires DPoP; wrong `typ`; unsupported `alg`; `htm` or `htu` does not match the request; `iat` outside the window; `jti` reused or too short; bad signature; key differs from the key bound to the code or refresh token |
| 400 (token endpoint), 401 (APIs) | `use_dpop_nonce` | The organization requires a nonce; retry with the `DPoP-Nonce` value |
| 401 | `invalid_token` | At UserInfo and LumoAuth APIs: a bound token sent as `Bearer` |

## Resource server: verify a DPoP-bound token

An API that accepts DPoP-bound tokens does all of this on every request:

1. Read `Authorization: DPoP <token>` and exactly one `DPoP` header.
2. Validate the access token as usual (signature, `typ: at+jwt`, `iss`, `aud`, `exp`, scope). See
   `lumoauth-api-protection`.
3. Verify the proof: signature with the `jwk` in its own header; `typ` is `dpop+jwt`; an
   asymmetric `alg`; `htm` and `htu` match this request; `iat` is recent; `jti` was not seen
   before for this key; `ath` equals the hash of the presented token.
4. Compute the SHA-256 JWK thumbprint of the proof's `jwk` and compare it with the token's
   `cnf.jkt`.
5. If the token has `cnf.jkt` but arrives as `Bearer`, refuse it. Never downgrade a bound token.

On failure answer `401` with
`WWW-Authenticate: DPoP error="invalid_token", algs="ES256 RS256 PS256 EdDSA"` (list the
algorithms that the API accepts). For an opaque token, introspection returns `cnf.jkt` and
`token_type: "DPoP"`; apply steps 3 to 5 with that value.

```ts
// dpop-verify.ts
import { createHash } from "node:crypto";
import { EmbeddedJWK, calculateJwkThumbprint, jwtVerify } from "jose";

const ALGORITHMS = ["ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "EdDSA"];

/** Replace with a shared store (for example Redis with a TTL) when the API has several instances. */
const seenJti = new Map<string, number>();

function rememberJti(key: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [k, expires] of seenJti) if (expires < now) seenJti.delete(k);
  if (seenJti.has(key)) return false;
  seenJti.set(key, now + ttlMs);
  return true;
}

export interface DpopCheck {
  proof: string; // value of the DPoP header
  method: string; // HTTP method of the request
  url: string; // full URL of the request as the client sees it
  accessToken: string; // the token from the Authorization header
  expectedJkt: string; // cnf.jkt of the validated access token
}

/** Throws when the proof does not match the request, the token or the bound key. */
export async function verifyDpopProof(check: DpopCheck): Promise<void> {
  const { payload, protectedHeader } = await jwtVerify(check.proof, EmbeddedJWK, {
    typ: "dpop+jwt",
    algorithms: ALGORITHMS,
    maxTokenAge: 300,
    clockTolerance: 60,
  });

  const target = new URL(check.url);
  target.search = "";
  target.hash = "";

  if (payload.htm !== check.method.toUpperCase()) throw new Error("DPoP htm mismatch");
  if (payload.htu !== target.toString()) throw new Error("DPoP htu mismatch");

  const ath = createHash("sha256").update(check.accessToken).digest("base64url");
  if (payload.ath !== ath) throw new Error("DPoP ath mismatch");

  const jkt = await calculateJwkThumbprint(protectedHeader.jwk!, "sha256");
  if (jkt !== check.expectedJkt) throw new Error("DPoP key does not match the token");

  if (typeof payload.jti !== "string" || payload.jti.length < 16) throw new Error("DPoP jti missing");
  if (!rememberJti(`${jkt}:${payload.jti}`, 360_000)) throw new Error("DPoP proof replayed");
}
```

Build `url` from the public scheme and host of the API (behind a proxy, from the forwarded
values that the proxy sets and that you trust), because the client signs the URL that it called.

## Sources

- https://docs.lumoauth.dev/oauth/token
- https://docs.lumoauth.dev/oauth/token-management
- https://docs.lumoauth.dev/oauth/fapi
- https://docs.lumoauth.dev/oauth/userinfo
