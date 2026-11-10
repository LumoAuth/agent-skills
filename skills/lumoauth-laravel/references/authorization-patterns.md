# Laravel authorization patterns with LumoAuth

These patterns build on the routes and the `lumoauth_sub` column from `SKILL.md`.

## Contents

- [Custom subject resolver for the middleware](#custom-subject-resolver-for-the-middleware)
- [Gates, `@can` and `can:` middleware](#gates-can-and-can-middleware)
- [Check with the user's own access token](#check-with-the-users-own-access-token)
- [Sign out at LumoAuth](#sign-out-at-lumoauth)
- [Refresh the access token](#refresh-the-access-token)
- [Other namespaces through the container](#other-namespaces-through-the-container)

## Custom subject resolver for the middleware

By default `lumoauth.permission` reads the LumoAuth user ID from the user attribute that
`config('lumoauth.user_subject_attribute')` names (`lumoauth_sub`). Two ways to change that:

1. Another column: set `LUMOAUTH_USER_SUBJECT_ATTRIBUTE=identity_sub` in `.env`.
2. The ID is somewhere else (a related table, a JSON column): register a resolver. It receives
   the authenticated user and returns the LumoAuth user ID or `null`.

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use LumoAuth\Laravel\Http\Middleware\RequirePermission;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RequirePermission::resolveSubjectUsing(
            fn ($user): ?string => $user->identities()->where('provider', 'lumoauth')->value('subject'),
        );
    }
}
```

`RequirePermission::resolveSubjectUsing(null)` restores the default. When the resolver returns
`null` or an empty string, the middleware answers 403. The resolver must return the `sub` claim
of the user's LumoAuth tokens. Never return the app's own user ID or an email address: LumoAuth
answers `SUBJECT_NOT_FOUND` for an unknown ID, and the middleware turns that into 403.

`RequirePermission::subjectFor($user, 'lumoauth_sub')` returns the same ID outside the
middleware, through the resolver when one is set.

## Gates, `@can` and `can:` middleware

The package does not register Gates or policies. Define a Gate per permission with plain Laravel,
and let it ask LumoAuth:

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use LumoAuth\LumoAuth;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        foreach (['document.view', 'document.edit', 'billing.manage'] as $permission) {
            Gate::define($permission, function (User $user) use ($permission): bool {
                return $user->lumoauth_sub !== null
                    && app(LumoAuth::class)->permissions->check($permission, userId: $user->lumoauth_sub);
            });
        }
    }
}
```

Then use the normal Laravel tools:

```php
Route::put('/documents/{id}', [DocumentController::class, 'update'])
    ->middleware(['auth', 'can:document.edit']);
```

```blade
@can('document.edit')
    <a href="{{ route('documents.edit', $document) }}">Edit</a>
@endcan
```

- Each Gate call sends one request to LumoAuth. The SDK does not cache decisions. On a page with
  many `@can` checks, compute the decisions once in the controller and pass booleans to the view.
- An SDK exception inside a Gate is not a denial. It propagates, and Laravel answers 500. Catch
  `LumoAuth\Error\LumoAuthError` in the closure and return `false` when the page must render
  without LumoAuth.
- Hiding a link with `@can` is not protection. Protect the route too.

A policy method can make the same call:

```php
<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\User;
use LumoAuth\LumoAuth;

class DocumentPolicy
{
    public function __construct(private readonly LumoAuth $lumo)
    {
    }

    public function update(User $user, Document $document): bool
    {
        return $user->lumoauth_sub !== null
            && $this->lumo->permissions->check('document.edit', userId: $user->lumoauth_sub);
    }
}
```

For access that depends on the single object (owner, editor, viewer), use relationship checks
(`$lumo->zanzibar->check('document:' . $document->id, 'editor', 'user:' . $user->lumoauth_sub)`)
and the skill `lumoauth-rebac`.

## Check with the user's own access token

The bound client always uses the API key. To call LumoAuth as the signed-in user (no API key
scope needed, and required for ABAC checks), keep the access token in the session and create a
second client.

In the callback of `SKILL.md`, after `Auth::login($user)`:

```php
$request->session()->put('lumoauth_access_token', $tokens['access_token']);
$request->session()->put('lumoauth_refresh_token', $tokens['refresh_token'] ?? null);
$request->session()->put('lumoauth_expires_at', time() + (int) ($tokens['expires_in'] ?? 0));
```

Then:

```php
<?php

use LumoAuth\LumoAuth;

$asUser = new LumoAuth(
    baseUrl: config('lumoauth.url'),
    orgId: config('lumoauth.org_id'),
    tokenProvider: static function (): string {
        $token = session('lumoauth_access_token');
        if (!is_string($token) || $token === '') {
            throw new RuntimeException('No LumoAuth access token in the session.');
        }

        return $token;
    },
);

$allowed = $asUser->permissions->check('document.edit'); // about the token's user
```

The provider throws when the session has no token. That matters: when a provider returns `null`
and an API key is available, the SDK sends the API key, and the check is then about the key's
creator.

The session holds the tokens on the server (file, database or Redis driver). Do not use the
`cookie` session driver for them, and never print or log them.

Scopes that the user token needs: none for permission checks, `authz:read` for
`permissions->listSlugs()`, `abac:read` for ABAC checks. Request them in `scope:` at sign-in.

## Sign out at LumoAuth

End the Laravel session, then send the browser to the LumoAuth logout endpoint. The SDK has the
route constant but no helper for the URL.

```php
<?php
// routes/web.php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use LumoAuth\LumoAuth;
use LumoAuth\Routes;

Route::post('/logout', function (Request $request, LumoAuth $lumo) {
    $idToken = $request->session()->get('lumoauth_id_token');

    Auth::logout();
    $request->session()->invalidate();
    $request->session()->regenerateToken();

    [, $path] = $lumo->http()->route(Routes::OAUTH_LOGOUT);
    $params = [];
    if (is_string($idToken) && $idToken !== '') {
        $params = ['id_token_hint' => $idToken, 'post_logout_redirect_uri' => url('/')];
    }

    return redirect()->away($lumo->http()->baseUrl() . $path . ($params ? '?' . http_build_query($params) : ''));
})->middleware('auth')->name('logout');
```

- `id_token_hint` must be the ID token that LumoAuth issued to this application at sign-in.
- `post_logout_redirect_uri` must be registered on the application, and LumoAuth uses it only
  together with a valid `id_token_hint`. Otherwise the user sees the LumoAuth confirmation page.
- The route is `POST`, so the logout form carries Laravel's CSRF token (`@csrf`).

## Refresh the access token

Needed only when the app keeps the user's access token (previous section). The token response
has a `refresh_token` only when the grant types of the application include `refresh_token`
(portal: **Applications** → the application → **Configuration** → **Grant types**).

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use LumoAuth\Error\LumoAuthApiError;
use LumoAuth\LumoAuth;
use Symfony\Component\HttpFoundation\Response;

class RefreshLumoAuthToken
{
    public function __construct(private readonly LumoAuth $lumo)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $session = $request->session();
        $refreshToken = $session->get('lumoauth_refresh_token');

        if ($refreshToken !== null && time() >= (int) $session->get('lumoauth_expires_at', 0) - 30) {
            try {
                $tokens = $this->lumo->auth->refreshToken(
                    refreshToken: $refreshToken,
                    clientId: config('services.lumoauth.client_id'),
                    clientSecret: config('services.lumoauth.client_secret'),
                );
            } catch (LumoAuthApiError) {
                // The refresh token expired or was revoked, or the user was blocked.
                Auth::logout();
                $session->invalidate();

                return redirect()->route('login');
            }

            $session->put('lumoauth_access_token', $tokens['access_token']);
            $session->put('lumoauth_refresh_token', $tokens['refresh_token'] ?? $refreshToken);
            $session->put('lumoauth_expires_at', time() + (int) ($tokens['expires_in'] ?? 0));
        }

        return $next($request);
    }
}
```

Add the class to the routes that use the user's token, after `auth`. Store the new refresh token
whenever the response has one: the old one may stop working.

## Other namespaces through the container

The bound client is the full SDK client. Inject `LumoAuth\LumoAuth`, or resolve it with
`app(LumoAuth\LumoAuth::class)` or `app('lumoauth')`.

| Need | Call | Skill |
|---|---|---|
| Relationship check | `$lumo->zanzibar->check('document:42', 'viewer', 'user:' . $sub)` | `lumoauth-rebac` |
| Attribute policy check (user token, `abac:read`) | `$asUser->abac->isAllowed('document', 'read', '42')` | `lumoauth-abac` |
| Admin API request (API key with the matching `admin:*` scope) | `$lumo->http()->request('GET', $lumo->http()->orgPath('/admin/users'))` | `lumoauth-admin-api` |
| Facade for method calls | `LumoAuth\Laravel\Facades\LumoAuth::http()`, `::api()` | |

ABAC, agent, approval and JIT calls do not accept the organization API key. Call them with a
user access token or an agent credential. The method signatures and error classes are in the
skill `lumoauth-php`.
