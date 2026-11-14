# Key storage and HSMs

Every organization signs its tokens with its own key: ID tokens, access tokens, SAML assertions and agent tokens. By default LumoAuth generates and stores the key, encrypted at rest. An organization can instead hold the private key in a key service or HSM that it controls. LumoAuth then asks that provider for each signature.

- Page: `/orgs/{orgId}/portal/signing-keys` (**Security → Signing keys**). Key storage is not a section of the Integrations page; the provider is chosen when a key is generated.
- API and CLI: none for key storage. Portal only.
- Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

## Generate a key at an external provider

1. Open the page and click **Generate new key**.
2. Choose the **Algorithm** (RSA, ECDSA or RSA-PSS and its variant). Available: `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512`.
3. Under **Key storage**, select the provider. Its fields appear. Enter them.
4. Under **Activation and rotation**, set **Sign new tokens with this key** and the **Rotate after** period.
5. Click **Generate key**. The form checks the connection to the provider before anything is created.

Generate the first external key with **Sign new tokens with this key** off, verify it, then make it the primary key. Keep a second, non-primary key as a fallback.

## Providers

| Provider | Where the private key is | Signing happens |
|---|---|---|
| **Local** (default) | LumoAuth, encrypted at rest | In LumoAuth |
| **Azure Key Vault** | Azure Key Vault | In Azure |
| **AWS KMS** | AWS KMS | In AWS |
| **Google Cloud KMS** | Cloud KMS | In Google Cloud |
| **HashiCorp Vault** | Vault `transit` engine | In Vault |
| **Akeyless** | Akeyless | In Akeyless |
| **Azure Managed HSM** | A Managed HSM pool | In the HSM |
| **Thales CipherTrust** | A CipherTrust Manager appliance | In the appliance |
| **Fortanix DSM** | Fortanix DSM | In the HSM |
| **Entrust KeyControl** | KeyControl Vault | In the vault |
| **Oracle OCI Vault** | OCI Vault (`HSM` or `SOFTWARE` protection mode) | In OCI |
| **IBM Key Protect** (also HPCS) | Wrapped by the organization's root key | In LumoAuth (see the note below) |
| **OpenBao** | OpenBao `transit` engine | In OpenBao |
| **PKCS#11 HSM** | Any HSM with a PKCS#11 library, through a signing sidecar | In the HSM |

## Fields that the documentation lists

| Provider | Fields |
|---|---|
| **Azure Managed HSM** | HSM pool name (or the full vault URL); tenant ID, client ID and client secret of a service principal with the **Managed HSM Crypto User** role |
| **Thales CipherTrust** | CipherTrust Manager URL; user name and password, or API key; optional domain |
| **Fortanix DSM** | DSM endpoint (`https://apps.smartkey.io`, `eu.smartkey.io`, `uk.smartkey.io` or the organization's own); app API key; optional group ID |
| **Entrust KeyControl** | KeyControl Vault URL; user name and password of a vault user with key create and sign rights; optional vault ID |
| **Oracle OCI Vault** | Management endpoint; crypto endpoint; tenancy OCID, user OCID, fingerprint and private key (PEM) of the API signing key; compartment OCID; protection mode |
| **OpenBao** / **HashiCorp Vault** | Address; a token, or an AppRole role ID and secret ID; mount path (default `transit`) |
| **IBM Key Protect** | IAM API key; instance ID; region; optional endpoint, root key ID and key ring ID |
| **PKCS#11 HSM** | Sidecar base URL; bearer token |

For Azure Key Vault, AWS KMS, Google Cloud KMS and Akeyless, read the fields from the form and ask the user for each value.

## Rules for every external provider

- Endpoints must be public HTTPS hosts.
- Credentials are encrypted at rest and are not shown again.
- Keys are generated inside the provider and marked non-extractable where the provider allows it. An existing private key cannot be imported into an external provider.
- LumoAuth stores only the public key and the provider's key identifier. The JWKS and token verification keep working when the provider is unreachable. Signing does not: no new tokens are issued with that key.
- Disabling or deleting the key at the provider stops token issuance for that key at once. Plan for this before any maintenance at the provider.

**IBM Key Protect note.** This provider uses envelope encryption, not remote signing: the private key is wrapped by the organization's root key and unwrapped into LumoAuth's memory at signing time. If signing must happen entirely inside an HSM, use the PKCS#11 option with the vendor's PKCS#11 library.

**AWS CloudHSM note.** There is no separate CloudHSM option: an AWS KMS custom key store backed by CloudHSM holds symmetric keys only. Use the PKCS#11 option with the AWS CloudHSM client.

## PKCS#11 through a signing sidecar

Any HSM with a PKCS#11 library (for example Entrust nShield, Thales Luna, Utimaco, YubiHSM 2) is reached through a small HTTPS service that the organization runs next to its HSM. The sidecar owns the PKCS#11 session.

```text
LumoAuth  --HTTPS + Bearer token-->  sidecar  --PKCS#11-->  HSM
```

Requirements for the sidecar address:

- A public HTTPS address, for example `https://hsm-sidecar.example.com:8443`. An address in a private or loopback range is refused.
- A certificate that chains to a public certificate authority.
- The URL has a host and carries no credentials.
- The bearer token authenticates LumoAuth to the sidecar. Use a long random value, and restrict the sidecar to that token.

### HTTP contract that the sidecar implements

Every call carries `Authorization: Bearer <token>` and JSON. `alg` is the JOSE algorithm name (`RS256` to `ES512`).

| Method | Path | Request body | Success |
|---|---|---|---|
| GET | `/v1/health` | - | `200 {"status":"ok","token_label":"...","slot":0,"mechanisms":[...]}` |
| POST | `/v1/keys` | `{"alg":"RS256","key_size":3072,"label":"lumoauth-ab12"}` | `201 {"key_id":"...","public_key_pem":"-----BEGIN PUBLIC KEY-----..."}` |
| POST | `/v1/keys/{id}/sign` | `{"alg":"RS256","data_b64":"<base64 signing input>"}` | `200 {"signature_b64":"..."}` |
| POST | `/v1/keys/{id}/verify` | `{"alg":"...","data_b64":"...","signature_b64":"..."}` | `200 {"valid":true}` |
| DELETE | `/v1/keys/{id}` | - | `204` |

Errors are `{"error":"..."}` with `400`, `401`, `404`, `500` or `501`.

Details that an implementation must get right:

1. `data_b64` is the unhashed signing input. The sidecar chooses the PKCS#11 mechanism and the HSM computes the digest.
2. Signatures are returned in JWS form: raw `R‖S` for `ES*`, and for `PS*` MGF1 with a salt length equal to the digest length.
3. `/v1/keys/{id}/verify` is optional. Answer `501` or `404` and LumoAuth verifies with the stored public key.
4. `key_id` is whatever the sidecar returns. LumoAuth stores it as the external key ID.

## Rotation and troubleshooting

- **Rotate key** on the Signing keys page creates a new key at the provider. The old key stays valid for verification during the grace period, so issued tokens keep validating.
- Errors at generation: `connection_failed` (the provider cannot be reached), `authentication_failed` (bad credentials), `key_not_found` (the key was deleted or disabled).
- Apps and APIs verify tokens against the organization's JWKS as before. A new key has a new `kid`; verifiers must refetch the JWKS on an unknown `kid`.

## Reference

- https://docs.lumoauth.dev/integrations/key-storage
