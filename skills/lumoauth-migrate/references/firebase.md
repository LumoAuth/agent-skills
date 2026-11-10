# Migrate from Firebase Authentication

No importer exists for Firebase Authentication. Export the users with the Firebase CLI,
reshape them with `jq`, and create them with the import loop.

## 1. Export

```bash
firebase auth:export firebase-users.json --format=json --project <firebase project id>
chmod 600 firebase-users.json
jq '.users | length' firebase-users.json
```

This file holds password hashes and salts next to the user data. Treat it as a secret:
keep it out of the repository and out of shared folders, and delete it after the
migration. LumoAuth does not import the hashes.

## 2. Field mapping

| Firebase field | LumoAuth field |
|---|---|
| `email` | `email` |
| `emailVerified` | `emailVerified` |
| `displayName` | `name` |
| `phoneNumber` | `phoneNumber` |
| `disabled` | `isActive` (the opposite value) |
| `photoUrl` | `picture`, set after creation |
| `localId` (the Firebase UID) | The mapping table |
| `customClaims`, `providerUserInfo[]`, `createdAt`, `lastSignedInAt` | The application's database, keyed by the LumoAuth user ID |

## 3. Reshape

`firebase.jq` (run against a sample export). It leaves out accounts without an email:

```jq
.users[]
| select(.email != null and .email != "")
| {
    source_id: .localId,
    picture: .photoUrl,
    user: {
      email: .email,
      emailVerified: (.emailVerified // false),
      name: .displayName,
      phoneNumber: .phoneNumber,
      isActive: (.disabled != true)
    }
  }
```

```bash
jq -c -f firebase.jq firebase-users.json > lumo-users.ndjson
wc -l < lumo-users.ndjson
jq '[.users[] | select(.email == null or .email == "")] | length' firebase-users.json   # left out
```

## 4. Import

Use `import-users.sh` from `import-loop.md`. Show the user the command and the user count
first, run five users, then the rest:

```bash
head -n 5 lumo-users.ndjson > sample.ndjson
bash import-users.sh sample.ndjson
bash import-users.sh lumo-users.ndjson
```

`mapping.csv` then holds `firebase_uid,lumoauth_user_id` for every user.

## 5. Sign-in providers

| Firebase | LumoAuth |
|---|---|
| Email and password | Always available |
| Email link | Magic link sign-in: portal, **Security**, **Sign-in settings**, **Login flow**, **Magic link login** |
| Google, Facebook, Apple, Microsoft, GitHub and other providers | Social login providers: **Settings**, **Integrations**, **Social login**, **Add provider** |
| Phone (SMS code) as the only sign-in | Not a first sign-in step in LumoAuth. SMS is a second factor |
| Anonymous sign-in | Not available |
| Custom tokens | Firebase custom tokens are not accepted. Use the SDK's sign-in flow or the OAuth endpoints (`lumoauth-oauth-oidc`) |

Configure every provider in LumoAuth before the cut-over.

## 6. What does not carry over

- **Passwords.** The export has the hashes, but LumoAuth does not import them. Users
  reset the password or use a magic link.
- **Phone-only users.** LumoAuth requires an email on every user. Collect an email in the
  application before the cut-over, then export again.
- **Anonymous users.** Create a real account when the user next signs in.
- **Firebase ID tokens and custom tokens.** Not accepted by LumoAuth.
- **Users who only used a social provider.** They use the same provider in LumoAuth; the
  link to the imported account follows the linking rule in `SKILL.md`.

## 7. Firebase-specific cut-over notes

- Firebase security rules for Firestore, Realtime Database and Storage read
  `request.auth`, which Firebase Authentication fills. If the application keeps those
  products, plan how they get an identity after the switch before you start: this
  decides whether a full migration is possible. Ask the user.
- Client code that calls the Firebase Authentication SDK moves to a LumoAuth SDK
  (step 6 of `SKILL.md`). Backend code that calls `verifyIdToken` moves to LumoAuth token
  validation: `lumoauth-api-protection`.
- Firebase has no built-in way to run two providers side by side. Put the choice in the
  application: send users whose record says "migrated" to LumoAuth and the others to
  Firebase, and mark a user as migrated after the first successful LumoAuth sign-in.
- The Firebase UID is the key of many Firestore documents. Keep it in the mapping and
  keep using it as the application's own key if rewriting the documents is not worth it.
