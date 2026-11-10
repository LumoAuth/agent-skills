# Migrate from Okta

No importer exists for Okta. Decide first which of two routes fits:

| Route | When |
|---|---|
| **Keep Okta as the identity provider.** LumoAuth trusts Okta through an enterprise OIDC connection; people keep signing in at Okta | The workforce or the customers know "Sign in with Okta", and Okta stays in place |
| **Move the users.** Export from Okta, create in LumoAuth | Okta is retired |

Ask the user which one they want. Many Okta projects want the first.

## Route A: keep Okta as the identity provider

Set up Okta as an upstream OIDC identity provider in the portal:

1. **Settings**, **Integrations**, **Enterprise SSO (OIDC)**, **Add OIDC IdP**
   (`/orgs/{orgId}/portal/oidc-idps/new`).
2. Choose the Okta template and enter the Okta domain, or enter the issuer URL
   (`https://<okta domain>`). The endpoints are discovered from the issuer.
3. Register the callback URL that the form shows (`/orgs/{orgId}/oidc/rp/callback` on the
   organization's base URL) as a sign-in redirect URI of an OIDC app in Okta.
4. Enter a display name and the client ID and client secret of that Okta app.

An OIDC connection signs in only accounts that are already linked to it. Plan how accounts
get linked before you announce the sign-in. For the details and for SAML, use
`lumoauth-enterprise-sso`; for provisioning from Okta, use `lumoauth-scim`.

The applications then move from Okta's SDKs to LumoAuth (step 6 of `SKILL.md`), and
LumoAuth issues the tokens.

## Route B: move the users

### 1. Export

```bash
curl -sS "https://<okta domain>/api/v1/users?limit=200" \
  -H "Authorization: SSWS $OKTA_API_TOKEN" -H "Accept: application/json" \
  -D okta-headers.txt > okta-users-1.json
```

Okta pages with a `Link: <...>; rel="next"` response header. Follow it until it is absent,
then join the pages: `jq -s 'add' okta-users-*.json > okta-users.json`. Keep the API token
in an environment variable.

### 2. Field mapping

| Okta field | LumoAuth field |
|---|---|
| `profile.email` | `email` |
| `profile.firstName`, `profile.lastName` | `givenName`, `familyName`, and joined as `name` |
| `profile.login` | `username` |
| `profile.mobilePhone` | `phoneNumber` |
| `status == "ACTIVE"` | `isActive` |
| `id` (`00u...`) | The mapping table |
| Custom profile attributes, `created`, `lastLogin` | The application's database, keyed by the LumoAuth user ID |

Okta's user object has no email verification flag in this export. The filter below sets
`emailVerified: true`, as the LumoAuth documentation does, on the assumption that Okta
addresses were verified or assigned by an admin. Ask the user whether that holds. If it
does not, set it to `false`: users then verify the address in LumoAuth.

### 3. Reshape

`okta.jq` (run against a sample export):

```jq
.[]
| {
    source_id: .id,
    user: {
      email: .profile.email,
      emailVerified: true,
      name: ([.profile.firstName, .profile.lastName] | map(select(. != null and . != "")) | join(" ")),
      givenName: .profile.firstName,
      familyName: .profile.lastName,
      username: .profile.login,
      phoneNumber: .profile.mobilePhone,
      isActive: (.status == "ACTIVE")
    }
  }
```

```bash
jq -c -f okta.jq okta-users.json > lumo-users.ndjson
wc -l < lumo-users.ndjson
```

### 4. Import

Use `import-users.sh` from `import-loop.md`. Show the user the command and the user count
first, run five users, then the rest:

```bash
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson
bash import-users.sh lumo-users.ndjson
```

`mapping.csv` then holds `okta_user_id,lumoauth_user_id` for every user.

### 5. Groups

```bash
curl -sS "https://<okta domain>/api/v1/groups?limit=200" \
  -H "Authorization: SSWS $OKTA_API_TOKEN" > okta-groups.json

# Show this loop to the user before you run it.
jq -r '.[].profile.name' okta-groups.json | while IFS= read -r name; do
  lumo groups create --name "$name" -o json | jq '{id: .data.id, slug: .data.slug}'
done
```

For each group, export its members (`/api/v1/groups/<group id>/users`) and add them by
email:

```bash
lumo groups members add <group-id-or-slug> \
  --users "$(jq -r '[.[].profile.email] | join(",")' members-<group id>.json)" -o json
```

### 6. Applications

| Okta app | LumoAuth |
|---|---|
| OIDC web app | `lumo apps create --name "<name>" --redirect-uris <uri,...> --grant-types authorization_code,refresh_token -o json` |
| OIDC single-page or native app | `lumo api POST /clients --data '{"name":"<name>","redirectUris":["<uri>"],"isConfidential":false}' -o json` |
| SAML app (Okta as identity provider for an application) | LumoAuth as SAML identity provider for that application: `lumoauth-enterprise-sso` |

### 7. What does not carry over

- **Passwords.** Not exported by Okta. Users reset the password or use a magic link.
- **MFA enrollments.** Users enroll again in LumoAuth.
- **Sign-on policies.** Recreate the intent with the MFA policy and adaptive MFA
  (`lumoauth-mfa-passkeys`).
- **Sessions.** Okta sessions are not accepted by LumoAuth.

### 8. Code

Okta-protected applications are usually OpenID Connect clients. Point them at LumoAuth's
discovery document with a new client ID (`lumoauth-oauth-oidc`), or move to a LumoAuth SDK
(the framework skills). Replace the Okta Sign-In Widget with LumoAuth's hosted sign-in page.
