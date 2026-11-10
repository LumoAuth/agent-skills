# FIDO Metadata Service

The FIDO Alliance publishes a signed catalogue of certified FIDO2 authenticators (the hardware or software that holds a passkey), keyed by AAGUID, an identifier of the authenticator model. LumoAuth uses a verified copy of that catalogue to:

- show a real authenticator name (for example "YubiKey 5 Series") instead of a raw AAGUID;
- record the certification level of each registered passkey;
- optionally reject passkeys from authenticators that are not FIDO certified or that have a reported compromise.

- Page: `/orgs/{orgId}/portal/integrations/fido-mds` (**Integrations → Passkeys & authenticators → FIDO Metadata Service**)
- Permission: `settings.manage`
- The user supplies nothing. There are no credentials.
- API and CLI: none for this page.

## What the page shows

- The metadata cache card: the catalogue's serial number, its publication date and the number of entries.
- **Refresh now** fetches the latest catalogue. The catalogue is also refreshed on a schedule.
- The **Attestation policy** card, with **Change in authentication settings**, which opens the policy switch below.

A catalogue that fails signature verification never replaces the cached copy.

## At passkey registration

After a passkey is validated and bound to the user, LumoAuth looks up the authenticator's AAGUID and stores the authenticator name and certification level on the credential. The audit entry `passkey.registered` carries the AAGUID, the name and the level.

The all-zero AAGUID is never looked up and stays "unknown". Many platform passkeys report it.

An entry counts as certified when its status history has a `FIDO_CERTIFIED` status (any level) and no compromise or revocation status. Levels, lowest to highest: `FIDO_CERTIFIED`, `L1`, `L1plus`, `L2`, `L2plus`, `L3`, `L3plus`.

## Require certified authenticators

Switch: **Require FIDO-certified authenticators**, under **Passkeys & biometrics** in the **Identity methods** section of `/orgs/{orgId}/portal/settings/authentication`. It is off by default.

With the switch on, a passkey registration is rejected unless the AAGUID is in the catalogue, certified and free of compromise reports. The attempt is audited as `passkey.registration_rejected` with the reason `unknown_aaguid` or `not_certified`.

Warn the user before turning it on:

- Most platform passkeys (iCloud Keychain, Google Password Manager, Windows Hello in its software form) report an all-zero AAGUID or no attestation, and are rejected.
- The policy fits organizations that issue hardware security keys and must guarantee their assurance level.
- Click **Refresh now** first. With an empty or stale catalogue, registrations fail.
- The switch is checked when a passkey is registered. Test with one account before a rollout.

## Verify

1. Register a passkey with a known hardware key. The user's sign-in methods show the model name.
2. In the audit log, `passkey.registered` has the AAGUID and the certification level.
3. With the policy on, try a platform passkey. The registration is refused and `passkey.registration_rejected` is recorded.

Passkey enrollment and policy in general belong to `lumoauth-mfa-passkeys`.

## Reference

- https://docs.lumoauth.dev/integrations/fido-mds
