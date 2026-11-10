# Admin API errors, rate limits and retries

Open this file when a response is 4xx or 429 and the table in `SKILL.md` does not explain
it, or when you write the error handling of a client.

## The error envelope

Every Admin API error has this shape:

```json
{
  "error": "forbidden",
  "message": "Insufficient scope: this API key is missing a required scope",
  "status": 403,
  "details": {
    "required_scopes": ["admin:users:read"],
    "granted_scopes": ["admin:webhooks:read"]
  }
}
```

| Field | Content |
|---|---|
| `error` | Machine-readable code. Branch on this and on the HTTP status |
| `message` | Text for a person. Do not parse it |
| `status` | The HTTP status again |
| `details` | Optional object with structured context |

Other parts of the platform use other shapes. Match the parser to the endpoint family:

| Family | Shape |
|---|---|
| Admin API, validation errors | `{ "error", "message", "status", "details" }` |
| OAuth and OIDC endpoints, AAuth, JIT, dynamic client registration | `{ "error", "error_description" }` |
| Some agent and MCP responses | `{ "error" }` |
| SCIM (`/scim2.0/...`) | `{ "schemas": [...], "status": "401", "detail": "..." }` with `Content-Type: application/scim+json` |

A client that must handle more than one family reads `error` for the code, then
`error_description`, `message` or `detail` for the text.

## Status and code

| Status | `error` | Retry | Meaning |
|---|---|---|---|
| 400 | `invalid_request` | no | Malformed JSON, a missing field (`details.missing_fields`), a refused settings key (`details.rejected_keys`), or two credentials on one request |
| 400 | (plain-text body) | no | The path percent-encodes a letter, a digit, `-`, `.`, `_` or `/`. Other escapes, such as `%40`, are accepted |
| 401 | `invalid_api_key` | no | API key missing, malformed, expired, revoked, for another organization, or its creator is no longer active |
| 401 | `invalid_token` | after a new token | Access token missing, expired, of the wrong type (an ID token), or DPoP-bound and sent without a valid proof |
| 401 | `unauthorized` | no | No credential |
| 401 | `insufficient_user_authentication` | after a fresh sign-in | The action needs a recent authentication of the user |
| 403 | `forbidden` | no | See the next table |
| 403 | `feature_not_in_plan`, `plan_limit_reached` | no | The body names the `feature` or `limit`. Availability depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix) |
| 404 | `not_found` | no | Unknown resource, or wrong organization slug |
| 409 | `conflict` | no | Duplicate email, slug or name |
| 422 | `validation_error` | no | `details` maps each field to a message |
| 429 | `rate_limited` | yes | The per-credential limit of the Admin API |
| 429 | `rate_limit_exceeded` | yes | Another limiter |
| 500 | `server_error` | reads only | Unexpected failure |
| 503 | `temporarily_unavailable` | reads only | Temporary failure |

A 401 carries a `WWW-Authenticate` header that names the expected scheme (`ApiKey` or
`Bearer`).

## The causes of 403 `forbidden`

| Cause | `message` starts with | `details` |
|---|---|---|
| The credential lacks the resource scope | `Insufficient scope: this API key is missing a required scope` (or `... this access token ...`) | `required_scopes`, `granted_scopes` |
| A key with read scopes only sends a write | `Access denied: this API key has no admin write scope for this operation` | none |
| A Bearer token has no admin scope | `Access denied: this access token was not granted an admin scope` | none |
| The user, or the key's creator, lacks the endpoint's permission | `Access denied: missing required permission` or `Access denied: the API key owner does not hold the required permission` | `required_permissions` (any one of them is enough) |
| The target user holds permissions that the caller lacks (password, email, activation, block, delete, authenticators, temporary access code) | `You cannot perform this action on an account that holds privileges you do not have.` | none |
| The key's creator is deactivated, blocked or deleted | `Access denied: the API key owner is no longer active` | none |
| A Bearer token is sent to a route outside the API | `Bearer access tokens are not accepted on this endpoint; it requires a browser session.` | none |
| An API key is sent to a browser page | `API keys are not accepted on this endpoint; it requires a browser session.` | none |
| A browser session call without the CSRF header | `CSRF protection: ...` | none |

What to tell the user:

- `required_scopes`: "Create an API key that also has the scope X" (or request the scope
  in the sign-in for a token). Scopes of an existing key can be changed on the key's page
  in the portal.
- `required_permissions`: "The admin who created this key needs the permission X, or an
  admin who holds it must create the key."

Do not work around a 403 with a broader key than the job needs.

## Rate limits

- The Admin API counts requests per credential: per API key, per access token user and
  client, or per session user. The same counter covers the authorization decision
  endpoints and the `/me` endpoints.
- A successful response has no rate-limit headers. Do not look for `X-RateLimit-*`.
- When the budget is spent, the request is refused before any other check runs:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{"error": "rate_limited", "message": "Too many requests for this credential", "status": 429}
```

- `Retry-After` is the number of seconds to wait.
- An organization cannot change the limits. Design the job to stay under them: low
  concurrency, `limit=100` on lists to reduce the number of requests, and a separate API
  key for each independent job.
- Sign-in, token and SCIM endpoints have their own limits; they do not concern an Admin
  API job.

## Retry rules

| Situation | Reads (`GET`) | Writes (`POST`, `PUT`, `PATCH`, `DELETE`) |
|---|---|---|
| 429 | Wait `Retry-After` plus a random part, retry | The same: the request did not run |
| Network error, timeout | Retry with exponential backoff and a cap | Do not repeat blindly. Read the resource to see whether the write happened, then decide |
| 500, 503 | Retry with exponential backoff | The same caution as for a network error |
| 400, 401, 403, 404, 409, 422 | Never | Never |

Limit the number of attempts (for example five) and fail the job with the last error.

The API has no idempotency key header. A repeated `POST` creates a second resource, or
returns 409 when a unique field (email, slug) collides. Build repeat-safe jobs from these
parts:

1. Look up by a natural key first: user by email (`GET /admin/users/{email}`), role,
   group or permission by slug.
2. Create on 404, update on 200.
3. Treat 409 on create as "exists" and continue with a read.
4. `PUT` endpoints that replace a list (`/users/{userId}/roles`, `/roles/{roleId}/permissions`)
   are repeat-safe by nature: send the full desired list.

## Example: classify an error for the caller

```ts
import { LumoAuthApiError } from "./lumoauth-admin.ts";

export function explain(err: unknown): string {
  if (!(err instanceof LumoAuthApiError)) {
    return "Network or unexpected error. A read can be retried; check a write before repeating it.";
  }
  const details = err.details ?? {};
  if (err.status === 401) {
    return "The API key or token was not accepted. Check the key, the organization slug and the region.";
  }
  if (err.status === 403 && Array.isArray(details.required_scopes)) {
    return `The credential lacks the scope(s): ${details.required_scopes.join(", ")}.`;
  }
  if (err.status === 403 && Array.isArray(details.required_permissions)) {
    return `The key's creator or the token's user needs one of: ${details.required_permissions.join(", ")}.`;
  }
  if (err.status === 403) return `Not allowed: ${err.message}`;
  if (err.status === 404) return "Not found. Check the ID and the organization slug.";
  if (err.status === 409) return "The resource exists. Read or update it.";
  if (err.status === 429) return "Rate limited after retries. Lower the concurrency.";
  if (err.status === 400 || err.status === 422) return `Invalid request: ${err.message} ${JSON.stringify(details)}`;
  return `Server error ${err.status}: ${err.message}`;
}
```

`lumoauth-admin.ts` is the wrapper in `http-clients.md`.
