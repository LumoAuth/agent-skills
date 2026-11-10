# Device authorization grant

Sign-in for apps that cannot receive a browser redirect: command-line tools, TVs, consoles,
kiosks. The device shows a short code and a URL. The user opens the URL on a phone or laptop,
signs in and approves. The device polls the token endpoint until tokens arrive.

## Set up the application

1. Portal: **Applications → New application → Single-page or mobile app**. This creates a public
   client (no secret), which is what a distributed CLI or device app needs.
2. Open the application's **Configuration** tab. Under **Grant types** tick **Device flow** and
   click **Save configuration**.
3. Set the **Allowed scopes**. Keep `refresh_token` in the grant types if the device should stay
   signed in.

With the Admin API, include `"urn:ietf:params:oauth:grant-type:device_code"` in `grantTypes` and
set `"isConfidential": false`. A dynamically registered client cannot give itself this grant
type; an administrator adds it.

A confidential application can use the flow too. It must then authenticate (for example HTTP
Basic) on both requests below.

## Step 1: request the codes

**POST** `{issuer}/oauth/device_authorization` (the discovery `device_authorization_endpoint`),
body `application/x-www-form-urlencoded` or JSON.

| Parameter | Required | Notes |
|---|---|---|
| `client_id` | Yes | The application's client ID |
| `scope` | No | Space-separated; each scope must be allowed for the application |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/device_authorization \
  -d "client_id=$LUMOAUTH_CLIENT_ID" \
  -d "scope=openid profile email"
```

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/device",
  "verification_uri_complete": "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/device?user_code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```

| Field | Use |
|---|---|
| `device_code` | Secret of this attempt. Keep it in memory; never show or log it |
| `user_code` | Show it to the user |
| `verification_uri` | Show it to the user |
| `verification_uri_complete` | Open it in a browser when the device has one, or render it as a QR code |
| `expires_in` | Seconds until both codes expire. Read it from the response |
| `interval` | Minimum seconds between polls. Read it from the response |

## Step 2: the user approves

The user opens `verification_uri`, enters the code, signs in on the organization's login page and
approves the application. Link to this page; do not build your own page that posts to it (the
form is protected against cross-site posts).

## Step 3: poll for tokens

**POST** `{issuer}/oauth/token`.

| Parameter | Required | Notes |
|---|---|---|
| `grant_type` | Yes | `urn:ietf:params:oauth:grant-type:device_code` |
| `device_code` | Yes | From step 1 |
| `client_id` | Yes for public clients | Confidential clients authenticate instead |
| `resource` | No | The API that the token is for |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "device_code=$DEVICE_CODE" \
  -d "client_id=$LUMOAUTH_CLIENT_ID"
```

| HTTP | `error` | What to do |
|---|---|---|
| 400 | `authorization_pending` | Wait `interval` seconds and poll again |
| 400 | `slow_down` | Add 5 seconds to the interval, then poll again |
| 400 | `access_denied` | The user refused. Stop and say so |
| 400 | `expired_token` | The codes expired. Stop; start again on request |
| 400 | `invalid_grant` | The device code is unknown, belongs to another client, or the user's sessions were ended after approval. Stop |
| 400 | `invalid_target` | `resource` is not allowed, or names an MCP server that the user has not approved for this application |
| 401 | `invalid_client` | Unknown or disabled application, or failed authentication of a confidential client |
| 403 | `unauthorized_client` | The application does not have the device grant type |

Success is the normal token response: `access_token`, `token_type`, `expires_in`, `scope`,
`refresh_token` (when the application has the `refresh_token` grant type) and `id_token` (when
`openid` was granted).

Errors of the device authorization endpoint itself: `400 invalid_request` (no `client_id`),
`400 unauthorized_client` (grant type missing), `400 invalid_scope`, `401 invalid_client`,
`429 too_many_requests`.

## TypeScript: a CLI login

Runs on Node.js 18 or later without dependencies.

```ts
// device-login.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface Tokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function postForm<T>(url: string, params: Record<string, string>): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: (await res.json()) as T };
}

export async function deviceLogin(scope = "openid profile email"): Promise<Tokens> {
  const start = await postForm<DeviceAuthorization & { error?: string }>(
    `${ISSUER}/oauth/device_authorization`,
    { client_id: CLIENT_ID, scope },
  );
  if (start.status !== 200) throw new Error(`Device authorization failed: ${start.body.error ?? start.status}`);

  const device = start.body;
  console.error(`To sign in, open ${device.verification_uri} and enter the code ${device.user_code}`);

  let interval = device.interval;
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await postForm<Tokens & { error?: string }>(`${ISSUER}/oauth/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: CLIENT_ID,
    });
    if (poll.status === 200) return poll.body;

    switch (poll.body.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "access_denied":
        throw new Error("The sign-in was refused");
      case "expired_token":
        throw new Error("The code expired. Run the login again");
      default:
        throw new Error(`Device login failed: ${poll.body.error ?? poll.status}`);
    }
  }
  throw new Error("The code expired. Run the login again");
}
```

After login:

- Store the refresh token in the operating system's credential store (Keychain, Credential
  Manager, libsecret), not in a plain file.
- Refresh with `grant_type=refresh_token` and `client_id`. Public clients always get a new
  refresh token on each refresh; store it.
- Validate the ID token if the CLI shows who is signed in (see `lumoauth-oauth-oidc`).

## Security notes

- The `user_code` is short on purpose. Protection comes from the short lifetime and from rate
  limits. Do not extend an attempt by polling beyond `expires_in`.
- Show the user the name of the organization and the URL before they open it, so that they can
  recognise a phishing attempt that sends them someone else's code.
- Request only the scopes that the tool needs.

## Sources

- https://docs.lumoauth.dev/oauth/device
- https://docs.lumoauth.dev/user-guide/authentication/device-flow
