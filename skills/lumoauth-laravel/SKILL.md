---
name: lumoauth-laravel
description: >-
  Adds LumoAuth to a Laravel 10, 11 or 12 application with the Composer package lumoauth/laravel.
  Covers install, the published config/lumoauth.php and its .env variables (LUMOAUTH_URL,
  LUMOAUTH_ORG_ID, LUMOAUTH_API_KEY, LUMOAUTH_USER_SUBJECT_ATTRIBUTE), the auto-discovered service
  provider, injecting LumoAuth\LumoAuth, the LumoAuth facade, the lumoauth.permission route
  middleware (how it finds the signed-in user and what it answers on deny), sign-in with the
  authorization code flow and PKCE in routes that use the SDK's auth helpers, the lumoauth_sub
  column, Gates, and a request guard for API routes that receive LumoAuth bearer tokens. Use when
  the user asks to add LumoAuth login, SSO, OAuth, OpenID Connect, RBAC or permission middleware
  to a Laravel app, or mentions "lumoauth/laravel" or "lumoauth.permission". Not for plain PHP
  (lumoauth-php) or Symfony (lumoauth-symfony).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Laravel

Install `lumoauth/laravel`, sign users in through LumoAuth, store each user's LumoAuth user ID,
and protect routes with the `lumoauth.permission` middleware.

## What the package provides

| Provided by `lumoauth/laravel` | Not provided: write it in the app |
|---|---|
| A service provider (auto-discovered) that binds `LumoAuth\LumoAuth` as a singleton, also under the name `lumoauth` | Sign-in routes. Step 5 writes them with the SDK's `auth` helpers. |
| The `LumoAuth` facade (`LumoAuth\Laravel\Facades\LumoAuth`) | A guard for bearer tokens. See [references/api-bearer-tokens.md](references/api-bearer-tokens.md). |
| The route middleware alias `lumoauth.permission` | Gates and policies. See [references/authorization-patterns.md](references/authorization-patterns.md). |
| `config/lumoauth.php`, publishable with the tag `lumoauth-config` | The column that stores the LumoAuth user ID. Step 4 adds it. |

## When to use

- The project is Laravel 10, 11 or 12 on PHP 8.1 or later.
- The user wants LumoAuth sign-in, permission checks on routes, or LumoAuth API calls from Laravel.

Do not use this skill for plain PHP (`lumoauth-php`) or Symfony (`lumoauth-symfony`). To validate
JWT access tokens locally in an API, use `lumoauth-api-protection`: the PHP SDK does not verify
JWTs.

## Before you start

Ask the user for each value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US, the default) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` part of the portal URL `/orgs/{orgId}/portal`, for example `acme-corp` |
| Organization API key (`lmk_...`) with the `authz:check` scope | Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`) → **Create API key**, tick `authz:check` under **Permissions**. The key is shown once. |
| Client ID and client secret | Portal: **Applications** (`/orgs/{orgId}/portal/applications`) → **New application** → Protocol **OpenID Connect**, **Web application**. The secret is shown once. |
| Redirect URI | `{APP_URL}/auth/lumoauth/callback`, registered on the application. It must match exactly. |

Register `http://localhost:8000/auth/lumoauth/callback` for development (the URL of
`php artisan serve`) and `https://app.example.com/auth/lumoauth/callback` for production. Plain
`http` is accepted on `localhost`, `127.0.0.1` and `[::1]` for applications that are created in
the portal, with `lumo apps create` or through the Admin API; every other host needs `https`.
Set `APP_URL` to the URL that the browser uses, with the same host and port as the redirect URI.

With the `lumo` CLI an admin can create the application. Show the command before you run it:

```bash
lumo apps create --name "Laravel app" \
  --redirect-uris http://localhost:8000/auth/lumoauth/callback,https://app.example.com/auth/lumoauth/callback -o json
```

The command creates a confidential client. Use `-o json`: the client secret is the `secret`
field of the JSON output and is shown only there. The CLI has no command for API keys; create
the key in the portal.

## Steps

### 1. Install

```bash
composer config allow-plugins.php-http/discovery false
composer require lumoauth/laravel
```

Package discovery registers the provider and the `LumoAuth` facade alias. The SDK sends requests
through Guzzle, which Laravel already installs. The first command answers the Composer plugin
prompt for `php-http/discovery`; the SDK does not need that plugin.

### 2. Configure

```dotenv
# .env
LUMOAUTH_URL=https://app.lumoauth.dev
LUMOAUTH_ORG_ID=acme-corp
LUMOAUTH_API_KEY=
LUMOAUTH_CLIENT_ID=
LUMOAUTH_CLIENT_SECRET=
```

Put the real values in `.env` and keep that file out of version control. The package reads the
first three through `config/lumoauth.php`. It does not read the client ID or secret, so add them
to `config/services.php`:

```php
// config/services.php, inside the returned array
'lumoauth' => [
    'client_id' => env('LUMOAUTH_CLIENT_ID'),
    'client_secret' => env('LUMOAUTH_CLIENT_SECRET'),
],
```

Publishing the package config is optional; the environment variables work without it:

```bash
php artisan vendor:publish --tag=lumoauth-config
```

| Key in `config/lumoauth.php` | Environment variable | Default |
|---|---|---|
| `url` | `LUMOAUTH_URL` | `https://app.lumoauth.dev` |
| `org_id` | `LUMOAUTH_ORG_ID` | none |
| `api_key` | `LUMOAUTH_API_KEY` | none; sent as `X-API-Key` |
| `user_subject_attribute` | `LUMOAUTH_USER_SUBJECT_ATTRIBUTE` | `lumoauth_sub` |

The client secret and the API key stay on the server. Never pass them to Blade output,
JavaScript or logs.

### 3. Understand which user a check is about

The bound client uses the organization API key. A permission check with that key and no subject
is about the user who created the key, not about the visitor. Every check for a signed-in user
therefore passes the user's LumoAuth user ID: the `sub` claim, a UUID. The app's own `users.id`
does not work. The middleware does this for you, from the `lumoauth_sub` attribute.

### 4. Add the `lumoauth_sub` column

```bash
php artisan make:migration add_lumoauth_sub_to_users_table --table=users
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('lumoauth_sub')->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['lumoauth_sub']);
            $table->dropColumn('lumoauth_sub');
        });
    }
};
```

```bash
php artisan migrate
```

### 5. Add the sign-in routes

```php
<?php
// routes/web.php

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use LumoAuth\Error\LumoAuthError;
use LumoAuth\LumoAuth;

Route::get('/auth/lumoauth', function (LumoAuth $lumo) {
    $state = Str::random(40);
    $verifier = Str::random(64);
    session(['lumoauth_state' => $state, 'lumoauth_verifier' => $verifier]);

    return redirect()->away($lumo->auth->authorizationUrl(
        clientId: config('services.lumoauth.client_id'),
        redirectUri: route('lumoauth.callback'),
        scope: 'openid profile email',
        state: $state,
        codeChallenge: rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='),
    ));
})->name('login');

Route::get('/auth/lumoauth/callback', function (Request $request, LumoAuth $lumo) {
    $state = (string) $request->session()->pull('lumoauth_state');
    $verifier = (string) $request->session()->pull('lumoauth_verifier');

    abort_unless($state !== '' && hash_equals($state, (string) $request->query('state')), 400, 'Invalid state.');
    abort_if($request->has('error') || !$request->filled('code'), 400, 'Sign-in was not completed.');

    try {
        $tokens = $lumo->auth->exchangeCode(
            code: (string) $request->query('code'),
            redirectUri: route('lumoauth.callback'),
            clientId: config('services.lumoauth.client_id'),
            clientSecret: config('services.lumoauth.client_secret'),
            codeVerifier: $verifier,
        );
        $claims = $lumo->auth->userinfo($tokens['access_token']);
    } catch (LumoAuthError $e) {
        report($e);
        abort(502, 'Sign-in failed.');
    }

    // Find the user by the LumoAuth user ID first. Link an existing account by email
    // only when LumoAuth has verified that email.
    $user = User::firstWhere('lumoauth_sub', $claims['sub']);
    if ($user === null && ($claims['email_verified'] ?? false) === true) {
        $user = User::firstWhere('email', $claims['email']);
    }
    abort_if($user === null, 403, 'No account for this LumoAuth user.');

    $user->forceFill(['lumoauth_sub' => $claims['sub']])->save();

    Auth::login($user);
    $request->session()->regenerate();
    $request->session()->put('lumoauth_id_token', $tokens['id_token'] ?? null);

    return redirect()->intended('/');
})->name('lumoauth.callback');
```

- The route name `login` makes Laravel's `auth` middleware send guests to `/auth/lumoauth`. If
  the app already has a route named `login`, pick another name and link to it from the login page.
- This callback refuses a LumoAuth user who has no local account. Ask the user whether unknown
  users must get an account on first sign-in. If yes, create the `User` there from `sub`, `email`
  and `name` before the `abort_if` line.
- `exchangeCode()` and `userinfo($token)` do not use the API key. The token request carries the
  client ID and secret in its form body.
- For sign-out at LumoAuth and token refresh, read
  [references/authorization-patterns.md](references/authorization-patterns.md).

### 6. Protect routes with `lumoauth.permission`

```php
<?php
// routes/web.php

use App\Http\Controllers\DocumentController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'lumoauth.permission:document.view'])
    ->get('/documents/{id}', [DocumentController::class, 'show']);

Route::middleware(['auth', 'lumoauth.permission:document.view,document.edit'])
    ->put('/documents/{id}', [DocumentController::class, 'update']);
```

The middleware requires every listed permission. Its exact behaviour:

| Situation | Result |
|---|---|
| `$request->user()` is `null` | `HttpException` 401, "Authentication required." |
| No permission is listed (`lumoauth.permission`) | The request continues for any signed-in user |
| The user has no LumoAuth user ID | 403, "The signed-in user has no LumoAuth user ID." |
| LumoAuth does not know the ID (`SUBJECT_NOT_FOUND`) | 403, "LumoAuth does not know the signed-in user." |
| A listed permission is missing | 403, "Missing permission: ..." |
| Every listed permission is granted | The request continues |
| The API key is wrong or lacks `authz:check`, or LumoAuth cannot be reached | The SDK exception is not caught: Laravel answers 500 |

It reads the LumoAuth user ID from the attribute that `user_subject_attribute` names
(`getAttribute()` on an Eloquent model, a property on other objects, a key on an array). It never
falls back to the app's own user ID. It asks LumoAuth with
`permissions->checkAll($permissions, userId: $subject)` on each request.

Put `auth` (or `auth:<guard>`) before `lumoauth.permission`, so that `$request->user()` returns
the user of the right guard.

### 7. Check inside a controller

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use LumoAuth\LumoAuth;

class DocumentController extends Controller
{
    public function __construct(private readonly LumoAuth $lumo)
    {
    }

    public function update(Request $request, string $id)
    {
        $sub = $request->user()->lumoauth_sub;
        abort_unless($sub !== null && $this->lumo->permissions->check('document.edit', userId: $sub), 403);

        // update the document

        return response()->noContent();
    }
}
```

The facade forwards method calls only, and the SDK exposes its namespaces as properties. Get the
client first:

```php
use LumoAuth\Laravel\Facades\LumoAuth;

$allowed = LumoAuth::getFacadeRoot()->permissions->check('document.edit', userId: $sub);
```

For roles and permission design, use `lumoauth-rbac`.

## Verify

1. `php artisan route:list --name=lumoauth` lists the callback route.
2. `php artisan tinker --execute="var_dump(app(LumoAuth\LumoAuth::class)->permissions->check('document.view'));"`
   prints a boolean. A `LumoAuthAuthenticationError` means that `LUMOAUTH_API_KEY` is wrong.
3. Open `/auth/lumoauth` in a browser, sign in, and confirm that `users.lumoauth_sub` holds a UUID.
4. Request a protected route as a guest (redirect to sign-in, or 401 for JSON), as a user without
   the permission (403) and as a user with it (200).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| 403 "The signed-in user has no LumoAuth user ID." | The user signed in before the column existed, or through another login | Store `sub` at sign-in; the user gets it on the next LumoAuth sign-in |
| 500 with `LumoAuthPermissionDeniedError` (`INSUFFICIENT_PERMISSIONS`) | The API key lacks `authz:check` | Add the scope to the key in the portal |
| 500 with `LumoAuthAuthenticationError` | `LUMOAUTH_API_KEY` is missing or wrong, or the config cache is stale | Fix `.env`, then `php artisan config:clear` |
| A check without `userId:` gives every visitor the same answer | The check is about the creator of the API key | Pass `userId: $user->lumoauth_sub` |
| LumoAuth shows a redirect URI error | `route('lumoauth.callback')` differs from the registered URI: another scheme, host or port (`localhost` and `127.0.0.1` are different hosts) | Open the app on the registered host, set `APP_URL`, configure trusted proxies behind a load balancer, register the exact URI |
| "Invalid state." on every callback | The session cookie is not sent back: `SESSION_SAME_SITE=strict`, `SESSION_SECURE_COOKIE=true` on a plain `http` URL, or login and callback use different hosts | Use `lax` and one host. Set `SESSION_SECURE_COOKIE=true` only where the app runs on `https`. |
| `LumoAuthApiError` `invalid_grant` in the callback | The code was redeemed twice (page reload), or the verifier was lost | Start sign-in again; keep both values in the session |
| `LumoAuth::permissions` fails on the facade | Facades forward methods, not properties | `LumoAuth::getFacadeRoot()->permissions` or inject `LumoAuth\LumoAuth` |
| `Http\Discovery\Exception\NotFoundException` when the client is resolved | No PSR-18 client is installed | `composer require guzzlehttp/guzzle` |
| The middleware checked the wrong guard's user | `lumoauth.permission` ran before `auth:<guard>` | Order the middleware: `auth:<guard>` first |
| Upgraded from `lumoauth/laravel` 1.0.x and every check now answers 403 | 1.0.x sent the app's own user ID; later versions need `lumoauth_sub` | Do steps 4 and 5 |

## Related skills

- `lumoauth-php` — the core SDK that this package wraps: every namespace, error class and the transport.
- `lumoauth-rbac` — roles, permissions and groups that the middleware checks.
- `lumoauth-oauth-oidc` — scopes, client types and the protocol behind step 5.
- `lumoauth-api-protection` — local JWT validation for APIs, with issuer and audience checks.
- `lumoauth-login-methods` — what the hosted sign-in page offers (password, magic link, social login).

## References

- [references/authorization-patterns.md](references/authorization-patterns.md) — read it for a
  custom subject resolver, Gates and `@can`, checks with the user's own access token, sign-out at
  LumoAuth and token refresh.
- [references/api-bearer-tokens.md](references/api-bearer-tokens.md) — read it when API routes
  receive `Authorization: Bearer` access tokens from LumoAuth instead of a session cookie.
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/user-guide/applications/oauth2-oidc
