# Session lifecycle in plain PHP: refresh, logout, revoke

These snippets continue the files from `SKILL.md`: `src/bootstrap.php` defines `lumo()`,
`config()` and `requireLogin()`, and the callback stores the tokens in `$_SESSION['lumoauth']`.

## Contents

- [What the session holds](#what-the-session-holds)
- [Refresh the access token](#refresh-the-access-token)
- [Sign out](#sign-out)
- [Revoke a token](#revoke-a-token)
- [Check the `iss` parameter on the callback](#check-the-iss-parameter-on-the-callback)
- [Extra authorization parameters](#extra-authorization-parameters)

## What the session holds

| Key | Content |
|---|---|
| `$_SESSION['user']` | `sub`, `email`, `name` from `userinfo()` |
| `$_SESSION['lumoauth']['access_token']` | Sent to LumoAuth as `Authorization: Bearer` by `lumoAsUser()` |
| `$_SESSION['lumoauth']['refresh_token']` | Present only when the application has the `refresh_token` grant type |
| `$_SESSION['lumoauth']['id_token']` | Used as `id_token_hint` at logout |
| `$_SESSION['lumoauth']['expires_at']` | Unix time at which the access token expires |

The tokens stay in the server-side session. Never print them, never log them, and never put them
in a cookie, a URL or HTML.

The token response has a `refresh_token` only when the grant types of the application include
`refresh_token` (portal: **Applications** → the application → **Configuration** → **Grant
types**). The `offline_access` scope does not change that.

## Refresh the access token

Call this before a request that uses the user's token. It refreshes the token 30 seconds before
it expires.

```php
<?php
// src/refresh.php

declare(strict_types=1);

use LumoAuth\Error\LumoAuthApiError;

/** Returns false when the user must sign in again. */
function refreshIfNeeded(): bool
{
    $session = $_SESSION['lumoauth'] ?? null;
    if (!is_array($session)) {
        return false;
    }
    if (time() < ($session['expires_at'] ?? 0) - 30) {
        return true;
    }
    if (empty($session['refresh_token'])) {
        return false;
    }

    try {
        $tokens = lumo()->auth->refreshToken(
            refreshToken: $session['refresh_token'],
            clientId: config('LUMOAUTH_CLIENT_ID'),
            clientSecret: config('LUMOAUTH_CLIENT_SECRET'),
        );
    } catch (LumoAuthApiError $e) {
        // invalid_grant: the refresh token expired or was revoked, or the user was blocked.
        unset($_SESSION['lumoauth'], $_SESSION['user']);

        return false;
    }

    $_SESSION['lumoauth'] = [
        'access_token' => $tokens['access_token'],
        // Keep the new refresh token when the response has one; the old one may no longer work.
        'refresh_token' => $tokens['refresh_token'] ?? $session['refresh_token'],
        'id_token' => $tokens['id_token'] ?? ($session['id_token'] ?? null),
        'expires_at' => time() + (int) ($tokens['expires_in'] ?? 0),
    ];

    return true;
}
```

```php
<?php
// in a protected page

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/refresh.php';

requireLogin();
if (!refreshIfNeeded()) {
    header('Location: /login.php');
    exit;
}
```

PHP locks the session file for the length of a request, so two requests of one browser do not
refresh at the same time with the default file session handler. With a session handler that does
not lock, guard the refresh with a lock of your own.

## Sign out

End the local session first. Then send the browser to the LumoAuth logout endpoint, so that the
LumoAuth session ends too. Without the second step, the next visit to `/login.php` signs the
user in again without a prompt.

The SDK has the route (`Routes::OAUTH_LOGOUT`, `GET /orgs/{orgId}/api/v1/oauth/logout`) but no
helper that builds the URL. Build it from the transport:

```php
<?php
// public/logout.php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use LumoAuth\Routes;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$idToken = $_SESSION['lumoauth']['id_token'] ?? null;

$_SESSION = [];
session_destroy();

$http = lumo()->http();
[, $path] = $http->route(Routes::OAUTH_LOGOUT);

$params = [];
if (is_string($idToken) && $idToken !== '') {
    $params['id_token_hint'] = $idToken;
    $params['post_logout_redirect_uri'] = config('LUMOAUTH_POST_LOGOUT_REDIRECT_URI');
}

header('Location: ' . $http->baseUrl() . $path . ($params ? '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986) : ''));
exit;
```

- `id_token_hint` must be an ID token that LumoAuth issued to this application. An access token
  is not accepted.
- `post_logout_redirect_uri` must be registered on the application, with the same scheme rules
  as redirect URIs. LumoAuth uses it only when `id_token_hint` identifies the application.
  Otherwise the user sees the LumoAuth confirmation page for logout.
- `LUMOAUTH_POST_LOGOUT_REDIRECT_URI` is a name that this example reads. The SDK does not read it.
- Send the logout request from a form with `method="post"` and protect the form against CSRF
  like every other form of the app.

## Revoke a token

Revoke the refresh token when the user signs out or disconnects the app, so that it cannot be
used again:

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$refreshToken = $_SESSION['lumoauth']['refresh_token'] ?? null;
if (is_string($refreshToken) && $refreshToken !== '') {
    lumo()->auth->revoke(
        token: $refreshToken,
        tokenTypeHint: 'refresh_token',
        clientId: config('LUMOAUTH_CLIENT_ID'),
        clientSecret: config('LUMOAUTH_CLIENT_SECRET'),
    );
}
```

## Check the `iss` parameter on the callback

LumoAuth adds an `iss` parameter to the authorization response (RFC 9207). An app that signs
users in with more than one authorization server must compare it with the expected issuer before
it redeems the code. The issuer is the `issuer` value of the discovery document:

```text
GET {LUMOAUTH_URL}/orgs/{orgId}/api/v1/.well-known/openid-configuration
```

On the organization path the issuer is `{LUMOAUTH_URL}/orgs/{orgId}/api/v1`, for example
`https://app.lumoauth.dev/orgs/acme-corp/api/v1`. An organization with a verified custom domain
has a different issuer on that domain, so read the value from discovery and do not build it.

```php
$expectedIssuer = config('LUMOAUTH_ISSUER'); // the discovery "issuer"; a name that this example reads
if (isset($_GET['iss']) && !hash_equals($expectedIssuer, (string) $_GET['iss'])) {
    http_response_code(400);
    exit('Sign-in failed: unexpected issuer.');
}
```

## Extra authorization parameters

`authorizationUrl()` has named arguments for `prompt` and `access_type`, and it takes any other
parameter of the authorization endpoint through `extra:`.

```php
$url = lumo()->auth->authorizationUrl(
    clientId: config('LUMOAUTH_CLIENT_ID'),
    redirectUri: config('LUMOAUTH_REDIRECT_URI'),
    scope: 'openid profile email',
    state: $state,
    codeChallenge: $challenge,
    prompt: 'login',                              // force a new sign-in
    extra: ['login_hint' => 'user@example.com'],  // pre-fill the email field
);
```

`prompt` accepts `none`, `login`, `consent` and `create`. Use `lumoauth-oauth-oidc` for the full
list of authorization parameters and for scopes.
