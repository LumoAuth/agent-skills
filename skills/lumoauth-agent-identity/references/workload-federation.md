# Workload identity federation

A `workload` agent stores no secret. The platform that runs the agent issues it a signed OIDC token
(the platform token). The agent sends that token to LumoAuth and gets a LumoAuth access token back.
LumoAuth checks the token's signature with the platform's public keys, then matches its subject
with the binding that is registered on the agent.

There are two ways to present the platform token. Both run the same checks:

- **Token exchange at the token endpoint** (this file): the request does not name the agent.
  LumoAuth finds the agent from the token's subject.
- **The attestation endpoint**: the request names the agent ID. Read `attestation.md` in this
  folder.

Availability of workload identity for some platforms depends on the organization's plan (see
https://docs.lumoauth.dev/pricing-matrix).

## 1. Register the agent with a binding

In the portal: **AI Agents → Agents → Register agent**, step 2, **Workload identity**, then pick
the platform under **Where it runs** and fill in its fields. The form shows the **audience** that
the platform must put in the token. Copy it.

With the Admin API, send `identityType: "workload"`, `workloadIdentityProvider` and
`workloadIdentityConfig`. Show the user the request before you send it.

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/agents" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nightly report runner",
    "identityType": "workload",
    "workloadIdentityProvider": "k8s",
    "workloadIdentityConfig": {
      "issuer": "https://oidc.example.com/cluster-1",
      "namespace": "agents",
      "service_account": "report-runner"
    },
    "capabilities": ["reports.send"]
  }'
```

Provider values and their configuration keys (bold = required). `audience` is filled with the
agent-specific default when you leave it out.

| `workloadIdentityProvider` | Keys | Binding subject that LumoAuth stores |
|---|---|---|
| `github` | **`repository`**, `ref`, `environment`, `repository_id`, `repository_owner_id`, `job_workflow_ref`, `sub`, `allow_any_ref` | `github:owner/repo[:refs/heads/main]` |
| `k8s` | **`issuer`**, **`namespace`**, **`service_account`** | `k8s:namespace/serviceaccount` |
| `aws` (EKS IRSA only) | **`issuer`**, **`namespace`**, **`service_account`** | `aws:irsa:namespace/serviceaccount` |
| `gcp` | **`service_account_email`**, `project_id` | `gcp:sa@project.iam.gserviceaccount.com` |
| `azure` | **`tenant_id`**, `client_id`, `object_id`, `allow_tenant_wide` | `azure:<tenant_id>:<client_id>` |
| `spiffe` | **`trust_domain`**, **`audience`**, and **`issuer`** or **`jwks_uri`** | The SPIFFE ID |
| `custom` (any OIDC issuer) | **`issuer`**, `jwks_uri`, `claims` | The exact `sub` claim |

GitLab CI, Azure DevOps, CircleCI, Buildkite, HCP Terraform, Vercel and Cloudflare are also
offered in the portal form (`gitlab`, `azure_devops`, `circleci`, `buildkite`, `terraform_cloud`,
`vercel`, `cloudflare`).

AWS support is EKS with IAM Roles for Service Accounts. Plain EC2, Lambda and ECS have no OIDC
token: use a `private_key_jwt` agent there.

## 2. Mint the platform token for the agent audience

The default audience is the agent's own URL:

```
https://app.lumoauth.dev/orgs/<orgId>/api/v1/agents/<agentId>
```

The token's `aud` must contain the configured audience exactly.

| Platform | How to get a token with that audience |
|---|---|
| GitHub Actions | `permissions: id-token: write`, then `curl -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=<audience>"` |
| Kubernetes, EKS | A projected volume: `serviceAccountToken: { audience: <audience>, expirationSeconds: 600, path: token }` |
| GCP | `curl -H 'Metadata-Flavor: Google' 'http://metadata/computeMetadata/v1/instance/service-accounts/default/identity?audience=<audience>&format=full'` |
| Azure | Request a managed identity token with `resource=<audience>` |
| SPIRE | `spire-agent api fetch jwt -audience <audience>` |

Kubernetes example:

```yaml
volumes:
  - name: lumoauth-token
    projected:
      sources:
        - serviceAccountToken:
            audience: https://app.lumoauth.dev/orgs/acme-corp/api/v1/agents/agt_0123456789abcdef
            expirationSeconds: 600
            path: token
```

## 3. Exchange the platform token

```python
import os

import requests

LUMOAUTH_URL = os.environ.get("LUMOAUTH_URL", "https://app.lumoauth.dev")
ORG_ID = os.environ["LUMOAUTH_ORG_ID"]


def get_agent_token(platform_token: str) -> str:
    response = requests.post(
        f"{LUMOAUTH_URL}/orgs/{ORG_ID}/api/v1/oauth/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "subject_token": platform_token,
            "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


# The path where the projected volume above is mounted.
with open("/var/run/secrets/lumoauth/token") as f:
    access_token = get_agent_token(f.read().strip())
```

The request carries no `client_id` and no secret. The response is a normal token response with
`access_token`, `token_type`, `expires_in` (at most one hour) and `scope` (the agent's
capabilities). Send the access token as `Authorization: Bearer …` to the Ask API and the other
agent routes.

The SDK agent classes authenticate with a secret or a private key, not with a platform token.
With a workload agent, get the token as shown and call the HTTP API, or use `attestWorkload` from
`@lumoauth/agent` (see `attestation.md`).

## Rules that cause most failures

- A platform token is accepted **once**. Fetch a new one for every exchange. On Kubernetes, read
  the projected file again only after kubelet has rotated it.
- The token needs `exp`, and must expire within 24 hours. Ask for 10 minutes.
- The agent must be `active`.
- A failed exchange does not say why. The reason is not returned to the caller. Use the
  attestation endpoint while you debug: its rejections are written to the audit log as
  `agent.attestation.rejected` with a `reason`.
- `403 access_denied` or `access_policy_denied` after a valid token: a conditional access policy
  denied the agent. See `lumoauth-agent-governance`.

## Bind tightly

- GitHub: pin `ref` (for example `refs/heads/main`) or `environment`. A binding to the repository
  alone needs `allow_any_ref: true` and lets a fork pull request act as the agent.
- Also pin `repository_id` and `repository_owner_id`: they stay the same after a rename.
- Azure: a binding to the directory alone needs `allow_tenant_wide: true`. Give `client_id`.
- Keep the agent-specific audience. An audience that is not a LumoAuth URL (such as
  `sts.amazonaws.com`) is accepted but flagged as generic, because any token that the platform
  mints for that audience then satisfies the agent.

Docs: https://docs.lumoauth.dev/agents/workload-federation
