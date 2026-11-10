---
name: lumoauth-php
description: >-
  Adds LumoAuth to a plain PHP 8.1+ application with the Composer package lumoauth/lumoauth.
  Covers the LumoAuth\LumoAuth client (constructor arguments, the LUMOAUTH_URL, LUMOAUTH_ORG_ID
  and LUMOAUTH_API_KEY environment variables, PSR-18 transport discovery with Guzzle), a complete
  authorization code + PKCE sign-in with $lumo->auth (authorizationUrl, exchangeCode, userinfo,
  refreshToken, revoke), RBAC permission checks, the zanzibar and abac namespaces, the error
  classes, and raw requests through $lumo->http(). Use when the user asks to add login, sign-in,
  OAuth, OpenID Connect or permission checks to a PHP app, script, worker or a framework without
  its own LumoAuth package (Slim, CodeIgniter, WordPress plugin), or mentions "lumoauth/lumoauth"
  or "composer require lumoauth". Not for Laravel (lumoauth-laravel) or Symfony (lumoauth-symfony).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for plain PHP

Install `lumoauth/lumoauth`, create one `LumoAuth\LumoAuth` client, sign users in with the
authorization code flow and PKCE, and ask LumoAuth whether the signed-in user holds a permission.

## When to use

- The project is PHP 8.1 or later and uses Composer, without Laravel or Symfony.
- The user wants sign-in with LumoAuth, permission checks, or calls to the LumoAuth API from PHP.

Do not use this skill when:

- The project is Laravel. Use `lumoauth-laravel`.
- The project is Symfony. Use `lumoauth-symfony`.
- The task is to validate JWT access tokens in an API. The PHP SDK does not verify JWTs or sign
  DPoP proofs. Use `lumoauth-api-protection`.
- The task is AAuth request signing (`LumoAuth\AAuth\AAuthClient`, `LumoAuth\AAuth\Signer`).
  Use `lumoauth-aauth`.

## Before you start

Collect these values. Ask the user for each value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US, the SDK default) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` part of the portal URL `/orgs/{orgId}/portal`, for example `acme-corp` |
| Client ID and client secret | Portal: **Applications** (`/orgs/{orgId}/portal/applications`) → **New application** → Protocol **OpenID Connect**, **Web application**. The secret is shown once, on the page that opens after creation. |
| Redirect URI | The callback URL of the app, registered on the application. It must match exactly. |
| API key (`lmk_...`), only for step 6B and for the Admin API | Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`) → **Create API key**. The key is shown once. |

Register `http://localhost:3000/callback.php` for development and
`https://app.example.com/callback.php` for production. Plain `http` is accepted on `localhost`,
`127.0.0.1` and `[::1]` for applications that are created in the portal, with `lumo apps create`
or through the Admin API; every other host needs `https`.

With the `lumo` CLI, an admin can create the application instead. Show the command to the user
before you run it, because it creates a resource in the organization:

```bash
lumo apps create --name "PHP web app" \
  --redirect-uris http://localhost:3000/callback.php,https://app.example.com/callback.php -o json
```

The command creates a confidential client. Use `-o json`: the client secret is the `secret`
field of the JSON output and is shown only there; the table output prints only a success line.
`lumo apps list` and `lumo apps get <client-id>` find an existing application. For CLI setup,
use `lumoauth-cli`.

## Steps

### 1. Install

```bash
composer config allow-plugins.php-http/discovery false
composer require lumoauth/lumoauth guzzlehttp/guzzle
```

The SDK sends requests through any PSR-18 client with PSR-17 factories and finds an installed
one through `php-http/discovery`. Guzzle 7 provides both. Skip `guzzlehttp/guzzle` when the
project already has a PSR-18 client. The first command answers the Composer plugin prompt for
`php-http/discovery`; the SDK does not need the plugin when a client is installed.

### 2. Set the environment

```bash
export LUMOAUTH_URL="https://app.lumoauth.dev"
export LUMOAUTH_ORG_ID="acme-corp"
export LUMOAUTH_CLIENT_ID="<client ID of the application>"
export LUMOAUTH_CLIENT_SECRET="<client secret of the application>"
export LUMOAUTH_REDIRECT_URI="http://localhost:3000/callback.php"
```

The SDK reads `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID` and `LUMOAUTH_API_KEY` by itself (through
`getenv()`, then `$_ENV`, then `$_SERVER`). It does not read the client ID, the client secret or
the redirect URI: the code below reads those three names. Keep the client secret and any API key
on the server. Never send them to the browser and never commit them.

### 3. Create the client and the session

```php
<?php
// src/bootstrap.php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use LumoAuth\LumoAuth;

session_start([
    'cookie_httponly' => true,
    // Secure cookies are not sent over plain http, so follow the scheme of the app URL.
    'cookie_secure' => str_starts_with((string) getenv('LUMOAUTH_REDIRECT_URI'), 'https://'),
    'cookie_samesite' => 'Lax',
]);

function config(string $name): string
{
    $value = getenv($name);
    if ($value === false || $value === '') {
        throw new RuntimeException("Missing environment variable $name");
    }

    return $value;
}

/** The client for sign-in. It reads LUMOAUTH_URL and LUMOAUTH_ORG_ID from the environment. */
function lumo(): LumoAuth
{
    static $client = null;

    return $client ??= new LumoAuth();
}

/** A client that calls LumoAuth as the signed-in user. */
function lumoAsUser(): LumoAuth
{
    return new LumoAuth(tokenProvider: static function (): string {
        $token = $_SESSION['lumoauth']['access_token'] ?? null;
        if (!is_string($token) || $token === '') {
            throw new RuntimeException('No signed-in user.');
        }

        return $token;
    });
}

/** @return array{sub: string, email: ?string, name: ?string} */
function requireLogin(): array
{
    if (!isset($_SESSION['user'])) {
        header('Location: /login.php');
        exit;
    }

    return $_SESSION['user'];
}
```

`SameSite=Lax` is required: with `Strict`, the browser does not send the session cookie when
LumoAuth redirects back, and the `state` check fails. The `Secure` flag is on when the app URL is
`https` (production) and off on `http://localhost`.

### 4. Start sign-in

```php
<?php
// public/login.php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
$challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
$state = bin2hex(random_bytes(16));

$_SESSION['lumoauth_flow'] = ['verifier' => $verifier, 'state' => $state];

$url = lumo()->auth->authorizationUrl(
    clientId: config('LUMOAUTH_CLIENT_ID'),
    redirectUri: config('LUMOAUTH_REDIRECT_URI'),
    scope: 'openid profile email',
    state: $state,
    codeChallenge: $challenge, // the method defaults to S256
);

header('Location: ' . $url);
exit;
```

### 5. Handle the callback

```php
<?php
// public/callback.php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use LumoAuth\Error\LumoAuthError;

$flow = $_SESSION['lumoauth_flow'] ?? null;
unset($_SESSION['lumoauth_flow']);

$state = $_GET['state'] ?? '';
$code = $_GET['code'] ?? '';

if (!is_array($flow) || !is_string($state) || !hash_equals($flow['state'], $state)) {
    http_response_code(400);
    exit('Sign-in failed: the state does not match. Start again at /login.php.');
}
if (isset($_GET['error']) || !is_string($code) || $code === '') {
    http_response_code(400);
    exit('Sign-in was not completed.');
}

try {
    $tokens = lumo()->auth->exchangeCode(
        code: $code,
        redirectUri: config('LUMOAUTH_REDIRECT_URI'),
        clientId: config('LUMOAUTH_CLIENT_ID'),
        clientSecret: config('LUMOAUTH_CLIENT_SECRET'),
        codeVerifier: $flow['verifier'],
    );
    $claims = lumo()->auth->userinfo($tokens['access_token']);
} catch (LumoAuthError $e) {
    error_log('LumoAuth sign-in failed: ' . $e->errorCode); // never log tokens or the code
    http_response_code(502);
    exit('Sign-in failed.');
}

session_regenerate_id(true);

$_SESSION['user'] = [
    'sub' => $claims['sub'], // the LumoAuth user ID
    'email' => $claims['email'] ?? null,
    'name' => $claims['name'] ?? null,
];
$_SESSION['lumoauth'] = [
    'access_token' => $tokens['access_token'],
    'refresh_token' => $tokens['refresh_token'] ?? null,
    'id_token' => $tokens['id_token'] ?? null,
    'expires_at' => time() + (int) ($tokens['expires_in'] ?? 0),
];

header('Location: /');
exit;
```

`exchangeCode()` sends the client ID and secret in the form body of the token request. It never
sends the API key. `userinfo()` returns `sub` for the `openid` scope, `name` for `profile`, and
`email` and `email_verified` for `email`. Match a local account by `sub`. Match by email only
when `email_verified` is `true`.

### 6. Check a permission

Pick one of the two ways.

**A. With the user's access token.** No API key is needed, and the check is about the token's
user.

```php
<?php
// public/documents-edit.php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$user = requireLogin();

if (!lumoAsUser()->permissions->check('document.edit')) {
    http_response_code(403);
    exit('You may not edit documents.');
}

echo 'Editing as ' . htmlspecialchars((string) ($user['email'] ?? $user['sub']));
```

**B. With an organization API key.** Set `LUMOAUTH_API_KEY` and pass the LumoAuth user ID as
`userId:`. The key needs the `authz:check` scope. Without `userId:`, the check is about the
user who created the key.

```php
$allowed = lumo()->permissions->check('document.edit', userId: $user['sub']);
```

`userId:` is the `sub` claim, a UUID. The app's own user ID or an email address does not work.
For roles and permission design, use `lumoauth-rbac`. For relationship checks
(`$lumo->zanzibar`) and attribute policies (`$lumo->abac`), use `lumoauth-rebac` and
`lumoauth-abac`; the method signatures are in [the client reference](references/client-reference.md).

### 7. Handle errors

Every SDK exception extends `LumoAuth\Error\LumoAuthError` and has `errorCode`. API errors
(`LumoAuthApiError` and its subclasses) also have `statusCode` and `body`.

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use LumoAuth\Error\LumoAuthAuthenticationError;
use LumoAuth\Error\LumoAuthError;
use LumoAuth\Error\LumoAuthPermissionDeniedError;
use LumoAuth\Error\LumoAuthRateLimitError;

try {
    $allowed = lumoAsUser()->permissions->check('document.edit');
} catch (LumoAuthAuthenticationError $e) {
    // 401: the access token expired or was revoked. Refresh it or sign the user in again.
    header('Location: /login.php');
    exit;
} catch (LumoAuthPermissionDeniedError $e) {
    // 403: $e->requiredScopes lists the scopes that the credential lacks, when the server names them.
    $allowed = false;
} catch (LumoAuthRateLimitError $e) {
    http_response_code(503);
    header('Retry-After: ' . (int) ceil($e->retryAfter ?? 1));
    exit;
} catch (LumoAuthError $e) {
    error_log('LumoAuth error: ' . $e->errorCode);
    $allowed = false; // fail closed
}
```

A denied check is not an exception: `check()` returns `false`.

### 8. Call an endpoint that the SDK does not wrap

`$lumo->http()` returns the transport. It adds the credential and maps errors like the
namespaces do. `orgPath()` prefixes `/orgs/{orgId}/api/v1`.

```php
$http = lumo()->http();
$users = $http->request('GET', $http->orgPath('/admin/users')); // API key with admin:users:read
```

For the Admin API and the generated client (`$lumo->api()`), use `lumoauth-admin-api`.

## Verify

1. Start the app on the host and port of the redirect URI, for example
   `php -S localhost:3000 -t public`.
2. Open `/login.php`. The browser goes to
   `{LUMOAUTH_URL}/orgs/{orgId}/api/v1/oauth/authorize?...` with `code_challenge` and `state`.
3. Sign in. The browser returns to `/callback.php?code=...&state=...` and then to `/`.
4. Open the page from step 6 as a user with the permission, then as a user without it. The
   second request gets 403.
5. Check a credential from the command line:

```bash
php -r 'require "vendor/autoload.php"; var_dump((new LumoAuth\LumoAuth())->permissions->check("document.edit"));'
```

With `LUMOAUTH_API_KEY` set, this prints `bool(true)` or `bool(false)` for the user who created
the key. A `LumoAuthAuthenticationError` means that the key is wrong.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows a redirect URI error | The URI is not registered exactly, or it is `http` on a host other than `localhost`, `127.0.0.1` or `[::1]` | Register the exact URI: same scheme, host, port, path and query. Use `https` outside loopback. |
| `Http\Discovery\Exception\NotFoundException` when the client is created | No PSR-18 client or PSR-17 factory is installed | `composer require guzzlehttp/guzzle`, or pass `httpClient`, `requestFactory` and `streamFactory` |
| The state check fails on every callback | The session cookie is `SameSite=Strict`, it has the `Secure` flag on a plain `http` URL, or login and callback run on different hosts (`localhost` and `127.0.0.1` are different hosts) | Use `Lax`, set the `Secure` flag from the scheme, and use one host for both pages |
| `LumoAuthApiError` with `errorCode` `invalid_grant` in the callback | The code was used twice or expired, or `redirectUri` or `codeVerifier` differs from the first request | Send the same redirect URI, keep the verifier in the session, and exchange each code once |
| `LumoAuthConfigError: orgId is required` | `LUMOAUTH_ORG_ID` is not set and `orgId:` was not passed | Set it. Only permission and Zanzibar checks work without it. |
| A check returns the same answer for every user | The client used the API key without `userId:`, so the check is about the key's creator | Pass `userId: $sub`, or call with the user's token |
| 403 `INSUFFICIENT_PERMISSIONS` on a check with `userId:` | The API key lacks the `authz:check` scope | Add the scope to the key in the portal |
| `LumoAuthNotFoundError` with `SUBJECT_NOT_FOUND` | `userId:` is not a LumoAuth user ID | Pass the `sub` claim, not the app's own ID |
| 401 on an ABAC, agent, approval or JIT call | These calls do not accept an organization API key | Call with a user access token or an agent credential |
| Only `sub` comes back from `userinfo()` | The `profile` and `email` scopes were not requested | Request `openid profile email` |
| A request hangs | Guzzle has no timeout by default | Pass a configured client; see the client reference |

## Related skills

- `lumoauth-oauth-oidc` — scopes, client types, token lifetimes and the protocol details.
- `lumoauth-api-protection` — validate access tokens in a PHP API without the SDK.
- `lumoauth-rbac`, `lumoauth-rebac`, `lumoauth-abac` — design the authorization model that the checks read.
- `lumoauth-admin-api` — manage users, applications and settings from code.
- `lumoauth-agent-identity`, `lumoauth-agent-approvals`, `lumoauth-agent-delegation`, `lumoauth-mcp-client`, `lumoauth-aauth` — the `agents`, `approvals`, `jit`, `delegation`, `mcp` and AAuth parts of the SDK.

## References

- [references/client-reference.md](references/client-reference.md) — read it for the constructor,
  the credential and scope rules, every namespace method, the error classes and a custom transport.
- [references/session-lifecycle.md](references/session-lifecycle.md) — read it to refresh an
  expired access token, sign the user out at LumoAuth, revoke tokens, or check the `iss` parameter.
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/oauth/authorize
