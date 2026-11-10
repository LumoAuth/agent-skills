---
name: lumoauth-symfony
description: >-
  Adds LumoAuth to a Symfony 6.4 or 7 application with the Composer package
  lumoauth/symfony-bundle. Covers install, registering the LumoAuth\LumoAuth client as an
  autowired service (LUMOAUTH_URL, LUMOAUTH_ORG_ID, LUMOAUTH_API_KEY), the security component's
  access_token authenticator with LumoAuthAccessTokenHandler for API routes that receive bearer
  tokens (what the user badge carries), a user provider, permission checks in controllers and in
  a voter with #[IsGranted], and sign-in for a web app with the authorization code flow and PKCE
  through a custom authenticator. Also documents the configuration tree of LumoAuthBundle (url,
  org_id, api_key, http_client, user_identifier_claim). Use when the user asks to add LumoAuth
  login, SSO, OAuth, OpenID Connect, bearer token authentication, RBAC or permission checks to a
  Symfony app, or mentions "lumoauth/symfony-bundle", "LumoAuthBundle" or security.yaml with
  LumoAuth. Not for Laravel (lumoauth-laravel) or plain PHP (lumoauth-php).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for Symfony

Install `lumoauth/symfony-bundle`, make the `LumoAuth\LumoAuth` client an autowired service,
accept LumoAuth bearer tokens on an API firewall, and check permissions in controllers and voters.

## What the package provides

| In `lumoauth/symfony-bundle` | Not in the package: write it in the app |
|---|---|
| The core SDK `lumoauth/lumoauth` (as a dependency): the `LumoAuth\LumoAuth` client | A user class and a user provider (step 4) |
| `LumoAuth\Symfony\Security\LumoAuthAccessTokenHandler` for the `access_token` authenticator | A voter for permission checks (step 6) |
| `LumoAuth\Symfony\LumoAuthBundle`, which is meant to register both as services from configuration | Sign-in for a web app with a session: see [references/web-sign-in.md](references/web-sign-in.md) |

**Do not enable `LumoAuthBundle` in `config/bundles.php`.** In the published versions up to and
including 1.4.0, the bundle class throws while Symfony builds the container:
`Call to undefined method "Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator::service()"`.
This skill registers the two services directly in `config/services.yaml` (step 3). That gives the
same services and works with those versions. The configuration keys that the bundle class
declares are listed in [references/configuration.md](references/configuration.md).

## When to use

- The project is Symfony 6.4 or 7 on PHP 8.1 or later.
- The user wants a Symfony API to accept LumoAuth access tokens, permission checks through
  LumoAuth, or LumoAuth sign-in for a Symfony web app.

Do not use this skill for Laravel (`lumoauth-laravel`) or plain PHP (`lumoauth-php`). To validate
JWT access tokens locally (signature, issuer, audience), use `lumoauth-api-protection`: the PHP
SDK does not verify JWTs.

## Before you start

Ask the user for each value that you cannot find. Never guess one.

| Value | Where it comes from |
|---|---|
| Region base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug | The `{orgId}` part of the portal URL `/orgs/{orgId}/portal`, for example `acme-corp` |
| Organization API key (`lmk_...`) with the `authz:check` scope | Portal: **API keys** (`/orgs/{orgId}/portal/settings/api-keys`) → **Create API key**, tick `authz:check` under **Permissions**. The key is shown once. |
| For web sign-in only: client ID, client secret, redirect URI | Portal: **Applications** (`/orgs/{orgId}/portal/applications`) → **New application** → Protocol **OpenID Connect**, **Web application** |

The API key is needed for permission checks about the signed-in user. The token handler alone
works without it.

## Steps

### 1. Install

```bash
composer config allow-plugins.php-http/discovery false
composer require lumoauth/symfony-bundle symfony/http-client nyholm/psr7
```

The SDK needs a PSR-18 client and PSR-17 factories and finds installed ones by itself.
`symfony/http-client` with `nyholm/psr7` is one such pair; Guzzle is another. The first command
answers the Composer plugin prompt for `php-http/discovery`; the SDK does not need that plugin.

Then open `config/bundles.php`. If it has a line for `LumoAuth\Symfony\LumoAuthBundle`, remove
that line.

### 2. Set the environment

```dotenv
# .env
LUMOAUTH_URL=https://app.lumoauth.dev
LUMOAUTH_ORG_ID=acme-corp
LUMOAUTH_API_KEY=
```

Put the real API key in `.env.local`, which is not committed, or in the Symfony secrets vault
(`php bin/console secrets:set LUMOAUTH_API_KEY`). The key stays on the server.

### 3. Register the services

```yaml
# config/services.yaml
services:
    _defaults:
        autowire: true
        autoconfigure: true

    App\:
        resource: '../src/'

    LumoAuth\LumoAuth:
        arguments:
            $apiKey: '%env(default::LUMOAUTH_API_KEY)%'
            $baseUrl: '%env(LUMOAUTH_URL)%'
            $orgId: '%env(LUMOAUTH_ORG_ID)%'

    LumoAuth\Symfony\Security\LumoAuthAccessTokenHandler:
        arguments:
            $lumo: '@LumoAuth\LumoAuth'
            $identifierClaim: 'sub'
```

Keep the existing `_defaults` and `App\` entries of the project; add only the two `LumoAuth\`
definitions. `LumoAuth\LumoAuth` can now be autowired into any service or controller.
`%env(default::LUMOAUTH_API_KEY)%` gives `null` when the variable is not set.

### 4. Add the user class and the user provider

The token handler returns a user badge. The firewall's user provider turns the badge into a user.

```php
<?php
// src/Security/LumoAuthUser.php

namespace App\Security;

use Symfony\Component\Security\Core\User\UserInterface;

final class LumoAuthUser implements UserInterface
{
    /** @param array<string, mixed> $claims the userinfo claims */
    public function __construct(private readonly string $sub, private readonly array $claims = [])
    {
    }

    /** The LumoAuth user ID (the `sub` claim). */
    public function getUserIdentifier(): string
    {
        return $this->sub;
    }

    public function getRoles(): array
    {
        return ['ROLE_USER'];
    }

    public function eraseCredentials(): void
    {
    }

    public function getEmail(): ?string
    {
        return is_string($this->claims['email'] ?? null) ? $this->claims['email'] : null;
    }

    public function getName(): ?string
    {
        return is_string($this->claims['name'] ?? null) ? $this->claims['name'] : null;
    }
}
```

```php
<?php
// src/Security/LumoAuthUserProvider.php

namespace App\Security;

use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/** @implements UserProviderInterface<LumoAuthUser> */
final class LumoAuthUserProvider implements UserProviderInterface
{
    /**
     * The access_token authenticator passes the badge attributes as the second
     * argument: the userinfo claims from LumoAuthAccessTokenHandler.
     *
     * @param array<string, mixed> $attributes
     */
    public function loadUserByIdentifier(string $identifier, array $attributes = []): UserInterface
    {
        return new LumoAuthUser($identifier, $attributes);
    }

    public function refreshUser(UserInterface $user): UserInterface
    {
        if (!$user instanceof LumoAuthUser) {
            throw new UnsupportedUserException(sprintf('Unsupported user class "%s".', $user::class));
        }

        return $user;
    }

    public function supportsClass(string $class): bool
    {
        return $class === LumoAuthUser::class;
    }
}
```

To load the app's own `User` entity instead, read
[references/configuration.md](references/configuration.md).

### 5. Accept bearer tokens on the API firewall

```yaml
# config/packages/security.yaml
security:
    providers:
        lumoauth:
            id: App\Security\LumoAuthUserProvider

    firewalls:
        api:
            pattern: ^/api
            stateless: true
            provider: lumoauth
            access_token:
                token_handler: LumoAuth\Symfony\Security\LumoAuthAccessTokenHandler

    access_control:
        - { path: ^/api, roles: IS_AUTHENTICATED_FULLY }
```

Merge this into the existing file. Place the `api` firewall before a catch-all `main` firewall.

What `LumoAuthAccessTokenHandler` does on each request:

1. It calls the LumoAuth userinfo endpoint (`GET /orgs/{orgId}/api/v1/oauth/userinfo`) with the
   bearer token from the request. The API key is not sent on this call.
2. It returns `new UserBadge($identifier, null, $claims)`. The identifier is the `sub` claim (or
   the claim that `$identifierClaim` names). The badge attributes are all userinfo claims:
   `sub`, plus `name`, `email`, `email_verified` and others when the token has the matching scopes.
3. The badge has no user loader, so the firewall's provider is called with the identifier and the
   attributes.
4. It throws `BadCredentialsException`, and Symfony answers 401, when LumoAuth refuses the token,
   when LumoAuth cannot be reached, or when the identifier claim is missing.

Userinfo confirms that LumoAuth issued the token to a user of this organization, that it has the
`openid` scope and that it is not expired or revoked. It does not check for which application or
API the token was issued, and client credentials tokens do not pass. When the API needs an
audience check or accepts machine-to-machine tokens, use `lumoauth-api-protection`.

### 6. Check permissions

The client uses the organization API key. A check with that key and no subject is about the user
who created the key. Pass the signed-in user's LumoAuth user ID as `userId:`. The key needs the
`authz:check` scope.

In a controller:

```php
<?php
// src/Controller/DocumentController.php

namespace App\Controller;

use LumoAuth\LumoAuth;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

final class DocumentController extends AbstractController
{
    public function __construct(private readonly LumoAuth $lumo)
    {
    }

    #[Route('/api/documents/{id}', name: 'api_document_show', methods: ['GET'])]
    public function show(string $id): JsonResponse
    {
        $sub = $this->getUser()->getUserIdentifier();
        if (!$this->lumo->permissions->check('document.view', userId: $sub)) {
            throw $this->createAccessDeniedException();
        }

        return $this->json(['id' => $id]);
    }

    #[Route('/api/documents/{id}', name: 'api_document_update', methods: ['PUT'])]
    #[IsGranted('lumoauth:document.edit')]
    public function update(string $id): JsonResponse
    {
        return $this->json(['id' => $id, 'updated' => true]);
    }
}
```

The `lumoauth:` attribute needs this voter. The package has no voter; this one is app code.

```php
<?php
// src/Security/LumoAuthPermissionVoter.php

namespace App\Security;

use LumoAuth\Error\LumoAuthNotFoundError;
use LumoAuth\LumoAuth;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * Votes on attributes of the form "lumoauth:<permission>", for example
 * "lumoauth:document.edit". The decision comes from LumoAuth.
 *
 * @extends Voter<string, mixed>
 */
final class LumoAuthPermissionVoter extends Voter
{
    private const PREFIX = 'lumoauth:';

    public function __construct(private readonly LumoAuth $lumo)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return str_starts_with($attribute, self::PREFIX);
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token): bool
    {
        $user = $token->getUser();
        if (!$user instanceof LumoAuthUser) {
            return false;
        }

        try {
            return $this->lumo->permissions->check(
                substr($attribute, strlen(self::PREFIX)),
                userId: $user->getUserIdentifier(),
            );
        } catch (LumoAuthNotFoundError) {
            return false; // LumoAuth does not know this user ID
        }
    }
}
```

`$this->denyAccessUnlessGranted('lumoauth:document.edit')` and `is_granted('lumoauth:document.edit')`
in Twig use the same voter. Each vote sends one request to LumoAuth. Other SDK exceptions are not
caught: a wrong API key or a key without `authz:check` gives a 500, which shows the
misconfiguration instead of hiding it as a denial.

For roles and permission design, use `lumoauth-rbac`.

### 7. Sign users in to a web app (optional)

The package has no login controller, authenticator or session handling for browser sign-in. The
supported way is the SDK's `auth` helpers (`authorizationUrl()`, `exchangeCode()`, `userinfo()`)
inside a custom Symfony authenticator. Read
[references/web-sign-in.md](references/web-sign-in.md) for the complete controller,
authenticator, firewall and logout code.

## Verify

```bash
php bin/console lint:container
php bin/console debug:container 'LumoAuth\LumoAuth'
php bin/console debug:firewall api
```

The first command must pass. The second shows the service with its three arguments. Then call
the API:

```bash
curl -i https://app.example.com/api/documents/1
curl -i https://app.example.com/api/documents/1 -H "Authorization: Bearer $ACCESS_TOKEN"
```

The first request gets 401. The second gets 200 when `ACCESS_TOKEN` is a LumoAuth access token
with the `openid` scope and its user holds `document.view`, and 403 when the user does not.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `Call to undefined method "...ContainerConfigurator::service()"` during `cache:clear` | `LumoAuthBundle` is enabled in `config/bundles.php` | Remove the line; step 3 registers the services |
| `There is no extension able to load the configuration for "lumoauth"` | A `config/packages/lumoauth.yaml` file exists, but the bundle is not enabled | Delete the file; set the values in `.env` and `config/services.yaml` |
| `Http\Discovery\Exception\NotFoundException` when the client is created | No PSR-18 client or PSR-17 factory is installed | `composer require symfony/http-client nyholm/psr7` |
| Every API request gets 401 with a valid token | The token lacks the `openid` scope, is DPoP-bound, or `LUMOAUTH_URL` / `LUMOAUTH_ORG_ID` are not set or name another region or organization. The handler turns every SDK error into 401. | Request `openid`; check both variables |
| 500 with `LumoAuthPermissionDeniedError` (`INSUFFICIENT_PERMISSIONS`) on a check | The API key lacks the `authz:check` scope | Add the scope to the key in the portal |
| 500 with `LumoAuthAuthenticationError` on a check | `LUMOAUTH_API_KEY` is missing or wrong | Set it in `.env.local` or the secrets vault |
| A check gives every user the same answer | No `userId:` was passed, so the check is about the creator of the API key | Pass `userId: $user->getUserIdentifier()` |
| `LumoAuthNotFoundError` (`SUBJECT_NOT_FOUND`), or the voter always denies | The user identifier is not a LumoAuth user ID, for example after `$identifierClaim: 'email'` | Keep `sub` as the identifier, or check with the user's own token (see the configuration reference) |
| The API firewall never runs | A firewall with a wider pattern is listed first | Move `api` above `main` |

## Related skills

- `lumoauth-php` — the core SDK: every namespace, error class and the transport.
- `lumoauth-api-protection` — local JWT validation with issuer and audience checks, machine-to-machine tokens.
- `lumoauth-rbac` — roles, permissions and groups that the checks read.
- `lumoauth-oauth-oidc` — scopes, client types and the protocol behind web sign-in.
- `lumoauth-rebac`, `lumoauth-abac` — relationship and attribute checks (`$lumo->zanzibar`, `$lumo->abac`).

## References

- [references/web-sign-in.md](references/web-sign-in.md) — read it when browser users must sign
  in through LumoAuth and get a Symfony session: login controller, custom authenticator,
  firewall, logout at LumoAuth.
- [references/configuration.md](references/configuration.md) — read it for the service
  arguments, a custom HTTP client, the identifier claim, the app's own `User` entity, checks with
  the user's token, and the configuration tree of `LumoAuthBundle`.
- https://docs.lumoauth.dev/developer/sdks
- https://docs.lumoauth.dev/user-guide/applications/api-keys
- https://docs.lumoauth.dev/oauth/userinfo
