# Attestation-based client authentication

With this method each instance of an application has its own key pair. A party that you run and
that LumoAuth trusts for this application, the attester, signs a statement that vouches for the
instance and its key. The instance then proves on every request that it holds the key. Discovery
lists the method as `attest_jwt_client_auth`.

Use it when every installed copy of an app, or every spawned worker, needs its own credential and
none of them can hold a shared secret. For one backend with one key, use `private_key_jwt`.

This is client authentication for OAuth applications. It is a different mechanism from workload
attestation for AI agents, where an agent proves where it runs with a platform identity token;
for that use `lumoauth-agent-identity`.

## Parties

| Party | Role |
|---|---|
| Client instance | Creates a key pair, asks the attester for an attestation, signs a proof per request |
| Attester | Your own service (for example the app's backend or a device attestation service). Checks the instance by its own means, then signs the Client Attestation JWT. Publishes its public keys as a JWKS at an `https` URL |
| LumoAuth | Verifies both JWTs on each request |

## Enable it on the application

Portal: **Applications → your app → Security → FAPI 2.0 and client authentication**.

| Setting | Value |
|---|---|
| **Attestation-based client auth (`attest_jwt_client_auth`)** | On |
| **Attester issuer** | The `iss` that the attester puts in its JWTs |
| **Attester JWKS URI** | The `https` URL of the attester's public keys |

Both attester fields are required. Click **Save FAPI settings**. While the switch is off, the
header pair is never accepted. The application must be confidential.

## The two JWTs

Client Attestation JWT, signed by the attester, sent in the `OAuth-Client-Attestation` header:

| Part | Field | Value |
|---|---|---|
| Header | `typ` | `oauth-client-attestation+jwt` |
| Header | `alg` | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384` or `ES512` |
| Claim | `iss` | The registered attester issuer |
| Claim | `sub` | The client ID |
| Claim | `exp` | Required, in the future |
| Claim | `cnf` | `{"jwk": { ... }}`: the public key of the client instance |

Client Attestation PoP JWT, signed by the client instance with the key in `cnf.jwk`, sent in the
`OAuth-Client-Attestation-PoP` header:

| Part | Field | Value |
|---|---|---|
| Header | `typ` | `oauth-client-attestation-pop+jwt` |
| Header | `alg` | From the same list |
| Claim | `iss` | The client ID |
| Claim | `aud` | The discovery `issuer` |
| Claim | `exp` | Required, at most 10 minutes ahead |
| Claim | `jti` | Required, unique. A PoP JWT is accepted once |

The attestation JWT can be reused until it expires. The PoP JWT is new for every request.

## The request

```http
POST /orgs/acme-corp/api/v1/oauth/token HTTP/1.1
Host: app.lumoauth.dev
Content-Type: application/x-www-form-urlencoded
OAuth-Client-Attestation: eyJ0eXAiOiJvYXV0aC1jbGllbnQtYXR0ZXN0YXRpb24rand0Iiwi...
OAuth-Client-Attestation-PoP: eyJ0eXAiOiJvYXV0aC1jbGllbnQtYXR0ZXN0YXRpb24tcG9wK2p3dCIsIm...

grant_type=client_credentials&client_id=CLIENT_ID&scope=read%3Areports
```

Payload of the PoP JWT for this request:

```json
{
  "iss": "CLIENT_ID",
  "aud": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  "exp": 1767225660,
  "jti": "5f3c1c9e-1b2a-4c1e-9d3f-8a7b6c5d4e3f"
}
```

When both headers are present, the request authenticates this way or not at all. LumoAuth does
not fall back to a client secret for that request.

## TypeScript: the client instance

```ts
// attestation-pop.ts
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;

/** Create once per instance. Send `publicJwk` to your attester to obtain the attestation JWT. */
export async function createInstanceKey() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  return { privateKey, publicJwk: await exportJWK(publicKey) };
}

type InstanceKey = Awaited<ReturnType<typeof createInstanceKey>>;

/** A new PoP JWT for one request. */
export async function attestationPop(key: InstanceKey): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "oauth-client-attestation-pop+jwt" })
    .setIssuer(CLIENT_ID)
    .setAudience(ISSUER)
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key.privateKey);
}

/** Token request. `attestationJwt` comes from your attester and names this instance's key in cnf.jwk. */
export async function tokenWithAttestation(
  key: InstanceKey,
  attestationJwt: string,
  scope: string,
): Promise<string> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "OAuth-Client-Attestation": attestationJwt,
      "OAuth-Client-Attestation-PoP": await attestationPop(key),
    },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CLIENT_ID, scope }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Token request failed: ${json.error ?? res.status}`);
  return json.access_token;
}
```

The attester is your own code. It signs a JWT with `typ: oauth-client-attestation+jwt`, its
issuer as `iss`, the client ID as `sub`, a short `exp` and the instance's public key under
`cnf.jwk`, after it has verified the instance in whatever way fits the platform. Keep the
attester's private key away from the client instances.

## Errors

Every failure answers `401` with `{"error": "invalid_client"}`.

| Check | Typical mistake |
|---|---|
| The switch and both attester fields | Not saved, or the application is public |
| `typ` of each JWT | Plain `JWT` |
| Attestation `iss` | Differs from the registered attester issuer |
| Attestation `sub` and PoP `iss` | Not the client ID |
| `cnf.jwk` | Missing, or the PoP is signed with another key |
| PoP `aud` | Not the discovery `issuer` |
| PoP `exp` and `jti` | `exp` missing or too far ahead; `jti` reused |
| Attester JWKS | Not reachable over `https`, or the signing key is not in it |

## Sources

- https://docs.lumoauth.dev/oauth/client-attestation
- https://docs.lumoauth.dev/oauth/fapi
