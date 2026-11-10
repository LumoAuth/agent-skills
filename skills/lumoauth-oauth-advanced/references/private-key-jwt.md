# private_key_jwt client authentication

With `private_key_jwt` a confidential client proves its identity with a short signed JWT (a
client assertion) in place of a client secret. LumoAuth holds only the public key. Nothing that
could be replayed for long travels over the wire, and there is no shared secret to leak.

`client_secret_jwt` is not supported (client secrets are stored hashed), and there is no mutual
TLS client authentication. `private_key_jwt` is the key-based method.

## Set up

1. Create a key pair. Any of these algorithms is accepted for the assertion: `RS256`, `RS384`,
   `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512`. RSA keys for `PS*` need at least
   2,048 bits.

   ```bash
   # ES256 (P-256) private key in PKCS#8 form, and its public key
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out client-key.pem
   openssl pkey -in client-key.pem -pubout -out client-key.pub.pem
   ```

2. Publish the public key as a JWKS. Preferred: serve it from the application at an `https` URL,
   for example `https://app.example.com/.well-known/jwks.json`, so that keys can rotate without a
   portal change. Each key needs a `kid`.
3. In the portal open **Applications → your app → Security → FAPI 2.0 and client
   authentication**. Set **Client authentication method** to **Private key JWT
   (private_key_jwt)**, enter the **JWKS URI** (or paste an inline JWKS; inline keys are meant for
   testing), and click **Save FAPI settings**. Show the user this change before you make it: the
   client secret stops being the application's authentication method.
4. Store the private key in the deployment's secret store. It never leaves the server.

The application must be confidential. A public client cannot be saved with this method. With
dynamic client registration, send `"token_endpoint_auth_method": "private_key_jwt"` together with
`jwks_uri` or `jwks`, and optionally `token_endpoint_auth_signing_alg`. When an algorithm is
registered, an assertion signed with another algorithm is refused.

## The assertion

| Part | Field | Value |
|---|---|---|
| Header | `alg` | The key's algorithm |
| Header | `kid` | The key ID from the JWKS |
| Claim | `iss` | The client ID |
| Claim | `sub` | The client ID |
| Claim | `aud` | The discovery `issuer`, for example `https://app.lumoauth.dev/orgs/acme-corp/api/v1`. Not the token endpoint URL |
| Claim | `exp` | Required. Keep it about 60 seconds ahead; more than 10 minutes ahead is refused |
| Claim | `jti` | Required, unique. An assertion is accepted once |
| Claim | `iat` | Recommended |

## The request

Replace the client secret with two form parameters. Send no `Authorization: Basic` header and no
`client_secret`: a request may use only one authentication method.

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -d "grant_type=client_credentials" \
  -d "scope=read:reports" \
  -d "resource=https://api.example.com" \
  -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION"
```

The same two parameters authenticate the client at the PAR endpoint and on every grant at the
token endpoint (authorization code, refresh token, client credentials, CIBA, token exchange).

The introspection and revocation endpoints authenticate with the client secret (HTTP Basic or
form body); a public client revokes with `client_id` alone. They do not take client assertions.

## TypeScript

```bash
npm install jose
```

```ts
// client-assertion.ts
import { randomUUID } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";

const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const PRIVATE_KEY_PEM = process.env.LUMOAUTH_CLIENT_PRIVATE_KEY!; // PKCS#8 PEM
const KEY_ID = process.env.LUMOAUTH_CLIENT_KEY_ID!; // kid in the published JWKS
const ALG = "ES256";

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** A new assertion for one request. Never reuse the result. */
export async function clientAssertion(): Promise<string> {
  const key = await importPKCS8(PRIVATE_KEY_PEM, ALG);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: KEY_ID })
    .setIssuer(CLIENT_ID)
    .setSubject(CLIENT_ID)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key);
}

/** Client credentials token request that authenticates with private_key_jwt. */
export async function serviceToken(scope: string, resource: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope,
    resource,
    client_assertion_type: ASSERTION_TYPE,
    client_assertion: await clientAssertion(),
  });
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Token request failed: ${json.error ?? res.status}`);
  return json.access_token;
}
```

Publish the matching public JWKS. One way to produce it from the PEM file:

```ts
// print-jwks.ts: prints the public JWKS for the key above
import { readFileSync } from "node:fs";
import { calculateJwkThumbprint, exportJWK, importSPKI } from "jose";

const publicKey = await importSPKI(readFileSync("client-key.pub.pem", "utf8"), "ES256");
const jwk = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(jwk);
console.log(JSON.stringify({ keys: [{ ...jwk, kid, use: "sig", alg: "ES256" }] }, null, 2));
```

Use the printed `kid` as `LUMOAUTH_CLIENT_KEY_ID`.

Most OIDC libraries build the assertion themselves when you select `private_key_jwt` and give
them the private key. Prefer that to hand-written code.

## Key rotation

1. Add the new public key to the JWKS next to the old one, with a new `kid`.
2. Wait until LumoAuth has fetched the new document, then sign with the new key.
3. Remove the old key from the JWKS.

With an inline JWKS, save the new key set in the portal before the client starts to sign with the
new key.

## Errors

Every failure answers `401` with `{"error": "invalid_client"}`. The response does not say which
check failed. Check in this order:

| Check | Typical mistake |
|---|---|
| The application's method is `private_key_jwt` | The method is still a client secret method |
| `aud` | The token endpoint URL or the bare host was used; it must be the discovery `issuer` |
| `iss` and `sub` | Not both equal to the client ID |
| `exp` | Missing, in the past, or more than 10 minutes ahead (server clock) |
| `jti` | Missing, or the assertion was sent before |
| Signature and key | The JWKS URL is not reachable over `https`, the `kid` is not in it, or the algorithm differs from the registered one |
| One method per request | A Basic header or `client_secret` was sent as well |

## Sources

- https://docs.lumoauth.dev/oauth/fapi
- https://docs.lumoauth.dev/oauth/register
- https://docs.lumoauth.dev/oauth/security
