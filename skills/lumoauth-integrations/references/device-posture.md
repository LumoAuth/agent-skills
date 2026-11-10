# Device posture

LumoAuth can ask an endpoint security (EDR) or device management (MDM) tool whether the device of a user is known, trusted and compliant, and expose the answer to attribute rules (ABAC).

- Page: `/orgs/{orgId}/portal/integrations/device-posture` (**Integrations → Inbound signals & device posture**)
- Permission: `settings.manage`
- API and CLI: none for the configuration. Portal only.

## Providers

| Provider | Credential to create at the vendor | Base URL | How a user is matched | `trusted` | `compliant` |
|---|---|---|---|---|---|
| **CrowdStrike Falcon** | API client with **Hosts: Read** and **Zero Trust Assessment: Read** | The API base of the cloud (`api.crowdstrike.com`, `api.us-2.crowdstrike.com`, `api.eu-1.crowdstrike.com`, `api.laggar.gcw.crowdstrike.com`) | The local part of the email must equal the OS user name of the last login | Sensor present and host not contained | Zero Trust Assessment score at or above the minimum score (default 60) |
| **Jamf Pro** | API user or role with **Read Computers** | The instance, for example `https://acme.jamfcloud.com` | The **User and Location → Email** inventory field | Enrolled and managed | Managed, last contact within the maximum hours (default 72), FileVault on |
| **Microsoft Intune** | App registration with the application permission **DeviceManagementManagedDevices.Read.All** (admin consent); tenant ID, client ID, client secret | - | `userPrincipalName` | Management state is managed | Compliance state is compliant on the most recently synced device |
| **Kandji** | API token with the **Device list** permission | The Kandji API host, for example `https://acme.api.kandji.io` | The user's email | MDM enabled, agent installed, not removed | Trusted, not missing, checked in within the maximum hours (default 72) |

## Setup

1. Create the credential at the vendor with read access only.
2. Click **Configure** on the provider's card. Paste the credential, set the base URL and thresholds, turn the **Use ...** switch on and click **Save configuration**.
3. Use **Test with a user**: enter the email of a user with an enrolled device. The page shows the device, OS, last seen and the verdict, or the provider's error message.

Results are cached for 5 minutes per user. When several providers are enabled, the first one that has a record of the user's device is used. Providers are consulted in alphabetical order (CrowdStrike, Intune, Jamf, Kandji).

## Attributes for policies

Once a provider is enabled, attribute rules get a `device` namespace:

| Attribute | Type | Meaning |
|---|---|---|
| `device.known` | boolean | A device is enrolled for the user |
| `device.trusted` | boolean or null | Managed, or sensor present (null when unknown) |
| `device.compliant` | boolean or null | The provider's compliance verdict (null when unknown) |
| `device.os` | string or null | For example `macOS 14.6` |
| `device.name` | string or null | Device or host name |
| `device.source` | string or null | `crowdstrike`, `jamf`, `intune` or `kandji` |
| `device.lastSeen` | string or null | ISO 8601 |

Example policy from the documentation (only compliant devices may export):

```json
{
  "name": "export-requires-compliant-device",
  "effect": "allow",
  "resourceType": "document",
  "action": "export",
  "conditions": {
    "operator": "and",
    "conditions": [
      { "subject": "device.trusted", "operator": "equals", "value": true },
      { "subject": "device.compliant", "operator": "equals", "value": true }
    ]
  }
}
```

Policy authoring and the check API belong to `lumoauth-abac`. Without a device posture integration the `device` namespace is absent. Test a policy that reads it with the portal's access tester before relying on it.

## Notes

- The match is by user, not by the browser in use. The verdict describes the user's enrolled device, not proof that this request comes from it.
- Treat `null` as "unknown" and decide in the policy whether unknown is allowed.
- Device tools that support the Shared Signals Framework can also push `device-compliance-change` events to LumoAuth. That is configured as an inbound signal stream; see `lumoauth-agent-governance`.
- Changes are audited: `device_posture.integration_updated`, `device_posture.integration_deleted`.

## Reference

- https://docs.lumoauth.dev/integrations/device-posture
