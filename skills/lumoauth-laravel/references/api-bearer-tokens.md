# Laravel API routes that receive LumoAuth bearer tokens

Use this when a single-page app, a mobile app or another service calls the Laravel API with
`Authorization: Bearer <access token>`, where LumoAuth issued the token.

`lumoauth/laravel` has no guard for bearer tokens. The supported way with the SDK is a small
request guard that sends the token to the LumoAuth userinfo endpoint (`$lumo->auth->userinfo()`).
The `lumoauth.permission` middleware then works on these routes without changes.

## What this guard does and does not check

| Checked by userinfo | Not checked |
|---|---|
| LumoAuth issued the token for a user of this organization | The audience: for which application or API the token was issued |
| The token is not expired or revoked, and the user is not blocked or deleted | Scopes other than `openid` |
| The token has the `openid` scope | |

- When the API must accept only tokens that were issued for it, validate the token as a JWT
  (signature, `iss`, `aud`, `exp`, scopes). The PHP SDK does not verify JWTs. Use the skill
  `lumoauth-api-protection`.
- A token without the `openid` scope is refused by userinfo. Tokens from the client credentials
  grant therefore do not pass this guard. Validate those with `lumoauth-api-protection`.
- Userinfo refuses a DPoP-bound token that is sent as `Bearer`. The PHP SDK does not send DPoP
  proofs.
- The guard makes one request to LumoAuth for each API request.

## 1. Register the guard driver

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use Illuminate\Auth\GenericUser;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\ServiceProvider;
use LumoAuth\Error\LumoAuthAuthenticationError;
use LumoAuth\Error\LumoAuthPermissionDeniedError;
use LumoAuth\LumoAuth;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Auth::viaRequest('lumoauth-token', function (Request $request): ?GenericUser {
            $token = $request->bearerToken();
            if ($token === null || $token === '') {
                return null;
            }

            try {
                $claims = app(LumoAuth::class)->auth->userinfo($token);
            } catch (LumoAuthAuthenticationError | LumoAuthPermissionDeniedError) {
                return null; // 401 invalid_token or 403 insufficient_scope from userinfo
            }

            $sub = $claims['sub'] ?? null;
            if (!is_string($sub) || $sub === '') {
                return null;
            }

            return new GenericUser([
                'id' => $sub,
                'lumoauth_sub' => $sub,
                'email' => $claims['email'] ?? null,
                'name' => $claims['name'] ?? null,
            ]);
        });
    }
}
```

`userinfo($token)` sends the given token in the `Authorization` header. The API key of the bound
client is not sent on that call. Other SDK exceptions (network failure, rate limit) are not
caught: the request fails with 500 and no user is authenticated.

To return the app's own `User` model, look it up by `lumoauth_sub` in the closure and return it.
Return `null` when there is no such user.

## 2. Add the guard

```php
// config/auth.php, inside 'guards'
'lumoauth' => [
    'driver' => 'lumoauth-token',
],
```

## 3. Protect the routes

```php
<?php
// routes/api.php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:lumoauth'])->get('/me', function (Request $request) {
    return ['sub' => $request->user()->lumoauth_sub, 'email' => $request->user()->email];
});

Route::middleware(['auth:lumoauth', 'lumoauth.permission:document.view'])
    ->get('/documents', fn () => ['documents' => []]);
```

`auth:lumoauth` runs first and makes `$request->user()` return the token's user.
`lumoauth.permission` reads `lumoauth_sub` from that user and asks LumoAuth with the organization
API key, which needs the `authz:check` scope.

To check without an API key, ask LumoAuth with the caller's own token:

```php
<?php

use Illuminate\Http\Request;
use LumoAuth\LumoAuth;

function callerMay(Request $request, string $permission): bool
{
    $token = (string) $request->bearerToken();
    $asCaller = new LumoAuth(
        baseUrl: config('lumoauth.url'),
        orgId: config('lumoauth.org_id'),
        tokenProvider: static fn (): string => $token,
    );

    return $asCaller->permissions->check($permission);
}
```

Call it only on routes behind `auth:lumoauth`, where the token is known to be valid and not empty.

## 4. Verify

```bash
curl -i https://app.example.com/api/me -H "Accept: application/json"
curl -i https://app.example.com/api/me -H "Accept: application/json" -H "Authorization: Bearer $ACCESS_TOKEN"
```

The first request gets 401. The second gets 200 and the `sub` of the token's user, when
`ACCESS_TOKEN` holds an access token that LumoAuth issued with the `openid` scope. Without
`Accept: application/json`, Laravel redirects an unauthenticated request to the `login` route.

## Optional: cache the userinfo answer

A short cache removes most of the extra requests. The cost: a token that was revoked keeps
working here until the cache entry expires. Keep the lifetime short and key the entry by a hash
of the token, never by the token.

```php
use Illuminate\Support\Facades\Cache;

$claims = Cache::remember(
    'lumoauth:userinfo:' . hash('sha256', $token),
    30, // seconds
    fn () => app(LumoAuth::class)->auth->userinfo($token),
);
```

Put this in place of the `userinfo()` call in step 1, inside the same `try` block. An exception
is not cached.
