# Secrets managers and deploy targets

A connected secrets manager lets LumoAuth read integration credentials from the place where the team already keeps them. A deploy target lets LumoAuth write a new client ID and client secret into the deploy platform.

- Page: `/orgs/{orgId}/portal/integrations/secrets` (**Integrations → Secrets & developer sync**). Two lists: **Secrets managers** and **Deploy targets**.
- API and CLI: none. Portal only.

A secrets manager does up to three things:

1. Resolves `secret://` references in the configuration of other integrations.
2. Holds the key-encryption key for the token vault (bring your own key).
3. Doppler only: also serves as a deploy target.

## Supported managers

| Manager | The user must supply | Reference syntax (the part after the slug) |
|---|---|---|
| **1Password Connect** | Connect server URL, Connect API token | `op://<vault>/<item>/<field>` |
| **Doppler** | Service or personal token, project, config | The secret name, `UPPER_SNAKE_CASE` |
| **Infisical** | Client ID and secret of a Universal Auth machine identity, project, environment, optional secret path | The secret name |
| **AWS Secrets Manager** | Region, access key ID, secret access key, optional session token and endpoint | `<name-or-arn>` or `<name-or-arn>#<json-key>` |
| **CyberArk Conjur** | Appliance URL, account, login (for example `host/lumoauth`), API key | The variable ID, for example `prod/lumoauth/datadog-api-key` |
| **HashiCorp Vault / OpenBao KV v2** | Address and a token, or an AppRole role ID and secret ID; optional namespace and mount | `<path>#<key>` (the key defaults to `value`) |

## Add a manager

1. Pick the provider in the selector next to **Add manager**.
2. Enter a **Name** and a **Slug**. The slug is the handle in `secret://` references.
3. Enter the credentials. Give the manager credential read access only to the secrets that LumoAuth needs.
4. In the **Purposes** section:
   - turn **Resolve `secret://` references** on;
   - fill **Allowed references**, one entry per line: an exact reference, or a prefix that ends in `*` (for example `prod/lumoauth/*` or `op://Production/*`). An empty list resolves nothing.
5. Turn **Enabled** on and save.
6. Click **Test connection**. It runs a live read and shows the provider's own message.

## `secret://` references

Any integration credential field accepts a reference instead of a literal value:

```text
secret://<manager-slug>/<provider-specific-ref>
```

Examples:

```text
secret://onepassword/op://Production/LumoAuth Datadog/api key
secret://doppler/DATADOG_API_KEY
secret://infisical/DATADOG_API_KEY
secret://aws/prod/lumoauth#datadog_api_key
secret://conjur/prod/lumoauth/datadog-api-key
secret://vault/lumoauth/prod#datadog_api_key
```

Rules:

- The slug must belong to an enabled manager with **Resolve `secret://` references** on, and the reference must match **Allowed references**. Otherwise the reference is refused.
- A value that does not start with `secret://` is used as a literal.
- References are resolved when the credential is used. The stored configuration keeps the reference, and the secret is not written to LumoAuth's database. A secret that is rotated at the manager is used from the next request on.
- Resolution fails closed: when a reference cannot be resolved, the call that needed it fails. The literal `secret://...` string is never sent to the provider.
- Slugs are normalised: lower case, other characters folded to `-`.
- References work in: outbound SCIM credentials, SMS providers, the email provider, deploy targets, agent registries, AI gateways and device posture integrations.

## Token-vault key (bring your own key)

The token vault stores the third-party OAuth tokens that agents use (see `lumoauth-agent-delegation`). To seal those rows under the organization's own key:

1. On one manager, turn on **Hold the token-vault key (BYOK envelope encryption)** in **Purposes** and give it the reference of the key secret.
2. The secret must be 16 bytes or longer (32 or more recommended).

Consequences to tell the user before enabling:

- Existing rows keep working and are re-encrypted under the new key afterwards.
- Revoking LumoAuth's access to the key makes the rows undecryptable. Agents lose their linked connections until access is restored.
- Changing the key value at the manager invalidates rows that were sealed under the old value. Do not rotate it casually.
- The key reference cannot be read through `secret://`, and a manager that holds the key has reference resolution off by default.

## Deploy targets (developer secret sync)

When an OAuth client is created or its secret is rotated, the portal shows the credentials once. **Sync credentials…** in the **Sync credentials to a deploy target** card on that screen pushes them to a configured target.

| Target | What is written | The user must supply |
|---|---|---|
| **Vercel** | Project environment variables (upserted) | Token, project ID, optional team ID, optional targets (`production`, `preview`, `development`) |
| **Netlify** | Account or site environment variables | Personal access token, account slug, optional site ID |
| **GitHub Actions** | Repository or environment secrets | Fine-grained personal access token with **Secrets: write**, owner, repository, optional environment |
| **Doppler** | Secrets in one project and config | Service token, project, config |

- The variable names are `LUMO_CLIENT_ID` and `LUMO_CLIENT_SECRET`.
- Each target has a **Test connection** action that checks the token and scope without writing.
- Values for GitHub Actions are sealed with the repository's public key before they are sent.

In the app, read the synced variables on the server only:

```ts
// config.ts — server only
const clientId = process.env.LUMO_CLIENT_ID;
const clientSecret = process.env.LUMO_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  throw new Error("LUMO_CLIENT_ID and LUMO_CLIENT_SECRET must be set");
}
export const lumoClient = { clientId, clientSecret };
```

If the SDK in use reads other variable names, map them in the app's configuration. Never expose `LUMO_CLIENT_SECRET` to browser code (for example through a `NEXT_PUBLIC_` or `VITE_` prefix).

## Troubleshooting

| Message | Cause |
|---|---|
| *No enabled secrets manager with slug "x"* | The slug matches no enabled manager of this organization |
| *Secrets manager "x" is not allowed to resolve references* | **Resolve `secret://` references** is off |
| *Blocked … URL (must be a public HTTPS address)* | The endpoint is `http://` or a private address |
| *Token vault row is BYOK-encrypted (v2) but the organization has no vault KEK configured* | The token-vault key flag was cleared while rows still use it. Turn it on again. |
| *Token vault v2 decryption failed (wrong or rotated KEK)* | The key value changed at the manager. Restore the previous value, or link the affected connections again. |

## Reference

- https://docs.lumoauth.dev/integrations/secrets-managers
