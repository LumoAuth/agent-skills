# Logout

LumoAuth implements OpenID Connect RP-initiated logout, back-channel logout, front-channel logout
and session management. The app starts a sign-out with RP-initiated logout. LumoAuth then tells the
other applications of the session through the back channel and the front channel.

## RP-initiated logout

**GET** or **POST** `{issuer}/oauth/logout` (the discovery `end_session_endpoint`). This is a
browser redirect, not an API call. A request with an `Authorization: Bearer` header gets `403`.

| Parameter | Notes |
|---|---|
| `id_token_hint` | Recommended. The ID token that the app received. It identifies the user and the client, and it authorizes `post_logout_redirect_uri`. An access token is not accepted here |
| `post_logout_redirect_uri` | Where to send the user afterwards. Must be registered on the application (**Configuration → Logout → Post-logout redirect URIs**). Used only when `id_token_hint` identifies the client |
| `state` | Returned on the redirect to `post_logout_redirect_uri` |

```text
https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/logout
  ?id_token_hint=eyJ...
  &post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2Fsigned-out
  &state=xyz789
```

Order in the app:

1. Delete the app's own session and tokens.
2. Optionally revoke the refresh token at the revocation endpoint.
3. Redirect the browser to the URL above.
4. The user returns to `https://app.example.com/signed-out?state=xyz789`.

What LumoAuth does:

- With an `id_token_hint` for the signed-in user, it ends the LumoAuth session at once.
- Without a hint, or with a hint for another user, it shows a confirmation page first. Nothing
  ends until the user confirms, and the user is not redirected to another user's
  `post_logout_redirect_uri`.
- When the URI is not registered, the user stays on LumoAuth's confirmation page.
- When the request ends a session, LumoAuth notifies every other application of that session
  (below). A request from a browser without a session ends nothing and notifies nobody.

Keep the ID token for as long as the app session lives, because sign-out needs it. If LumoAuth
does not accept the hint, the user sees the confirmation page.

Do not link a "Sign out" button to the hosted `/logout` route. That route is for LumoAuth's own
pages and requires a CSRF token; from an app it answers `403 Invalid CSRF token.`

## Back-channel logout (recommended for apps with a server)

LumoAuth sends a signed logout token from server to server. It does not depend on the browser.

1. Add an HTTPS endpoint to the app, for example `POST https://app.example.com/oidc/backchannel-logout`.
2. Register it under **Applications → your app → Configuration → Logout → Back-channel logout
   URI** and click **Save configuration**. With dynamic client registration the field is
   `backchannel_logout_uri`.
3. LumoAuth posts `application/x-www-form-urlencoded` with one field, `logout_token`.

Validate the logout token like an ID token, with these differences:

| Check | Value |
|---|---|
| Signature | Key from `jwks_uri` |
| Header `typ` | `logout+jwt` |
| `iss` | The discovery `issuer` |
| `aud` | The client ID |
| `exp` | In the future. The token is short-lived |
| `events` | An object with the key `http://schemas.openid.net/event/backchannel-logout` |
| `sub` and/or `sid` | At least one is present. `sid` equals the `sid` claim of the ID tokens of that session |
| `nonce` | Must be absent |
| `jti` | Unique; refuse a `jti` that you have seen before |

Then end every app session that matches the `sid` (or all sessions of `sub` when there is no
`sid`) and answer `200`. For this to work, store the ID token's `sid` and `sub` with each app
session at sign-in.

```ts
// backchannel-logout.ts: verify a logout token with jose
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = process.env.LUMOAUTH_ISSUER!;
const CLIENT_ID = process.env.LUMOAUTH_CLIENT_ID!;
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const EVENT = "http://schemas.openid.net/event/backchannel-logout";

export async function verifyLogoutToken(logoutToken: string): Promise<{ sub?: string; sid?: string }> {
  const { payload } = await jwtVerify(logoutToken, jwks, {
    issuer: ISSUER,
    audience: CLIENT_ID,
    typ: "logout+jwt",
  });
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || !(EVENT in events)) throw new Error("Not a back-channel logout token");
  if ("nonce" in payload) throw new Error("A logout token must not carry a nonce");
  const sid = typeof payload.sid === "string" ? payload.sid : undefined;
  if (!payload.sub && !sid) throw new Error("The logout token has neither sub nor sid");
  return { sub: payload.sub, sid };
}
```

On a custom domain, read `jwks_uri` from discovery instead of building it from the issuer.

## Front-channel logout (browser-only apps)

LumoAuth's logout page loads the app's front-channel logout URI in a hidden iframe with the query
parameters `iss` and `sid`.

1. Register the URI under **Configuration → Logout → Front-channel logout URI**
   (`frontchannel_logout_uri` in dynamic registration).
2. On that page, compare `iss` with the discovery `issuer`, then clear the app session that
   belongs to `sid`.
3. The page must allow LumoAuth to embed it: no `X-Frame-Options: DENY`, and no `frame-ancestors`
   directive that excludes the LumoAuth origin.

Treat front-channel logout as best effort. Browsers that partition third-party cookies may not
deliver it. Prefer back-channel logout when the app has a server.

## Session monitoring (`check_session_iframe`)

For browser apps that must notice the end of the LumoAuth session without a server:

- Every successful authorization response to an `http(s)` redirect URI carries `session_state`.
  Store it.
- Embed the discovery `check_session_iframe` in a hidden iframe and post the message
  `"<client_id> <session_state>"` (one space) to it, with the LumoAuth origin as the target
  origin.
- The iframe answers `unchanged`, `changed` or `error`. Accept answers only from the LumoAuth
  origin.
- On `changed`, run an authorization request with `prompt=none`. A new code means that the user
  is still signed in; `login_required` means that the session ended.

The mechanism relies on a third-party cookie. Use it as a convenience and rely on back-channel
logout for correctness.

## Which mechanism

| App | Use |
|---|---|
| Web app with a backend | RP-initiated logout + back-channel logout |
| Single-page app with a backend-for-frontend | The same, handled by the backend |
| Single-page app without a server | RP-initiated logout + front-channel logout; optional session monitoring |
| Native app | RP-initiated logout in the system browser; revoke the refresh token |

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The user lands on a LumoAuth confirmation page and is not sent back | `id_token_hint` missing, or `post_logout_redirect_uri` not registered | Send the ID token and register the exact URI |
| `403 Invalid CSRF token.` | The app links to `/logout` | Use `end_session_endpoint` |
| Logout token refused by the library | Issuer built by hand, or the library does not accept `typ: logout+jwt` | Use the discovery `issuer`; allow the `logout+jwt` type |
| Back-channel endpoint never called | The URI is not `https`, or it is not reachable from the internet | Use a public HTTPS URL |
| Front-channel iframe never loads | The logout page forbids framing | Remove `X-Frame-Options` for that page or allow the LumoAuth origin |
| The `check_session` iframe always answers `error` | Wrong message format, or the page is not served over HTTPS | Post exactly `"<client_id> <session_state>"` |

## Sources

- https://docs.lumoauth.dev/oauth/logout
- https://docs.lumoauth.dev/oauth/security
