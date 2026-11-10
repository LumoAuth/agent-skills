# Migrate from Clerk

No importer exists for Clerk. Export the users, reshape them with `jq`, and create them
with the import loop.

## 1. Export the users

Export the users as JSON from the Clerk dashboard, or page through Clerk's Backend API
with the instance's secret key (keep that key in an environment variable):

```bash
curl -sS "https://api.clerk.com/v1/users?limit=500&offset=0" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" > clerk-users-0.json
```

Raise `offset` by 500 until a page is empty, then join the pages:

```bash
jq -s 'map(if type == "array" then . else .data end) | add' clerk-users-*.json > clerk-users.json
```

Look at the shape before you reshape it: `jq 'type' clerk-users.json` and
`jq '.[0] | keys' clerk-users.json`.

## 2. Field mapping

| Clerk field | LumoAuth field |
|---|---|
| The primary entry of `email_addresses[]` (`primary_email_address_id`), `.email_address` | `email` |
| That entry's `verification.status == "verified"` | `emailVerified` |
| `first_name`, `last_name` | `givenName`, `familyName`, and joined as `name` |
| `username` | `username` (a profile field; users sign in with the email) |
| `image_url` | `picture`, set after creation |
| `id` (`user_2...`) | The mapping table |
| `public_metadata`, `private_metadata`, `unsafe_metadata` | The application's database, keyed by the LumoAuth user ID |

## 3. Reshape

`clerk.jq` (run against sample exports in both shapes, a bare array and `{"data": [...]}`):

```jq
(if type == "array" then . else .data end)[]
| . as $u
| ([.email_addresses[]? | select(.id == $u.primary_email_address_id)][0] // .email_addresses[0]) as $mail
| {
    source_id: .id,
    picture: .image_url,
    user: {
      email: $mail.email_address,
      emailVerified: ($mail.verification.status == "verified"),
      name: ([.first_name, .last_name] | map(select(. != null and . != "")) | join(" ")),
      givenName: .first_name,
      familyName: .last_name,
      username: .username
    }
  }
```

```bash
jq -c -f clerk.jq clerk-users.json > lumo-users.ndjson
wc -l < lumo-users.ndjson
```

## 4. Import

Use `import-users.sh` from `import-loop.md`. Show the user the command and the user count
first, run five users, then the rest:

```bash
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson
bash import-users.sh lumo-users.ndjson
```

`mapping.csv` then holds `clerk_user_id,lumoauth_user_id` for every user.

## 5. Organizations

Clerk Organizations become customer organizations.

```bash
curl -sS "https://api.clerk.com/v1/organizations?limit=500" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" > clerk-orgs.json

jq -c '(if type == "array" then . else .data end)[] | {name, slug}' clerk-orgs.json \
| while IFS= read -r org; do
  lumo api POST /organizations --data "$org" -o json | jq '{id: .data.id, slug: .data.slug}'
done
```

Show the loop to the user before you run it. For memberships, export
`/v1/organizations/<org id>/memberships` per organization, translate each Clerk user ID
through `mapping.csv`, and add the member:

```bash
lumo api POST /organizations/<organizationId>/members \
  --data '{"userId":"<lumoauth user id>","roleId":<organization role id>}' -o json
```

Read the role IDs of an organization with `lumo api GET /organizations/<organizationId>/roles -o json`.
For the model behind customer organizations, use `lumoauth-b2b-saas`.

## 6. Sign-in methods

| Clerk | LumoAuth |
|---|---|
| Email and password | Always available |
| Email code or email link | Magic link sign-in: portal, **Security**, **Sign-in settings**, **Login flow**, **Magic link login** |
| SMS code | SMS is a second factor in LumoAuth, not a first sign-in step: **Sign-in settings**, **MFA policy**, allowed factors |
| Username | Not a sign-in identifier. Users sign in with their email address |
| Google, GitHub, Microsoft and other social providers | **Settings**, **Integrations**, **Social login**, **Add provider** |
| Web3 wallet | Not available |

## 7. What does not carry over

- **Passwords.** The users are created without a password and reset it at the first
  sign-in, or use a magic link.
- **Sessions.** Clerk session tokens are not accepted by LumoAuth.
- **Users who only used a social provider.** They click the same provider again in
  LumoAuth. The link to the imported account follows the linking rule in `SKILL.md`.
- **MFA enrollments and passkeys.** Users enroll again.

## 8. Code

- Replace Clerk's React components and hooks with the LumoAuth packages: use
  `lumoauth-react` or `lumoauth-nextjs`. Do not map names one to one from memory; follow
  the skill.
- Repoint the webhook receiver: Clerk events such as `user.created` and `session.created`
  have LumoAuth counterparts (`user.created`, `user.login`, `session.revoked`), with a
  different signature scheme. Use `lumoauth-webhooks`.
- Backend code that verifies Clerk session tokens changes to LumoAuth token validation:
  `lumoauth-api-protection`.
