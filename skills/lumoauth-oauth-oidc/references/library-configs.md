# Configurations for generic OIDC libraries

Ready configuration for five common libraries. Each one uses only standard OpenID Connect
settings: issuer, client ID, client secret, redirect URI and scopes. Nothing here is specific to
LumoAuth except the issuer URL.

Check the version of the library in the project before you copy a snippet; the snippets name the
major version that they are written for. Where a LumoAuth SDK exists for the framework, the SDK
skill is the shorter path (`lumoauth-nextjs`, `lumoauth-react`, `lumoauth-python`,
`lumoauth-spring-boot`).

Values used below:

| Placeholder | Example |
|---|---|
| Issuer | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` |
| App URL | `http://localhost:3000` in development, `https://app.example.com` in production |

Register the callback URL that each library uses on the LumoAuth application, exactly as written.

## Auth.js (NextAuth v5, package `next-auth`)

Callback URL to register: `{appUrl}/api/auth/callback/lumoauth`.

```bash
# .env.local
AUTH_SECRET=replace-with-a-random-secret
AUTH_LUMOAUTH_ISSUER=https://app.lumoauth.dev/orgs/acme-corp/api/v1
AUTH_LUMOAUTH_ID=your-client-id
AUTH_LUMOAUTH_SECRET=your-client-secret
```

```ts
// auth.ts
import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "lumoauth",
      name: "LumoAuth",
      type: "oidc",
      issuer: process.env.AUTH_LUMOAUTH_ISSUER,
      clientId: process.env.AUTH_LUMOAUTH_ID,
      clientSecret: process.env.AUTH_LUMOAUTH_SECRET,
      authorization: { params: { scope: "openid profile email" } },
      checks: ["pkce", "state", "nonce"],
    },
  ],
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

Create the LumoAuth application as a **Web application** (confidential). `type: "oidc"` makes
Auth.js read `{issuer}/.well-known/openid-configuration` and validate the ID token.

## openid-client (v6, Node.js)

```bash
npm install openid-client
```

```ts
// oidc.ts
import * as client from "openid-client";

const issuer = new URL(process.env.LUMOAUTH_ISSUER!);
const clientId = process.env.LUMOAUTH_CLIENT_ID!;
const clientSecret = process.env.LUMOAUTH_CLIENT_SECRET!;
const redirectUri = process.env.LUMOAUTH_REDIRECT_URI!; // https://app.example.com/callback

let configPromise: Promise<client.Configuration> | undefined;
const getConfig = () => (configPromise ??= client.discovery(issuer, clientId, clientSecret));

export interface PendingLogin {
  codeVerifier: string;
  state: string;
  nonce: string;
}

/** Store `pending` in the server-side session, then redirect the browser to `url`. */
export async function beginLogin(): Promise<{ url: URL; pending: PendingLogin }> {
  const config = await getConfig();
  const pending: PendingLogin = {
    codeVerifier: client.randomPKCECodeVerifier(),
    state: client.randomState(),
    nonce: client.randomNonce(),
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(pending.codeVerifier),
    code_challenge_method: "S256",
    state: pending.state,
    nonce: pending.nonce,
  });
  return { url, pending };
}

/** `currentUrl` is the full callback URL, including the query string. */
export async function completeLogin(currentUrl: URL, pending: PendingLogin) {
  const config = await getConfig();
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  });
  return { tokens, claims: tokens.claims()! };
}

export async function refresh(refreshToken: string) {
  return client.refreshTokenGrant(await getConfig(), refreshToken);
}

export async function logoutUrl(idToken: string, postLogoutRedirectUri: string): Promise<URL> {
  return client.buildEndSessionUrl(await getConfig(), {
    id_token_hint: idToken,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
}
```

For a public client, pass no secret and the `None` client authentication:
`client.discovery(issuer, clientId, undefined, client.None())`.

## oidc-client-ts (v3, single-page apps)

Create the LumoAuth application as **Single-page or mobile app** (public, no secret) and add the
app's origin under **Configuration → Browser CORS origins**. Callback URL to register:
`{appUrl}/callback`.

```bash
npm install oidc-client-ts
```

```ts
// auth.ts
import { InMemoryWebStorage, UserManager, WebStorageStateStore } from "oidc-client-ts";

export const userManager = new UserManager({
  authority: "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
  client_id: "your-client-id",
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  scope: "openid profile email",
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
});

export const signIn = () => userManager.signinRedirect();
export const handleCallback = () => userManager.signinCallback();
export const signOut = () => userManager.signoutRedirect();
export const getUser = () => userManager.getUser();
```

Call `handleCallback()` on the `/callback` route, then navigate to the app. The library uses PKCE
with `S256` for the code flow. `InMemoryWebStorage` keeps tokens out of `localStorage` and
`sessionStorage`; the user signs in again after a full page reload. No client secret appears
anywhere in this code, and none may.

## Authlib (v1, Flask)

Callback URL to register: `{appUrl}/callback`.

```bash
pip install authlib flask requests
```

```python
# app.py
import os

from authlib.integrations.flask_client import OAuth
from flask import Flask, redirect, session, url_for

ISSUER = os.environ["LUMOAUTH_ISSUER"]  # https://app.lumoauth.dev/orgs/acme-corp/api/v1

app = Flask(__name__)
app.secret_key = os.environ["FLASK_SECRET_KEY"]

oauth = OAuth(app)
oauth.register(
    name="lumoauth",
    server_metadata_url=f"{ISSUER}/.well-known/openid-configuration",
    client_id=os.environ["LUMOAUTH_CLIENT_ID"],
    client_secret=os.environ["LUMOAUTH_CLIENT_SECRET"],
    client_kwargs={
        "scope": "openid profile email",
        "code_challenge_method": "S256",
    },
)


@app.route("/login")
def login():
    return oauth.lumoauth.authorize_redirect(url_for("callback", _external=True))


@app.route("/callback")
def callback():
    token = oauth.lumoauth.authorize_access_token()
    session["user"] = token["userinfo"]
    session["id_token"] = token["id_token"]
    return redirect("/")


@app.route("/logout")
def logout():
    id_token = session.pop("id_token", None)
    session.clear()
    metadata = oauth.lumoauth.load_server_metadata()
    url = metadata["end_session_endpoint"]
    if id_token:
        url += f"?id_token_hint={id_token}"
    return redirect(url)
```

`authorize_access_token()` checks `state`, sends the PKCE verifier and validates the ID token
(signature, issuer, audience, nonce). `token["userinfo"]` holds the ID token claims.

## Spring Security (Spring Boot 3, `spring-boot-starter-oauth2-client`)

Callback URL to register: `{appUrl}/login/oauth2/code/lumoauth`.

```yaml
# src/main/resources/application.yml
spring:
  security:
    oauth2:
      client:
        registration:
          lumoauth:
            client-id: ${LUMOAUTH_CLIENT_ID}
            client-secret: ${LUMOAUTH_CLIENT_SECRET}
            authorization-grant-type: authorization_code
            scope: openid,profile,email
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
        provider:
          lumoauth:
            issuer-uri: https://app.lumoauth.dev/orgs/acme-corp/api/v1
```

Spring Security sends PKCE by default only for public clients. Turn it on for the confidential
client too: PKCE is recommended for every client, and an application with **Require PKCE** on
refuses an authorization request without it.

```java
// SecurityConfig.java
package com.example.app;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ClientRegistrationRepository clients)
            throws Exception {
        DefaultOAuth2AuthorizationRequestResolver resolver =
                new DefaultOAuth2AuthorizationRequestResolver(
                        clients,
                        OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        OidcClientInitiatedLogoutSuccessHandler logoutHandler =
                new OidcClientInitiatedLogoutSuccessHandler(clients);
        logoutHandler.setPostLogoutRedirectUri("{baseUrl}");

        http
                .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
                .oauth2Login(login -> login.authorizationEndpoint(
                        endpoint -> endpoint.authorizationRequestResolver(resolver)))
                .logout(logout -> logout.logoutSuccessHandler(logoutHandler));
        return http.build();
    }
}
```

`issuer-uri` makes Spring read the discovery document at startup and validate ID tokens against
the issuer. `OidcClientInitiatedLogoutSuccessHandler` sends the user to the `end_session_endpoint`
with `id_token_hint`. Register the `{baseUrl}` value as a post-logout redirect URI.

## Other libraries: the same settings under other names

| Library | Issuer setting | Notes |
|---|---|---|
| passport (`openid-client/passport` strategy) | The `Configuration` from `client.discovery(...)` shown above | Pass `scope` and the callback URL to the strategy |
| AppAuth for Android | `AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(issuer), callback)` | Public client; redirect with a private-use scheme or an App Link; PKCE is on by default |
| AppAuth for iOS | `OIDAuthorizationService.discoverConfiguration(forIssuer:completion:)` | Public client; PKCE is on by default |
| mozilla-django-oidc | No issuer setting: copy `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint` and `jwks_uri` from discovery into `OIDC_OP_AUTHORIZATION_ENDPOINT`, `OIDC_OP_TOKEN_ENDPOINT`, `OIDC_OP_USER_ENDPOINT`, `OIDC_OP_JWKS_ENDPOINT` | Set `OIDC_RP_SIGN_ALGO` to the `alg` of the key in the organization's JWKS, and turn PKCE on (`OIDC_USE_PKCE = True`) |
| Any other | Look for "issuer", "authority", "discovery URL" or "server metadata URL" | Enter the discovery `issuer`; some libraries want the full `.well-known/openid-configuration` URL |

## Checklist for every library

- Issuer equals the discovery `issuer`, with no trailing slash.
- The callback URL that the library uses is registered on the application, exactly.
- PKCE is on with `S256`. `state` and `nonce` checks are on. Issuer validation is on.
- The client secret comes from an environment variable or secret store and never reaches the
  browser.
- The library validates the ID token signature against `jwks_uri`. Do not disable signature or
  audience checks to make an error go away; fix the configuration.
- If sign-in fails with `invalid_client` for a public client, the library is sending a secret or
  HTTP Basic. Set its client authentication method to `none`.
