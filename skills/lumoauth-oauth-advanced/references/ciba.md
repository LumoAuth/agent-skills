# CIBA: client-initiated backchannel authentication

With CIBA a backend starts a sign-in or an approval for a user that it already knows by an
identifier. The user approves on their own device, away from the device that started the request.
There is no browser redirect. The backend polls the token endpoint for the result.

Typical uses: a call centre agent verifies a caller, a point-of-sale terminal asks the customer
to approve, a backend asks for approval of a sensitive transaction.

For an AI agent that asks a person to approve one action, use `lumoauth-agent-approvals`. That
profile adds `agent_id` and `authorization_details` to the same endpoint and has its own rules.

## What LumoAuth supports

| Feature | Support |
|---|---|
| Delivery mode | `poll` only. No ping or push callbacks to the client |
| `user_code` | Not supported. Sending one answers `400 invalid_user_code` |
| Signed authentication requests | Not supported |
| Hints | `login_hint`, `id_token_hint`, `login_hint_token`: exactly one |
| Discovery | `backchannel_authentication_endpoint`, `backchannel_token_delivery_modes_supported: ["poll"]`, `backchannel_user_code_parameter_supported: false` |

## Prerequisites

- A confidential application. The request authenticates the client.
- Backchannel authentication must be enabled for the application, and it must be part of the
  organization's plan (see https://docs.lumoauth.dev/pricing-matrix). Otherwise the endpoint
  answers `400 unauthorized_client`. When you get that answer, stop and tell the user; do not
  retry or try another flow on your own.
- The user can approve: the LumoAuth app for push approval, or another factor that the hosted
  approval page can ask for. See `lumoauth-mfa-passkeys`.

## Step 1: start the request

**POST** `{issuer}/oauth/bc-authorize` (the discovery `backchannel_authentication_endpoint`),
body `application/x-www-form-urlencoded`, with client authentication.

| Parameter | Required | Notes |
|---|---|---|
| `scope` | Yes | Space-separated. Each scope must be allowed for the application |
| `login_hint` | One hint | The user's email address or username |
| `id_token_hint` | One hint | An ID token that was issued for this user |
| `login_hint_token` | One hint | A JWT that identifies the user |
| `binding_message` | No | A short text shown to the user with the prompt, for example a reference number that the user can compare. Do not put secrets or personal data in it |
| `requested_expiry` | No | Preferred lifetime of the request in seconds. It can only shorten the application's own value |
| `acr_values` | No | The authentication level that the approval must reach |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/bc-authorize \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "scope=openid profile" \
  -d "login_hint=user@example.com" \
  -d "binding_message=Order 4471"
```

```json
{
  "auth_req_id": "1c266114-a1be-4252-8ad1-04986c5b9ac1",
  "expires_in": 120,
  "interval": 5
}
```

| Field | Use |
|---|---|
| `auth_req_id` | Identifies this request at the token endpoint. Keep it on the server |
| `expires_in` | Seconds until the request expires. Read it from the response |
| `interval` | Minimum seconds between polls |

LumoAuth does not reveal whether the hint matched a user. An unknown user gets an answer of the
same shape, and polling it never returns tokens. Do not use this endpoint to test whether an
account exists.

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` | `scope` missing; no hint; more than one hint; a malformed parameter |
| 400 | `invalid_scope` | A scope is not allowed for the application |
| 400 | `unauthorized_client` | Backchannel authentication is not enabled for the application, or not part of the plan |
| 400 | `invalid_user_code` | A `user_code` was sent |
| 401 | `invalid_client` | Client authentication failed, or the application is disabled |
| 429 | `too_many_requests` | Rate limit |

## Step 2: poll the token endpoint

**POST** `{issuer}/oauth/token`, with the same client authentication.

| Parameter | Required | Value |
|---|---|---|
| `grant_type` | Yes | `urn:openid:params:grant-type:ciba` |
| `auth_req_id` | Yes | From step 1 |

```bash
curl -X POST https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token \
  -u "$LUMOAUTH_CLIENT_ID:$LUMOAUTH_CLIENT_SECRET" \
  -d "grant_type=urn:openid:params:grant-type:ciba" \
  -d "auth_req_id=$AUTH_REQ_ID"
```

| HTTP | `error` | What to do |
|---|---|---|
| 400 | `authorization_pending` | Wait `interval` seconds and poll again |
| 400 | `slow_down` | Add 5 seconds to the interval, then poll again |
| 400 | `access_denied` | The user refused. Stop |
| 400 | `expired_token` | The request expired. Stop; start a new one only when the user asks |
| 400 | `invalid_grant` | Unknown `auth_req_id`, a request of another client, or the user's sessions were ended after approval. Stop |
| 403 | `unauthorized_client` | Backchannel authentication is not enabled for the application |

Success is the normal token response with `access_token`, `token_type`, `expires_in`, `scope`,
`id_token` and, when the application has the `refresh_token` grant type, `refresh_token`.
Validate the ID token as usual (issuer, audience, signature, expiry) and check that its `sub` is
the user you meant.

## TypeScript

```ts
// ciba.ts
const ISSUER = process.env.LUMOAUTH_ISSUER!; // https://app.lumoauth.dev/orgs/acme-corp/api/v1
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.LUMOAUTH_CLIENT_SECRET!;

const BASIC = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export interface CibaTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

async function post<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T }> {
  const res = await fetch(`${ISSUER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: BASIC },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** Asks the user to approve and waits for the result. */
export async function approveOnUserDevice(loginHint: string, bindingMessage: string): Promise<CibaTokens> {
  const start = await post<{ auth_req_id?: string; expires_in?: number; interval?: number; error?: string }>(
    "/oauth/bc-authorize",
    { scope: "openid profile", login_hint: loginHint, binding_message: bindingMessage },
  );
  if (start.status !== 200 || !start.body.auth_req_id || !start.body.expires_in) {
    throw new Error(`Backchannel request failed: ${start.body.error ?? start.status}`);
  }

  let interval = start.body.interval ?? 5;
  const deadline = Date.now() + start.body.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await post<CibaTokens & { error?: string }>("/oauth/token", {
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: start.body.auth_req_id,
    });
    if (poll.status === 200) return poll.body;

    switch (poll.body.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "access_denied":
        throw new Error("The user refused the request");
      case "expired_token":
        throw new Error("The request expired");
      default:
        throw new Error(`Backchannel authentication failed: ${poll.body.error ?? poll.status}`);
    }
  }
  throw new Error("The request expired");
}
```

## Design rules

- Start a request only on a clear action of a person who is in contact with the user. Unasked
  prompts teach users to approve without reading.
- One open request per user and purpose. Do not send a second prompt while the first is pending.
- Put something in `binding_message` that the user can compare with what the other side shows.
- Treat the result as the answer to exactly this request. Do not reuse the tokens for another
  purpose than the one that the user saw.

## Sources

- https://docs.lumoauth.dev/oauth/ciba
- https://docs.lumoauth.dev/user-guide/authentication/push-auth
