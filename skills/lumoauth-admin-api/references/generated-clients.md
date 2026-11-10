# Generated API clients, `lumo.api` and `client.api`

Open this file before you call the Admin API through a generated client instead of plain
HTTP.

## What exists

LumoAuth has two kinds of client:

| | SDKs | Generated API clients |
|---|---|---|
| What | Hand-written, framework-aware packages | One method per API operation, generated from the OpenAPI document |
| Covers | Sign-in, sessions, token checks, permission checks, agents | The whole REST API, including every Admin API endpoint |
| Use for | Building an app | Admin automation, back-office scripts, a language without an SDK |

Rule: start with the SDK of the language when one exists, and go to the generated client
for an endpoint that the SDK does not wrap.

Packages of the generated clients:

| Language | Package | Registry |
|---|---|---|
| TypeScript | `@lumoauth/api-client` | npm |
| Python | `lumoauth-api-client` (import name `lumoauth_api_client`) | PyPI |
| Go | `github.com/lumoauth/api-clients/go` (package `lumoauthclient`) | Go module proxy |
| Java | `io.lumoauth:lumoauth-api-client` | Maven Central |
| C# | `LumoAuth.ApiClient` | NuGet |
| Ruby | `lumoauth_api_client` | RubyGems |
| Rust | `lumoauth-api-client` | crates.io |
| Swift | `LumoAuthAPIClient` | Swift Package Manager |
| PHP | `lumoauth/api-client` | Packagist |

Before you add one to a project, check that the package resolves in its registry (for
example `npm view @lumoauth/api-client version`). If it does not, use the HTTP wrapper in
`http-clients.md`.

## Know this limit first

A generated client can only send what the OpenAPI document declares. In the current
document, most Admin API operations declare the path parameters only: `listUsers` takes
`orgId` and no `page` or `limit`; `createUser` takes `orgId` and no request body. A few
operations (for example creating an agent) declare their body.

Consequences:

- Reads of single resources and first pages work as generated.
- For pagination, filters and most write bodies, pass the values through the client's
  per-request options where the language allows it (TypeScript: see below), or call the
  endpoint with the HTTP wrapper.
- Check the method's parameter type in the installed package before you write the call.
  Do not assume a parameter from the REST documentation.

For a provisioning script, the HTTP wrapper is usually the shorter and safer path.

## Credentials

The clients know two schemes for the Admin API. Configure exactly one:

| Scheme | Sent as | Configure with |
|---|---|---|
| `ApiKeyAuth` | `X-API-Key: lmk_...` | the API key slot (`apiKey`, `api_key["ApiKeyAuth"]`, `ContextAPIKeys`) |
| `BearerAuth` | `Authorization: Bearer <token>` | the access token slot (`accessToken`, `access_token`, `ContextAccessToken`) |

A request that carries both is refused with HTTP 400. Never put an `lmk_` key in the
access token slot: that sends it as a Bearer token, and the API answers 401.

## TypeScript: `@lumoauth/api-client`

```bash
npm install @lumoauth/api-client
```

```ts
import { AdminUsersApi, Configuration } from "@lumoauth/api-client";

const configuration = new Configuration({
  basePath: process.env.LUMO_BASE_URL ?? "https://app.lumoauth.dev",
  apiKey: process.env.LUMO_API_KEY,
});
const users = new AdminUsersApi(configuration);
const orgId = process.env.LUMO_ORG ?? "";

// Each method takes one request object and returns an axios response.
const first = await users.listUsers({ orgId });
console.log(first.data);

// Values that the method does not declare go through the axios request options.
const second = await users.listUsers({ orgId }, { params: { page: 2, limit: 100 } });
console.log(second.data);

// Show the user this request before you send it: it creates a user.
const created = await users.createUser(
  { orgId },
  { data: { email: "jane@example.com", name: "Jane Example", emailVerified: true } },
);
console.log(created.status);
```

The client uses axios: a non-2xx status rejects the promise with an axios error whose
`response.status` and `response.data` hold the status and the error envelope. Read
`response.headers["retry-after"]` on a 429.

### `lumo.api` on `@lumoauth/backend`

When the project already has a `LumoAuthBackend` instance, `lumo.api` returns the generated
client configured with the same base URL and credential. The generated package is an
optional peer dependency, so install it next to the SDK:

```bash
npm install @lumoauth/backend @lumoauth/api-client
```

```ts
import { LumoAuthBackend } from "@lumoauth/backend";
import { AdminUsersApi, type Configuration } from "@lumoauth/api-client";

const lumo = new LumoAuthBackend({
  baseUrl: process.env.LUMOAUTH_URL ?? "https://app.lumoauth.dev",
  secretKey: process.env.LUMOAUTH_API_KEY ?? "",
  orgId: process.env.LUMOAUTH_ORG_ID ?? "",
});

const users = new AdminUsersApi(lumo.api.configuration as Configuration);
const page = await users.listUsers({ orgId: process.env.LUMOAUTH_ORG_ID ?? "" });
console.log(page.data);
```

- `lumo.api.configuration` is a `Configuration` of the generated client (typed `unknown`
  in the SDK, hence the cast). `lumo.api.module` is the loaded `@lumoauth/api-client`
  module. `lumo.api.create(ApiClass)` returns an instance of a generated API class; it
  works in JavaScript, but under TypeScript `strict` the generated classes do not match
  its parameter type, so construct the class with `lumo.api.configuration` as shown.
- A `secretKey` that starts with `lmk_` is sent as `X-API-Key`; any other value is sent as
  a Bearer token.
- Without the generated package, the first access to `lumo.api` throws a configuration
  error that names the package to install.
- `@lumoauth/backend` is server-only. For the rest of that SDK use `lumoauth-node-backend`.

## Python: `lumoauth-api-client`

```bash
pip install lumoauth-api-client
```

```python
import os

import lumoauth_api_client

configuration = lumoauth_api_client.Configuration(
    host=os.environ.get("LUMO_BASE_URL", "https://app.lumoauth.dev"),
)
configuration.api_key["ApiKeyAuth"] = os.environ["LUMO_API_KEY"]

with lumoauth_api_client.ApiClient(configuration) as api_client:
    users = lumoauth_api_client.AdminUsersApi(api_client)
    first_page = users.list_users(os.environ["LUMO_ORG"])
    print(first_page)
```

A failed call raises `lumoauth_api_client.rest.ApiException` with `status` and `body`.

### `client.api` on the `lumoauth` package

```bash
pip install "lumoauth[api]"
```

```python
import lumoauth_api_client
from lumoauth import LumoAuth

# Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID and LUMOAUTH_API_KEY from the environment.
client = LumoAuth()

users = lumoauth_api_client.AdminUsersApi(client.api)
first_page = users.list_users(client.org_id)
print(first_page)
```

`client.api` is a `lumoauth_api_client.ApiClient` with the SDK's base URL and API key (sent
as `X-API-Key`). Without the generated package it raises a configuration error that names
the package. For the rest of the Python SDK use `lumoauth-python`.

The Python methods take only the declared parameters. For pagination and for bodies that
the method does not declare, use `lumoauth_admin.py` from `http-clients.md`.

## Go: `github.com/lumoauth/api-clients/go`

```bash
go get github.com/lumoauth/api-clients/go
```

```go
package main

import (
	"context"
	"fmt"
	"os"

	lumoauthclient "github.com/lumoauth/api-clients/go"
)

func main() {
	configuration := lumoauthclient.NewConfiguration()
	// US is the default server. For the EU region:
	// configuration.Servers = lumoauthclient.ServerConfigurations{{URL: "https://eu.app.lumoauth.dev"}}
	client := lumoauthclient.NewAPIClient(configuration)

	// The API key goes into the ApiKeyAuth scheme, which is sent as X-API-Key.
	ctx := context.WithValue(context.Background(), lumoauthclient.ContextAPIKeys, map[string]lumoauthclient.APIKey{
		"ApiKeyAuth": {Key: os.Getenv("LUMO_API_KEY")},
	})

	users, httpResponse, err := client.AdminUsersAPI.ListUsers(ctx, os.Getenv("LUMO_ORG")).Execute()
	if err != nil {
		status := 0
		if httpResponse != nil {
			status = httpResponse.StatusCode
		}
		fmt.Fprintf(os.Stderr, "list users failed (HTTP %d): %v\n", status, err)
		os.Exit(1)
	}
	fmt.Printf("%d users on this page\n", len(users.GetData()))
}
```

Every operation has the form `client.<Area>API.<Operation>(ctx, pathParams...).Execute()`
and returns the model, the `*http.Response` and an error. For the Go SDK (token checks,
middleware) use `lumoauth-go`.

## The OpenAPI document

The clients are generated from the OpenAPI 3 document of the API. To generate a client for
another language or to import the API into a tool, see https://docs.lumoauth.dev/admin/spec.
