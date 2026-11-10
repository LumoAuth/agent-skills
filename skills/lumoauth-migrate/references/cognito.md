# Migrate from AWS Cognito

No importer exists for Cognito user pools. Export the users with the AWS CLI, reshape them
with `jq`, and create them with the import loop.

## 1. Export

```bash
aws cognito-idp list-users --user-pool-id <user pool id> --output json > cognito-users.json
jq '.Users | length' cognito-users.json
```

The AWS CLI follows the pagination of `ListUsers` by itself and writes one document with
all users under `Users`. If the count is lower than the pool's user count, the command ran
with pagination switched off; run it without `--no-paginate` and without `--max-items`.

## 2. Field mapping

Cognito stores attributes as a list of `Name` and `Value` pairs under `Attributes`.

| Cognito | LumoAuth field |
|---|---|
| Attribute `email` | `email` |
| Attribute `email_verified` equal to `"true"` | `emailVerified` |
| Attributes `name`, `given_name`, `family_name` | `name`, `givenName`, `familyName` |
| Attribute `phone_number` | `phoneNumber` |
| `UserStatus == "CONFIRMED"` and `Enabled` | `isActive` |
| Attribute `sub` (or `Username`) | The mapping table |
| Custom attributes (`custom:...`), phone verification state, `UserCreateDate` | The application's database, keyed by the LumoAuth user ID |

With this mapping, a user who never confirmed the account (`UNCONFIRMED`) or was created
by an admin and never signed in (`FORCE_CHANGE_PASSWORD`) is imported as inactive. Ask the
user whether such accounts should be active; if so, change the `isActive` line to
`(.Enabled != false)`.

## 3. Reshape

`cognito.jq` (run against a sample export):

```jq
.Users[]
| (.Attributes | map({key: .Name, value: .Value}) | from_entries) as $a
| {
    source_id: ($a.sub // .Username),
    user: {
      email: $a.email,
      emailVerified: ($a.email_verified == "true"),
      name: $a.name,
      givenName: $a.given_name,
      familyName: $a.family_name,
      phoneNumber: $a.phone_number,
      isActive: (.UserStatus == "CONFIRMED" and .Enabled != false)
    }
  }
```

```bash
jq -c -f cognito.jq cognito-users.json > lumo-users.ndjson
wc -l < lumo-users.ndjson
```

A pool that lets users sign in with a phone number or a user name can hold users without
an email. The import loop writes them to `failed.ndjson` with the error `no email`.

## 4. Import

Use `import-users.sh` from `import-loop.md`. Show the user the command and the user count
first, run five users, then the rest:

```bash
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson
bash import-users.sh lumo-users.ndjson
```

`mapping.csv` then holds `cognito_sub,lumoauth_user_id` for every user.

## 5. Groups

```bash
aws cognito-idp list-groups --user-pool-id <user pool id> --output json > cognito-groups.json

# Show this loop to the user before you run it.
jq -c '.Groups[] | {name: .GroupName, description: (.Description // "")}' cognito-groups.json \
| while IFS= read -r group; do
  name=$(jq -r '.name' <<<"$group")
  description=$(jq -r '.description' <<<"$group")
  lumo groups create --name "$name" --description "$description" -o json | jq '{id: .data.id, slug: .data.slug}'
done
```

For each group, list the members and add them by email:

```bash
aws cognito-idp list-users-in-group --user-pool-id <user pool id> --group-name <group> --output json \
  | jq -r '[.Users[].Attributes[] | select(.Name == "email") | .Value] | join(",")' > members.txt
lumo groups members add <group-id-or-slug> --users "$(cat members.txt)" -o json
```

If the application reads `cognito:groups` from tokens for authorization, map the groups to
LumoAuth roles as well: `lumoauth-rbac`.

## 6. App clients and identity providers

| Cognito | LumoAuth |
|---|---|
| App client with a secret | `lumo apps create --name "<name>" --redirect-uris <uri,...> -o json` |
| App client without a secret (single-page, mobile) | `lumo api POST /clients --data '{"name":"<name>","redirectUris":["<uri>"],"isConfidential":false}' -o json` |
| Federated identity providers of the hosted UI (Google, Facebook, Apple, SAML, OIDC) | Social login providers and enterprise SSO connections in LumoAuth |
| Lambda triggers (pre sign-up, post confirmation, pre token generation, ...) | Application code or webhook handlers. LumoAuth does not run custom code in the sign-in flow |

## 7. What does not carry over

- **Passwords.** Cognito does not export them. Users reset the password or use a magic
  link.
- **MFA settings.** Users enroll again.
- **Users who only used a federated provider.** They use the same provider in LumoAuth;
  the link to the imported account follows the linking rule in `SKILL.md`.
- **Cognito access, ID and refresh tokens.** Not accepted by LumoAuth.

## 8. Cognito-specific cut-over notes

- Applications that use the Amplify Auth library or the Cognito hosted UI move to a
  LumoAuth SDK or to a generic OIDC library (step 6 of `SKILL.md`).
- APIs behind an API Gateway Cognito authorizer need another authorizer for LumoAuth
  tokens (a JWT authorizer with LumoAuth's issuer and audience, or validation in the
  service): `lumoauth-api-protection`.
- To keep Cognito as the front for a while, a post-authentication trigger can create or
  update the user in LumoAuth on every successful sign-in through the Admin API. That
  keeps the user list current until the switch. Keep the API key for it in a secret store.
