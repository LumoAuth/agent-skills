# Inbound SCIM 2.0 API

Reference for a client that provisions users and groups into a LumoAuth organization: an IdP connector or the user's own script.

## Contents

- [Base URL and media type](#base-url-and-media-type)
- [Credentials](#credentials)
- [Endpoints](#endpoints)
- [Users](#users)
- [Groups](#groups)
- [Filters](#filters)
- [Bulk](#bulk)
- [Search with POST](#search-with-post)
- [Me](#me)
- [Discovery](#discovery)
- [Errors](#errors)

## Base URL and media type

```text
https://app.lumoauth.dev/orgs/{orgId}/api/v1/scim2.0
```

`{orgId}` is the organization slug. Use `https://eu.app.lumoauth.dev` for the EU region. On a verified custom domain the `/orgs/{orgId}` prefix is dropped, for example `https://auth.example.com/api/v1/scim2.0`.

| Header | Value | When |
|---|---|---|
| `Content-Type` | `application/scim+json` | Required on `POST`, `PUT`, `PATCH` |
| `Accept` | `application/scim+json` | Recommended on every request |

## Credentials

Every endpoint except the discovery documents needs an `Authorization` header.

| Credential | Header | Acts as | Use for |
|---|---|---|---|
| SCIM provisioning token | `Authorization: Bearer <token>` | The organization's SCIM service principal | IdP connectors and provisioning scripts. The default. |
| OAuth 2.0 access token with the `scim` scope | `Authorization: Bearer <access_token>` | The token's subject, who must hold the `scim.manage` permission | An app or script that already signs users in through LumoAuth |
| HTTP Basic (`email:password`) | `Authorization: Basic <base64>` | That user, who must hold `scim.manage` | Quick manual tests only. Refused when the account has MFA. |

Provisioning token: generated at `/orgs/{orgId}/portal/integrations/scim`, shown once, stored as a hash. SCIM must also be enabled on that page (**Enable SCIM provisioning**).

OAuth access token: accepted only when all of these hold.

1. It is an access token. A JWT must carry the header `typ: at+jwt`.
2. Its `scope` includes `scim`, or `admin:scim:read` (read requests only) or `admin:scim:write` (any request).
3. When it carries a URL audience, that audience is the organization's issuer or a resource beneath it.
4. Its subject belongs to this organization, is active and holds `scim.manage`.

To get such a token, add `scim` to the OAuth client's allowed scopes and request it, for example `scope=openid scim`. A token with only `openid profile email` is not a SCIM credential, even for an admin.

Never accepted: an ID token, a logout token, a JIT permission token, an AI agent's token, and a delegated token with an `act` claim.

Authentication failures return `401` in the SCIM error format. The `detail` names the cause, for example `Authentication required`, `Access token lacks the scim (or admin:scim:write) scope required for SCIM writes` or `User does not have SCIM API access permission`.

## Endpoints

| Resource | Methods | Notes |
|---|---|---|
| `/Users` | `GET`, `POST` | List with filter, sort and pagination; create |
| `/Users/{id}` | `GET`, `PUT`, `PATCH`, `DELETE` | Read, replace, partial update, deprovision |
| `/Groups` | `GET`, `POST` | A group is an organization role |
| `/Groups/{id}` | `GET`, `PUT`, `PATCH`, `DELETE` | Read, replace, change members, delete |
| `/Me` | `GET`, `PUT`, `PATCH` | The caller's own user. User access tokens only. |
| `/Bulk` | `POST` | Up to 100 operations per request |
| `/.search`, `/Users/.search`, `/Groups/.search` | `POST` | Search with the query in the body |
| `/ServiceProviderConfig`, `/ResourceTypes`, `/ResourceTypes/{name}`, `/Schemas`, `/Schemas/{id}` | `GET` | Public discovery documents |

Every write is checked against the organization's provisioning policy (see `SKILL.md` step 3). A switched-off operation is refused before anything is read or written:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "403",
  "scimType": "mutability",
  "detail": "User creation is disabled by this organization's SCIM provisioning policy"
}
```

The `detail` starts with `User creation`, `User update`, `User deletion` or `Group management`.

## Users

### Attributes

| Attribute | Type | Mutability | LumoAuth field |
|---|---|---|---|
| `id` | string | read-only | User ID |
| `userName` | string | read-write | Email. Unique. |
| `externalId` | string | set once | Identifier in the IdP. It cannot be changed after it is set. |
| `name.givenName`, `name.familyName`, `name.formatted` | string | read-write | First name, last name, full name |
| `displayName` | string | read-write | Display name |
| `emails` | array | read-write | Email. LumoAuth stores one address per user and returns it with `type: "work"` and `primary: true`. |
| `phoneNumbers` | array | read-write | Phone. One number per user. |
| `active` | boolean | read-write | Account active status |
| `password` | string | write-only | Never returned |
| `meta` | object | read-only | `resourceType`, `created`, `lastModified`, `location`, `version` (ETag) |

`roles` and `permissions` are not writable on a user. Membership is managed through `/Groups`.

### List

`GET /Users` query parameters:

| Parameter | Description |
|---|---|
| `filter` | SCIM filter, for example `userName eq "alice@example.com"` |
| `startIndex` | 1-based index of the first result. Default 1. |
| `count` | Page size. Default 100, maximum 200. |
| `sortBy`, `sortOrder` | For example `userName`, and `ascending` or `descending` |
| `attributes`, `excludedAttributes` | Comma-separated attribute names to return or to leave out |

The response is a `urn:ietf:params:scim:api:messages:2.0:ListResponse` with `totalResults`, `startIndex`, `itemsPerPage` and `Resources`.

### Create

`POST /Users` with `schemas`, `userName` and the profile attributes. Returns `201`.

- `password` is optional. It must meet the organization's password policy and the breached-password check. Otherwise the call fails with `400 invalidValue` and nothing is created. Prefer not to send passwords.
- An explicit `active` wins. Without it, **Auto-activate new users** decides.
- A duplicate `userName` returns `409 uniqueness`. So does a `userName` or email that matches a soft-deleted account that is still retained.

### Replace and PATCH

`PUT /Users/{id}` replaces the resource. Include all required attributes. `PATCH /Users/{id}` supports the operations `add`, `replace` and `remove`:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {"op": "replace", "path": "active", "value": false},
    {"op": "replace", "path": "name.givenName", "value": "Alicia"}
  ]
}
```

Behaviour to rely on:

- Protected attributes (`email`, `name`, `active`, when the organization protects them) keep their local value. `PUT` applies every other field. `PATCH` drops the operations that target them. The request still succeeds. `POST` is never filtered.
- A value-path target such as `emails[type eq "work"].value` is evaluated against the stored value. When the stored value does not match, the operation is skipped. A malformed path returns `400 invalidValue`.
- A new password, or a change of the primary email, signs the user out everywhere and revokes the user's OAuth tokens.
- The password of an admin account is never changed through SCIM. A `PATCH` password operation on such an account returns `403 mutability`.
- A `PUT` or `PATCH` that would deactivate an admin account is refused with `403 mutability`.
- An ETag mismatch returns `412`.

### Delete

`DELETE /Users/{id}` does what the organization's **Deprovisioning action** says: soft delete (default), deactivate or hard delete. After a soft delete, a second `DELETE /Users/{id}?isSoftDeleted=true` erases the account for good. A `DELETE` of an admin account is refused with `403 mutability`.

## Groups

A SCIM group is an organization role. `displayName` is the role name, and a slug is derived from it. `members` are the users who hold the role.

| Attribute | Required | Description |
|---|---|---|
| `id` | | Read-only |
| `displayName` | Yes | Role name |
| `externalId` | No | Identifier in the IdP |
| `members` | No | Array of `{"value": "<user id>"}` |

Create:

```bash
curl -sS -X POST "$BASE/Groups" \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "Marketing",
    "members": [{"value": "123"}, {"value": "456"}]
  }'
```

Change members with `PATCH`:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {"op": "add", "path": "members", "value": [{"value": "789"}]},
    {"op": "remove", "path": "members[value eq \"123\"]"}
  ]
}
```

`DELETE /Groups/{id}` removes every member from the role and then deletes the role. There is no soft delete for groups.

Protected roles: `PUT`, `PATCH` and `DELETE` are refused with `403 mutability` when the role is a system role or holds any of LumoAuth's own permissions. That includes view-only permissions, because they open the organization portal. A group can therefore carry the application's own permissions only. Creating a group whose name maps to a reserved slug such as `admin` returns `400 invalidValue`. Every group write returns `403` when **Allow group operations** is off.

## Filters

Operators: `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr`. Combine with `and`, `or`, `not` and parentheses.

```text
userName ew "@example.com" and active eq true
name.familyName sw "Sm" or name.familyName sw "Jo"
not (active eq false) and meta.lastModified gt "2026-06-01T00:00:00Z"
emails[type eq "work" and value ew "@example.com"]
```

| Resource | Filterable attributes |
|---|---|
| Users | `id`, `externalId`, `userName`, `name.givenName`, `name.familyName`, `name.middleName`, `name.formatted`, `displayName`, `nickName`, `profileUrl`, `title`, `userType`, `preferredLanguage`, `locale`, `timezone`, `active`, `meta.created`, `meta.lastModified`, `isSoftDeleted`, `emails`, `phoneNumbers` |
| Groups through `/Groups/.search` | `id`, `externalId`, `displayName`, `meta.created`, `meta.lastModified`, `isSoftDeleted` |

Value-path filters work on `emails` and `phoneNumbers`, as `emails[...]` or as a dotted sub-attribute such as `emails.value co "@example.com"`. The sub-attributes are `value`, `type` and `primary`. Nested value paths are not supported.

`GET /Groups?filter=...` is narrower. The whole filter must be exactly one of:

```text
displayName eq "Engineering"      (also co, sw)
externalId eq "okta-00g1"
id eq "10"
members[value eq "123"]
```

An unknown attribute, an unsupported operator or a malformed expression returns `400` with `scimType: invalidFilter`. A filter is never partly ignored.

URL-encode the filter in a query string. With `curl`, use `-G --data-urlencode 'filter=...'`.

## Bulk

`POST /Bulk` runs several operations in one request. Supported methods inside a bulk request: `POST`, `PUT`, `DELETE`. Operations run in order. A later operation can refer to a resource that an earlier one created, with `bulkId:<id>`.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "failOnErrors": 0,
  "Operations": [
    {
      "method": "POST",
      "path": "/Users",
      "bulkId": "user1",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": "alice@example.com",
        "name": {"givenName": "Alice", "familyName": "Smith"}
      }
    },
    {
      "method": "POST",
      "path": "/Groups",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "displayName": "New Team",
        "members": [{"value": "bulkId:user1"}]
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `Operations` | The operations to run |
| `failOnErrors` | Stop after this many errors. `0` runs everything. |
| `method`, `path`, `bulkId`, `data` | Per operation |

Limits from `/ServiceProviderConfig`: 100 operations and 1 MB per request. More returns `413 tooLarge`.

The response is a `BulkResponse` with one entry per operation: `method`, `bulkId`, `location`, `status` and `response`. The HTTP status of the bulk response stays `200` when single operations fail. Read the `status` of each entry. An operation that the provisioning policy forbids gets `"status": "403"`; the others still run.

## Search with POST

Use `.search` when a filter is too long for a query string.

```bash
curl -sS -X POST "$BASE/Users/.search" \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
    "filter": "name.familyName sw \"Sm\" and active eq true",
    "startIndex": 1,
    "count": 50,
    "sortBy": "userName",
    "sortOrder": "ascending",
    "attributes": ["userName", "name", "emails"]
  }'
```

`/.search` searches all resource types. `/Users/.search` and `/Groups/.search` search one.

## Me

`/Me` resolves to the authenticated user. Call it with an OAuth access token that carries the `scim` scope.

- The provisioning token gets `501`. It has no user. Use `/Users/{id}`.
- A change of `password` or `userName` returns `400` with `scimType: mutability`.
- `DELETE /Me` returns `501`.

## Discovery

These need no authentication.

| Endpoint | Returns |
|---|---|
| `GET /ServiceProviderConfig` | Supported features: PATCH, bulk (with limits), filter (maximum results), change password, sort, ETag |
| `GET /ResourceTypes`, `/ResourceTypes/{name}` | The resource types, for example `/ResourceTypes/User` |
| `GET /Schemas`, `/Schemas/{schemaUrn}` | Schema definitions |

Schemas:

| URN | Description |
|---|---|
| `urn:ietf:params:scim:schemas:core:2.0:User` | Core user |
| `urn:ietf:params:scim:schemas:core:2.0:Group` | Core group |
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` | Enterprise user extension |
| `urn:ietf:params:scim:schemas:extension:password:2.0:User` | Password lifecycle extension |

Message URNs: `urn:ietf:params:scim:api:messages:2.0:ListResponse`, `:PatchOp`, `:BulkRequest`, `:BulkResponse`, `:SearchRequest`, `:Error`.

`/ServiceProviderConfig` lists only the OAuth bearer token as authentication scheme. HTTP Basic is also accepted, with the limits above.

## Errors

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "scimType": "invalidFilter",
  "detail": "The filter expression is not valid."
}
```

| Status | `scimType` | Meaning |
|---|---|---|
| `400` | `invalidFilter` | Malformed filter, or an unsupported attribute or operator |
| `400` | `invalidValue` | Invalid attribute value, a password that fails the policy, a malformed PATCH path, or a group name that maps to a reserved role slug |
| `400` | `mutability` | Attempt to change a read-only attribute, or a password or `userName` change through `/Me` |
| `401` | | Missing or refused credential |
| `403` | `mutability` | Operation switched off by the policy, a protected role, or an admin account |
| `404` | | Resource not found |
| `409` | `uniqueness` | Unique constraint violation |
| `412` | | ETag mismatch |
| `413` | `tooLarge` | Bulk request over the limit |
| `429` | | Rate limit. Wait for `Retry-After`. |
| `501` | | `/Me` with the provisioning token, or `DELETE /Me` |

Every write is audited as `scim.<resource>.<operation>`, for example `scim.user.create`, `scim.user.patch`, `scim.group.delete`, `scim.mixed.bulk`. Reads are not audited.

Docs: https://docs.lumoauth.dev/scim, https://docs.lumoauth.dev/scim/users, https://docs.lumoauth.dev/scim/groups, https://docs.lumoauth.dev/scim/bulk, https://docs.lumoauth.dev/scim/discovery
