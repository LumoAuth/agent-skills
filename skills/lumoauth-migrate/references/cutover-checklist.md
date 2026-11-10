# Parallel run, cut-over and rollback checklist

Work through this list with the user. Each phase has an exit condition; do not start the
next phase before it holds. The percentages and waiting periods are decisions of the user:
ask for them and write them down.

The approach is a parallel run: both providers work side by side, users move in groups,
and the old provider stays untouched until the end. That keeps rollback a configuration
change.

## Phase 0: decisions to get from the user

- [ ] The first sign-in method for migrated users: password reset, magic link, social or
      enterprise sign-in, or a mix per user group.
- [ ] The announcement to users: text, sender, timing. A password reset email without an
      announcement looks like phishing.
- [ ] The order of user groups: internal users, a pilot group, a percentage, everyone.
- [ ] The success measure for each step (for example the sign-in success rate and the
      number of support requests) and who watches it.
- [ ] The rollback trigger: which observation switches the default back, and who decides.
- [ ] The retirement date of the old provider, and how long it stays reachable after the
      last switch.
- [ ] Who must approve changes to production (the "show before you change" rule applies
      to every command and every deploy in this list).

## Phase 1: rehearsal in a test organization

- [ ] A test organization exists (a second organization, or a sandbox organization where
      the plan includes it).
- [ ] Roles, groups, applications and connections are created there by script, not by
      hand, so that the same script can run against production.
- [ ] A sample of the export is imported. Field mapping is checked on real records:
      names, `emailVerified`, `isActive`, roles, groups.
- [ ] The application in a test environment signs in a migrated user through each
      first-sign-in method, and finds the right application user through the mapping.
- [ ] An API that validates tokens accepts a LumoAuth token and still accepts a token of
      the old provider.
- [ ] Webhook receivers, if any, verify LumoAuth's signature.

Exit: every item works without manual repair.

## Phase 2: prepare production

- [ ] The production organization holds permissions, roles, groups, OAuth clients, social
      and enterprise connections, the MFA policy, branding and the sign-in settings.
- [ ] Client secrets, the webhook signing secret and API keys are in the secret manager.
      No secret is in the repository or in a job log.
- [ ] Redirect URIs of the production application are registered on the LumoAuth clients.
- [ ] Callback URLs of LumoAuth are registered at each social and enterprise provider.
- [ ] The application is deployed with both providers supported and a switch that selects
      the default (`AUTH_PROVIDER=old`). The switch can be changed without a code deploy.
- [ ] APIs accept tokens from both issuers, each validated against its own keys, issuer
      and audience.
- [ ] The mapping table exists in the application's database (empty for now).

Exit: production runs unchanged on the old provider, with the LumoAuth path deployed and
switched off.

## Phase 3: import

- [ ] A fresh export is taken.
- [ ] The import command, the target organization (`lumo whoami -o json`) and the user
      count were shown to the user and approved.
- [ ] A small batch is imported and checked.
- [ ] The full import ran. Failed records (`failed.ndjson`, or the `✗` lines of
      `lumo migrate auth0`) are reviewed and fixed or accepted.
- [ ] The mapping is loaded into the application's database.
- [ ] The count matches: users in the export with an email = created + already existing.
- [ ] The export files are stored with restricted access, with a deletion date.

Exit: every user who can sign in at the old provider with an email has a LumoAuth account
and a mapping entry.

## Phase 4: pilot

- [ ] Internal users are switched to LumoAuth (per-user or per-group selection in the
      application, or a separate hostname).
- [ ] Each first-sign-in method works for real accounts. MFA enrollment works.
- [ ] Authorization in the application is correct for at least one user per role.
- [ ] Audit log entries appear in LumoAuth for the pilot sign-ins.

Exit: the pilot group works for the agreed time without a blocking issue.

## Phase 5: move users in steps

- [ ] The announcement is sent before each step.
- [ ] The import is run again before each step, to pick up users who signed up at the old
      provider since the last run. The second run creates only missing users.
- [ ] The share of users on LumoAuth is raised in the agreed steps. After each step the
      success measure is checked before the next step.
- [ ] A user who has signed in to LumoAuth once is marked as migrated in the application's
      database, and is no longer sent to the old provider.
- [ ] New sign-ups are created in LumoAuth only, from the moment that the user names.

Exit: the agreed share of active users has signed in to LumoAuth.

## Phase 6: cut over

- [ ] The default provider is switched to LumoAuth (`AUTH_PROVIDER=lumoauth`).
- [ ] Sign-up at the old provider is switched off in the application (not at the
      provider).
- [ ] The old provider stays configured and reachable. Its tokens are still accepted
      until they expire, or until the date that the user set.
- [ ] Monitoring covers: sign-in success and failure counts, password reset volume,
      webhook delivery failures (`lumo webhooks deliveries list <id> --status failed`),
      API 401 and 403 rates.

Exit: the agreed observation period passes without the rollback trigger.

## Rollback (possible until phase 7)

Rollback is designed in from the start: nothing at the old provider was changed or deleted.

1. Switch the default back (`AUTH_PROVIDER=old`). Users sign in at the old provider with
   their old password.
2. Leave the LumoAuth organization as it is. Do not delete users: the next attempt reuses
   them, and the import skips what exists.
3. Handle what happened in between:
   - Users who signed up only in LumoAuth do not exist at the old provider. List them
     (`lumo users list --sort createdAt -o json`, filter by the cut-over time) and decide
     with the user: create them at the old provider, or keep them on the LumoAuth path.
   - A password that a user set in LumoAuth is not known to the old provider, and the
     reverse. Tell users which password applies.
   - Profile changes made in LumoAuth are not written back.
4. Record the cause, fix it in the rehearsal environment, and start again at phase 4.

A rollback gets harder with every day of new sign-ups on LumoAuth. That is why the
observation period in phase 6 has an end date.

## Phase 7: retire the old provider

Only after the user confirms each item:

- [ ] No sign-in at the old provider for the agreed period.
- [ ] Logs of the old provider are exported and stored where the retention policy
      requires.
- [ ] The code path, the SDK and the configuration of the old provider are removed from
      the application. APIs accept only LumoAuth's issuer.
- [ ] Secrets of the old provider are revoked and removed from the secret manager and
      from CI.
- [ ] Export files with personal data (and, for Firebase, password hashes) are deleted.
- [ ] The mapping table stays for as long as any system refers to an old ID.
- [ ] The subscription or tenant at the old provider is closed by the user, not by the
      agent.

## What an agent must not do alone

- Send email to users (reset emails, invitations) without an approved text and timing.
- Run a bulk import or a bulk update against production without approval of the exact
  command and the user count.
- Change, disable or delete anything at the old provider.
- Mark email addresses as verified that the source did not verify.
- Delete users in LumoAuth to "clean up" a failed run. A second run is safe; a deletion
  is not reversible.
