# Sign users in to a Symfony web app with LumoAuth

`lumoauth/symfony-bundle` has no login controller and no authenticator for browser sign-in. This
file shows the supported way: the authorization code flow with PKCE, built from the SDK's `auth`
helpers inside a custom Symfony authenticator. The user gets a normal Symfony session.

It builds on `SKILL.md`: the `LumoAuth\LumoAuth` service (step 3), `App\Security\LumoAuthUser`
and `App\Security\LumoAuthUserProvider` (step 4).

## Contents

- [Before you start](#before-you-start)
- [1. Environment](#1-environment)
- [2. Login controller](#2-login-controller)
- [3. Authenticator](#3-authenticator)
- [4. Firewall](#4-firewall)
- [5. Logout at LumoAuth](#5-logout-at-lumoauth)
- [Verify](#verify)
- [Common mistakes](#common-mistakes)

## Before you start

Create a web application in the portal: **Applications** (`/orgs/{orgId}/portal/applications`) →
**New application** → Protocol **OpenID Connect**, **Web application**. Copy the client ID and the
client secret; the secret is shown once. Ask the user for values that you cannot find.

Register the redirect URI `{app URL}/login/callback`: `http://localhost:8000/login/callback` for
development and `https://app.example.com/login/callback` for production. Plain `http` is accepted
on `localhost`, `127.0.0.1` and `[::1]` for applications that are created in the portal, with
`lumo apps create` or through the Admin API; every other host needs `https`. Open the app in the
browser on the same host and port as the registered URI.

With the `lumo` CLI an admin can create the application. Show the command before you run it:

```bash
lumo apps create --name "Symfony app" \
  --redirect-uris http://localhost:8000/login/callback,https://app.example.com/login/callback -o json
```

The command creates a confidential client. Use `-o json`: the client secret is the `secret`
field of the JSON output and is shown only there.

## 1. Environment

```dotenv
# .env
LUMOAUTH_CLIENT_ID=
LUMOAUTH_CLIENT_SECRET=
```

Put the real values in `.env.local` or the secrets vault. The SDK does not read these two names;
the classes below read them through `#[Autowire(env: ...)]`. The client secret stays on the
server. Never render it and never send it to the browser.

## 2. Login controller

```php
<?php
// src/Controller/LumoAuthLoginController.php

namespace App\Controller;

use LumoAuth\LumoAuth;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;

final class LumoAuthLoginController extends AbstractController
{
    public function __construct(
        private readonly LumoAuth $lumo,
        #[Autowire(env: 'LUMOAUTH_CLIENT_ID')] private readonly string $clientId,
    ) {
    }

    #[Route('/login', name: 'lumoauth_login')]
    public function login(Request $request): RedirectResponse
    {
        $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $state = bin2hex(random_bytes(16));

        $session = $request->getSession();
        $session->set('lumoauth_state', $state);
        $session->set('lumoauth_verifier', $verifier);

        return new RedirectResponse($this->lumo->auth->authorizationUrl(
            clientId: $this->clientId,
            redirectUri: $this->generateUrl('lumoauth_callback', [], UrlGeneratorInterface::ABSOLUTE_URL),
            scope: 'openid profile email',
            state: $state,
            codeChallenge: $challenge, // the method defaults to S256
        ));
    }

    #[Route('/login/callback', name: 'lumoauth_callback')]
    public function callback(): never
    {
        throw new \LogicException('LumoAuthAuthenticator handles this route. Check the firewall configuration.');
    }

    #[Route('/logout', name: 'app_logout', methods: ['POST'])]
    public function logout(): never
    {
        throw new \LogicException('The firewall handles this route. Check the logout configuration.');
    }
}
```

## 3. Authenticator

The authenticator runs on the callback route. It checks `state`, exchanges the code with the
client secret and the PKCE verifier, reads the user's claims from userinfo, and returns a
passport for a `LumoAuthUser`.

```php
<?php
// src/Security/LumoAuthAuthenticator.php

namespace App\Security;

use LumoAuth\Error\LumoAuthError;
use LumoAuth\LumoAuth;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\EntryPoint\AuthenticationEntryPointInterface;
use Symfony\Component\Security\Http\Util\TargetPathTrait;

final class LumoAuthAuthenticator extends AbstractAuthenticator implements AuthenticationEntryPointInterface
{
    use TargetPathTrait;

    public function __construct(
        private readonly LumoAuth $lumo,
        private readonly UrlGeneratorInterface $urls,
        #[Autowire(env: 'LUMOAUTH_CLIENT_ID')] private readonly string $clientId,
        #[Autowire(env: 'LUMOAUTH_CLIENT_SECRET')] private readonly string $clientSecret,
    ) {
    }

    /** Send a visitor who is not signed in to the route that starts sign-in. */
    public function start(Request $request, ?AuthenticationException $authException = null): Response
    {
        return new RedirectResponse($this->urls->generate('lumoauth_login'));
    }

    public function supports(Request $request): ?bool
    {
        return $request->attributes->get('_route') === 'lumoauth_callback';
    }

    public function authenticate(Request $request): Passport
    {
        $session = $request->getSession();
        $state = (string) $session->remove('lumoauth_state');
        $verifier = (string) $session->remove('lumoauth_verifier');

        if ($state === '' || !hash_equals($state, (string) $request->query->get('state'))) {
            throw new CustomUserMessageAuthenticationException('Invalid state.');
        }
        $code = (string) $request->query->get('code');
        if ($code === '' || $request->query->has('error')) {
            throw new CustomUserMessageAuthenticationException('Sign-in was not completed.');
        }

        try {
            $tokens = $this->lumo->auth->exchangeCode(
                code: $code,
                redirectUri: $this->urls->generate('lumoauth_callback', [], UrlGeneratorInterface::ABSOLUTE_URL),
                clientId: $this->clientId,
                clientSecret: $this->clientSecret,
                codeVerifier: $verifier,
            );
            $claims = $this->lumo->auth->userinfo($tokens['access_token']);
        } catch (LumoAuthError $e) {
            throw new CustomUserMessageAuthenticationException('Sign-in failed.', [], 0, $e);
        }

        $sub = $claims['sub'] ?? null;
        if (!is_string($sub) || $sub === '') {
            throw new CustomUserMessageAuthenticationException('Sign-in failed.');
        }

        // Kept for the logout redirect. Never render or log it.
        $session->set('lumoauth_id_token', $tokens['id_token'] ?? null);

        return new SelfValidatingPassport(
            new UserBadge($sub, static fn (string $identifier): LumoAuthUser => new LumoAuthUser($identifier, $claims)),
        );
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        $target = $this->getTargetPath($request->getSession(), $firewallName);

        return new RedirectResponse($target ?? '/');
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): ?Response
    {
        return new Response('Sign-in failed. Start again.', Response::HTTP_FORBIDDEN);
    }
}
```

- `exchangeCode()` sends the client ID and secret in the form body of the token request. It does
  not send the API key.
- The user identifier is `sub`, the LumoAuth user ID. Permission checks with `userId:` and the
  voter from `SKILL.md` need exactly that value.
- To load the app's own `User` entity, replace the closure in the `UserBadge` with a lookup by
  `sub`. Link an existing account by email only when `$claims['email_verified']` is `true`.

## 4. Firewall

```yaml
# config/packages/security.yaml
security:
    providers:
        lumoauth:
            id: App\Security\LumoAuthUserProvider

    firewalls:
        dev:
            pattern: ^/(_(profiler|wdt)|css|images|js)/
            security: false

        # The api firewall from SKILL.md goes here, before main.

        main:
            lazy: true
            provider: lumoauth
            custom_authenticators:
                - App\Security\LumoAuthAuthenticator
            entry_point: App\Security\LumoAuthAuthenticator
            logout:
                path: app_logout

    access_control:
        - { path: ^/login, roles: PUBLIC_ACCESS }
        - { path: ^/account, roles: IS_AUTHENTICATED_FULLY }
```

A visitor who opens a protected page is sent to `/login` by the entry point, then to LumoAuth,
and after the callback back to the page that was first asked for. Symfony changes the session ID
at sign-in.

## 5. Logout at LumoAuth

Symfony's logout ends the local session only. Without a redirect to LumoAuth, the LumoAuth
session stays open and the next visit to `/login` signs the user in again without a prompt. This
subscriber replaces the logout redirect with the LumoAuth logout endpoint. The SDK has the route
constant (`Routes::OAUTH_LOGOUT`) but no helper for the URL.

```php
<?php
// src/EventSubscriber/LumoAuthLogoutSubscriber.php

namespace App\EventSubscriber;

use LumoAuth\LumoAuth;
use LumoAuth\Routes;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Http\Event\LogoutEvent;

/** After the local logout, send the browser to LumoAuth to end the session there too. */
final class LumoAuthLogoutSubscriber implements EventSubscriberInterface
{
    public function __construct(private readonly LumoAuth $lumo, private readonly UrlGeneratorInterface $urls)
    {
    }

    public static function getSubscribedEvents(): array
    {
        // Priority 32: after the default listener sets its redirect (64), and
        // before the session is invalidated (0), so the ID token is still there.
        return [LogoutEvent::class => ['onLogout', 32]];
    }

    public function onLogout(LogoutEvent $event): void
    {
        $request = $event->getRequest();
        $idToken = $request->hasSession() ? $request->getSession()->get('lumoauth_id_token') : null;

        [, $path] = $this->lumo->http()->route(Routes::OAUTH_LOGOUT);
        $params = [];
        if (is_string($idToken) && $idToken !== '') {
            $params = [
                'id_token_hint' => $idToken,
                'post_logout_redirect_uri' => $this->urls->generate('app_home', [], UrlGeneratorInterface::ABSOLUTE_URL),
            ];
        }

        $event->setResponse(new RedirectResponse(
            $this->lumo->http()->baseUrl() . $path . ($params ? '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986) : ''),
        ));
    }
}
```

- Replace `app_home` with the name of the route where users land after logout.
- `post_logout_redirect_uri` must be registered on the application, and LumoAuth uses it only
  together with an `id_token_hint` that it issued to this application. Otherwise the user sees
  the LumoAuth confirmation page for logout.
- The logout route accepts `POST` only. Send it from a form, and turn on `enable_csrf: true`
  under `logout` when the app has `symfony/security-csrf`.

## Verify

1. `php bin/console debug:router | grep -E 'lumoauth|app_logout'` lists the three routes.
2. Open a protected page as a guest. The browser goes to `/login` and then to
   `{LUMOAUTH_URL}/orgs/{orgId}/api/v1/oauth/authorize?...` with `code_challenge`,
   `code_challenge_method=S256` and `state`.
3. Sign in. The browser returns to `/login/callback?code=...&state=...` and then to the page that
   was first asked for. The web profiler shows a `LumoAuthUser` whose identifier is a UUID.
4. Open `/login/callback?code=x&state=wrong`. The answer is 403.
5. Submit the logout form. The browser goes to `.../oauth/logout?id_token_hint=...`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| LumoAuth shows a redirect URI error | The generated callback URL differs from the registered URI: another scheme, host or port (`localhost` and `127.0.0.1` are different hosts) | Open the app on the registered host; behind a load balancer set `framework.trusted_proxies` and `trusted_headers`; register the exact URI |
| "Invalid state." (403) on every callback | The session cookie did not come back: `cookie_samesite: strict`, `cookie_secure: true` on a plain `http` URL, or login and callback on different hosts | Use `lax` and one host. Set `framework.session.cookie_secure` to `auto`, which follows the request scheme. |
| The `LogicException` of `callback()` is thrown | The authenticator did not run: it is not listed in `custom_authenticators`, or another firewall matched the route | Fix `security.yaml` |
| "Sign-in failed." after a correct sign-in | `exchangeCode()` failed: wrong client secret, a code that was used twice, or a redirect URI that differs from the first request | Read the previous exception in the log; its `errorCode` is the OAuth error of the token response, for example `invalid_grant` |
| A redirect loop between `/login` and LumoAuth | `/login` or `/login/callback` requires authentication | Add the `PUBLIC_ACCESS` rule for `^/login` above other rules |
| After logout the user is signed in again at once | The logout subscriber is missing, so the LumoAuth session is still open | Add step 5 |
