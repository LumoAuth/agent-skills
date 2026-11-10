# Symfony configuration reference for LumoAuth

## Contents

- [Service arguments](#service-arguments)
- [HTTP client and timeouts](#http-client-and-timeouts)
- [The identifier claim](#the-identifier-claim)
- [Load the app's own User entity](#load-the-apps-own-user-entity)
- [Check with the caller's own token](#check-with-the-callers-own-token)
- [The `LumoAuthBundle` class and its configuration tree](#the-lumoauthbundle-class-and-its-configuration-tree)

## Service arguments

The two services from `SKILL.md` step 3, with every argument that their constructors take.

`LumoAuth\LumoAuth`:

| Argument | Type | Value in `SKILL.md` | Meaning |
|---|---|---|---|
| `$apiKey` | `?string` | `%env(default::LUMOAUTH_API_KEY)%` | Organization API key (`lmk_...`), sent as `X-API-Key` |
| `$baseUrl` | `?string` | `%env(LUMOAUTH_URL)%` | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| `$orgId` | `?string` | `%env(LUMOAUTH_ORG_ID)%` | Organization slug, for example `acme-corp` |
| `$tokenProvider` | `?callable` | not set | A callable that returns a bearer token; it wins over the API key. Not useful on the shared service; see "Check with the caller's own token". |
| `$httpClient` | `?Psr\Http\Client\ClientInterface` | autowired when the container has one, else discovered | PSR-18 client |
| `$requestFactory`, `$streamFactory` | PSR-17 factories | autowired when the container has them, else discovered | |

When an argument is `null`, the SDK reads `LUMOAUTH_API_KEY`, `LUMOAUTH_URL` and
`LUMOAUTH_ORG_ID` itself, from `getenv()`, then `$_ENV`, then `$_SERVER`. A value from the Symfony
secrets vault is not visible there, so pass it as a service argument as shown.

`LumoAuth\Symfony\Security\LumoAuthAccessTokenHandler`:

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `$lumo` | `LumoAuth\LumoAuth` | required | The client that calls userinfo |
| `$identifierClaim` | `string` | `sub` | The userinfo claim that becomes the user identifier |

## HTTP client and timeouts

With `symfony/http-client` installed, FrameworkBundle registers the service `psr18.http_client`
and aliases `Psr\Http\Client\ClientInterface` to it. Autowiring then passes it to
`LumoAuth\LumoAuth` as `$httpClient`. To name it explicitly:

```yaml
# config/services.yaml
services:
    LumoAuth\LumoAuth:
        arguments:
            $apiKey: '%env(default::LUMOAUTH_API_KEY)%'
            $baseUrl: '%env(LUMOAUTH_URL)%'
            $orgId: '%env(LUMOAUTH_ORG_ID)%'
            $httpClient: '@psr18.http_client'
```

Set a timeout, because every API request waits for the userinfo call:

```yaml
# config/packages/framework.yaml
framework:
    http_client:
        default_options:
            timeout: 5
            max_duration: 10
```

## The identifier claim

`$identifierClaim: 'sub'` makes the Symfony user identifier the LumoAuth user ID. Keep it:
`permissions->check(..., userId: ...)` needs that ID.

When the claim is changed (for example to `email`, which needs the `email` scope on the token):

- The handler throws `BadCredentialsException` (401) for a token whose userinfo has no such claim.
- The user identifier is no longer a LumoAuth user ID. Read `sub` from the badge attributes in
  the user provider and keep it on the user object, or check with the caller's own token.

## Load the app's own User entity

Use this when the API must work with the app's `User` entity instead of `LumoAuthUser`. Store the
LumoAuth user ID on the entity, for example in a unique `lumoauthSub` property, and let the
Doctrine provider load by it:

```yaml
# config/packages/security.yaml
security:
    providers:
        app_users:
            entity:
                class: App\Entity\User
                property: lumoauthSub

    firewalls:
        api:
            pattern: ^/api
            stateless: true
            provider: app_users
            access_token:
                token_handler: LumoAuth\Symfony\Security\LumoAuthAccessTokenHandler
```

- A token whose `sub` has no matching entity gets 401.
- `getUserIdentifier()` of the entity must not be used as `userId:` unless it returns
  `lumoauthSub`. Pass `$user->getLumoauthSub()` in controllers, and change the voter from
  `SKILL.md` to read it the same way.
- Fill `lumoauthSub` when the user first signs in through LumoAuth (see `web-sign-in.md` in this
  skill) or when the account is provisioned.

## Check with the caller's own token

A check with the user's own access token needs no API key and no `authz:check` scope, and ABAC
checks require it (they do not accept the organization API key; the token needs `abac:read`).
Build a second client for the request. `baseUrl` and `orgId` are public read-only properties of
the shared client:

```php
<?php
// src/Security/CallerLumoAuth.php

namespace App\Security;

use LumoAuth\LumoAuth;
use Symfony\Component\HttpFoundation\Exception\BadRequestException;
use Symfony\Component\HttpFoundation\RequestStack;

final class CallerLumoAuth
{
    public function __construct(private readonly LumoAuth $lumo, private readonly RequestStack $requests)
    {
    }

    /** A client that calls LumoAuth with the bearer token of the current request. */
    public function client(): LumoAuth
    {
        $header = (string) $this->requests->getCurrentRequest()?->headers->get('Authorization');
        if (!str_starts_with($header, 'Bearer ') || strlen($header) <= 7) {
            throw new BadRequestException('No bearer token on this request.');
        }
        $token = substr($header, 7);

        return new LumoAuth(
            baseUrl: $this->lumo->baseUrl,
            orgId: $this->lumo->orgId,
            tokenProvider: static fn (): string => $token,
        );
    }
}
```

```php
$allowed = $callerLumoAuth->client()->permissions->check('document.edit'); // about the token's user
```

The class refuses to build a client without a token. That matters: when a token provider returns
`null` and the SDK finds an API key (argument or environment), it sends the API key, and the
check is then about the key's creator. Use the class only on routes behind the `api` firewall,
where the token was already accepted.

## The `LumoAuthBundle` class and its configuration tree

`LumoAuth\Symfony\LumoAuthBundle` declares the configuration below and is meant to register the
same two services as `SKILL.md` step 3, plus the alias `lumoauth` for the client.

| Key | Default | Meaning |
|---|---|---|
| `url` | `%env(default:lumoauth.default_url:LUMOAUTH_URL)%`: `LUMOAUTH_URL`, else `https://app.lumoauth.dev` | Base URL of the region |
| `org_id` | `%env(default::LUMOAUTH_ORG_ID)%` | Organization slug |
| `api_key` | `%env(default::LUMOAUTH_API_KEY)%` | Organization API key, sent as `X-API-Key` |
| `http_client` | `null` | Service ID of a PSR-18 client; discovered when `null` |
| `user_identifier_claim` | `sub` | Passed to the token handler as `$identifierClaim` |

Each key maps to a service argument: `url` → `$baseUrl`, `org_id` → `$orgId`, `api_key` →
`$apiKey`, `http_client` → `$httpClient`, `user_identifier_claim` → `$identifierClaim`.

Two facts about the class in the published versions up to and including 1.4.0:

1. **It cannot be enabled.** Its `loadExtension()` method calls `service()` on Symfony's
   `ContainerConfigurator`, which has no such method. With the bundle in `config/bundles.php`,
   every container build fails with
   `Call to undefined method "Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator::service()"`.
   Keep the bundle out of `config/bundles.php` and use the service definitions from `SKILL.md`.
2. **Its configuration root key is `lumo_auth`.** The class sets no extension alias, so Symfony
   derives the alias from the class name `LumoAuthBundle`. A file with the root key `lumoauth:`
   is not accepted.

Before you enable the bundle with a later version, run `php bin/console lint:container` after
adding it. When the command passes, the bundle registers `LumoAuth\LumoAuth` and
`LumoAuthAccessTokenHandler` itself; `php bin/console debug:config` followed by the bundle's
alias shows the root key and the resolved values. The definitions in `config/services.yaml` can
stay: definitions of the application replace those of a bundle.
