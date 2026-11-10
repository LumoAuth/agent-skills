# Private key JWT agents

A `private_key_jwt` agent has no shared secret. For every token request it signs a short JWT (a
client assertion, RFC 7523) with its private key. LumoAuth stores only the public key. Use this
type when the platform issues no workload token but the agent can keep a private key: a VM, an
on-premises host, AWS Lambda or EC2.

The JS, Python and Go SDKs sign the assertion for you. The .NET, Java and PHP SDKs do not: use the
raw HTTP form at the end of this file there.

## 1. Create a key pair

Generate the key where the agent runs, so that the private key never travels.

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out agent-private-key.pem
```

Or let the SDK generate one and print the public key set (JWKS) to register:

```python
# pip install "lumoauth[dpop]"   (the extra installs the cryptography package)
import json
from lumoauth import ClientAssertionSigner

signer = ClientAssertionSigner.generate("ES256", key_id="agent-2026-11")
print(json.dumps(signer.jwks()))      # register this
private_pem = signer.to_pem()         # store this in a secrets manager; never print or commit it
```

```ts
import { ClientAssertionSigner } from '@lumoauth/agent';

const signer = ClientAssertionSigner.generate('ES256', 'agent-2026-11');
console.log(JSON.stringify(signer.jwks));   // register this
const privatePem = signer.privateKeyPem;    // store this in a secrets manager; never print or commit it
```

Accepted keys:

| Key type | Curve or size | Algorithms |
|---|---|---|
| EC | P-256 | `ES256` |
| EC | P-384 | `ES384` |
| EC | P-521 | `ES512` |
| OKP | Ed25519 | `EdDSA` |
| RSA | 2048 bits or more | `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512` |

A key set holds 1 to 10 keys. Each key needs a `kid` when the set holds more than one. A key set
that contains private key material (`d`, `p`, `q`) is refused as a whole.

## 2. Register the agent

Show the user the request before you send it.

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/agents" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Invoice agent",
    "identityType": "private_key_jwt",
    "jwksUri": "https://agent.example.com/.well-known/jwks.json",
    "capabilities": ["invoices.read"]
  }'
```

Send `jwks` (the key set as a JSON object) instead of `jwksUri` to register the keys inline. Give
exactly one of the two. A JWKS URL must be an absolute `https` URL on a public address.

A private key JWT agent must be registered together with its public keys: a request with neither
`jwks` nor `jwksUri` gets `400`. `lumo agents create` has no flag for keys, so register this type
with the Admin API request above (for example through `lumo api`, see `lumoauth-cli`) or in the
portal.

In the portal: **AI Agents → Agents → Register agent**, step 2, **Private key JWT**, then a
**JWKS URL** or **Public keys (JWKS)**.

## 3. Authenticate with the SDK

Environment: `AGENT_CLIENT_ID` (the agent ID), `AGENT_PRIVATE_KEY` (the PEM key), `AGENT_KEY_ID`
(the `kid`), `LUMOAUTH_ORG_ID`, and `LUMOAUTH_URL` when not the US region. Do not set
`AGENT_CLIENT_SECRET`: passing both a secret and a key is an error.

```python
from lumoauth import LumoAuthAgent

agent = LumoAuthAgent()   # finds AGENT_PRIVATE_KEY and signs an assertion for each token request
if not agent.authenticate():
    raise SystemExit("Agent authentication failed")
print(agent.ask("invoices.read")["allowed"])
```

```ts
import { LumoAgent } from '@lumoauth/agent';

const agent = new LumoAgent();   // finds AGENT_PRIVATE_KEY and signs an assertion for each token request
await agent.authenticate();
console.log(await agent.isAllowed('invoices.read'));
```

```go
package main

import (
	"context"
	"fmt"
	"log"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	ctx := context.Background()
	// Reads AGENT_CLIENT_ID, AGENT_PRIVATE_KEY and AGENT_KEY_ID.
	agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{})
	if err != nil {
		log.Fatal(err)
	}
	allowed, err := agent.IsAllowed(ctx, "invoices.read", nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(allowed)
}
```

To pass the key in code, give `private_key=` and `key_id=` (Python), `privateKey` and `keyId` (JS),
or `PrivateKey` (a `*ClientAssertionSigner` from `lumoauth.LoadClientAssertionSigner(pem,
lumoauth.ClientAssertionOptions{KeyID: "agent-2026-11"})`) in Go.

On a custom domain, set `issuer` (`Issuer` in Go) to the organization's issuer identifier. The
default is `{base URL}/orgs/{orgId}/api/v1`.

## 4. The assertion, for other languages

Header: `alg` (matches the key), `kid`, `typ` = `client-authentication+jwt`.

| Claim | Value |
|---|---|
| `iss` and `sub` | The agent ID, for example `agt_0123456789abcdef` |
| `aud` | The organization's issuer identifier: the `issuer` value of `/orgs/{orgId}/api/v1/.well-known/openid-configuration`, for example `https://app.lumoauth.dev/orgs/acme-corp/api/v1` |
| `exp` | At most 10 minutes from now. Use 60 seconds |
| `jti` | A unique value of 16 to 255 characters, such as a random UUID |

`aud` is the issuer, not the token endpoint URL. An assertion with the token endpoint as audience
is refused. Each assertion is accepted once: sign a new one for every request.

```http
POST /orgs/acme-corp/api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<the signed JWT>
```

`client_id` is optional; if sent, it must be the agent ID. Do not send `client_secret` as well.

## Rotate keys

- With a JWKS URL: publish the new key next to the old one with a new `kid`, switch the agent to
  the new key, then remove the old key from the document.
- With inline keys: send the whole new set in `jwks` with
  `PATCH /orgs/{orgId}/api/v1/admin/agents/{agentId}`, switch the agent, then remove the old key.

Removing an inline key, or switching between a URL and inline keys, revokes the access tokens that
the agent holds. Adding a key revokes nothing. Only an admin who holds every capability of the
agent can change its keys.

## Errors

Every refused assertion returns `401` with `"error": "invalid_client"`. The reason is written to
the organization's audit log as `agent.client_assertion_rejected`. Common reasons:

| Reason | Fix |
|---|---|
| `wrong_audience` | Set `aud` to the issuer identifier, and nothing else |
| `kid_required`, `unknown_kid` | Send the `kid` of a registered key |
| `no_keys_registered` | Add a public key to the agent |
| `lifetime_too_long` | Set `exp` at most 10 minutes ahead |
| `replayed` | Sign a new assertion with a new `jti` for each request |
| `bad_signature` | The private key does not match a registered public key |
| `expired`, `not_yet_valid` | Check the clock of the host. LumoAuth allows 60 seconds of difference |

Docs: https://docs.lumoauth.dev/agents/private-key-jwt
