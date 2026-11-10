# HTTP wrappers for the Admin API

Two small clients without dependencies: TypeScript on `fetch` (Node.js 18 or later) and
Python on the standard library. Both were run against a local test server that returns
the Admin API envelope: pagination over several pages, one 429 with `Retry-After`, a 409
on a repeated create and a 401 for a wrong key.

Behaviour of both:

- Send the key in `X-API-Key`. Send nothing else as a credential.
- Build the URL as `{base}/orgs/{orgId}/api/v1/admin{path}`.
- `paginate()` requests `limit=100` and follows `meta.hasNextPage`.
- On 429, wait `Retry-After` seconds plus a small random delay, and retry any method.
- On a network error or a 5xx status, retry `GET` and `HEAD` only, with exponential
  backoff. A write is not repeated: it may have reached the server.
- Raise `LumoAuthApiError` with `status`, `code` (the `error` field), `message` and
  `details` for every other failure.

Both are server-side code. Do not bundle them into a browser or mobile app.

## TypeScript: `lumoauth-admin.ts`

```ts
// lumoauth-admin.ts: a small Admin API client on fetch (Node.js 18 or later).
// Server-side only. The API key must never reach a browser or a mobile app.

export class LumoAuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LumoAuthApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface AdminClientOptions {
  baseUrl: string; // https://app.lumoauth.dev or https://eu.app.lumoauth.dev
  orgId: string; // organization slug
  apiKey: string; // lmk_... from the environment
  maxRetries?: number;
}

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
}

type Query = Record<string, string | number | boolean | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAdminClient(options: AdminClientOptions) {
  const root = `${options.baseUrl.replace(/\/+$/, "")}/orgs/${encodeURIComponent(options.orgId)}/api/v1/admin`;
  const maxRetries = options.maxRetries ?? 4;

  async function request<T>(method: string, path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(root + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const idempotent = method === "GET" || method === "HEAD";

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            "X-API-Key": options.apiKey,
            Accept: "application/json",
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
      } catch (err) {
        // Network failure: retry reads only. A write may have reached the server.
        if (idempotent && attempt < maxRetries) {
          await sleep(2 ** attempt * 500 + Math.random() * 250);
          continue;
        }
        throw err;
      }

      if (response.ok) {
        const text = await response.text();
        return (text === "" ? undefined : JSON.parse(text)) as T;
      }

      // 429: the request was refused before it ran, so every method can be retried.
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000 + Math.random() * 250);
        continue;
      }
      // 5xx: retry reads only.
      if (response.status >= 500 && idempotent && attempt < maxRetries) {
        await sleep(2 ** attempt * 500 + Math.random() * 250);
        continue;
      }

      let body: { error?: unknown; message?: string; error_description?: string; details?: Record<string, unknown> } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // not JSON: keep the status only
      }
      throw new LumoAuthApiError(
        response.status,
        typeof body.error === "string" ? body.error : "error",
        body.message ?? body.error_description ?? `HTTP ${response.status}`,
        body.details,
      );
    }
  }

  /** Yields every item of a list endpoint, page by page. */
  async function* paginate<T>(path: string, query: Query = {}): AsyncGenerator<T> {
    for (let page = 1; ; page++) {
      const result = await request<Page<T>>("GET", path, { query: { ...query, page, limit: 100 } });
      yield* result.data;
      if (!result.meta.hasNextPage) return;
    }
  }

  return { request, paginate };
}
```

Usage (`example.ts`):

```ts
import { createAdminClient, LumoAuthApiError } from "./lumoauth-admin.ts";

const admin = createAdminClient({
  baseUrl: process.env.LUMO_BASE_URL ?? "https://app.lumoauth.dev",
  orgId: process.env.LUMO_ORG ?? "",
  apiKey: process.env.LUMO_API_KEY ?? "",
});

interface User {
  id: string;
  email: string;
}

// Read: every user, page by page (scope admin:users:read).
let count = 0;
for await (const user of admin.paginate<User>("/users", { sortBy: "createdAt", sortDir: "ASC" })) {
  count++;
  console.log(user.id, user.email);
}
console.log(`${count} users`);

// Write: create a role, and treat "already exists" as success (scope admin:roles:write).
try {
  const created = await admin.request<{ data: { id: string | number; slug: string } }>("POST", "/roles", {
    body: { name: "Finance", description: "Finance team", permissions: ["invoices.approve"] },
  });
  console.log("created role", created.data.slug);
} catch (err) {
  if (err instanceof LumoAuthApiError && err.status === 409) {
    console.log("role exists");
  } else if (err instanceof LumoAuthApiError && err.status === 403) {
    // details.required_scopes or details.required_permissions names what is missing
    console.error("forbidden:", err.message, JSON.stringify(err.details ?? {}));
    process.exitCode = 1;
  } else {
    throw err;
  }
}
```

Run it with `LUMO_BASE_URL`, `LUMO_ORG` and `LUMO_API_KEY` in the environment. Node.js
22.18 or later runs the `.ts` files directly (`node example.ts`); with an older version,
compile them with the project's TypeScript setup. The example uses top-level `await`, so
the project must use ES modules (`"type": "module"` in `package.json`).

## Python: `lumoauth_admin.py`

```python
"""A small Admin API client on the Python standard library.

Server-side only. Read the API key from the environment.
"""
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator, Optional


class LumoAuthApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Optional[dict] = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details or {}


class AdminClient:
    def __init__(self, base_url: str, org_id: str, api_key: str, max_retries: int = 4, timeout: float = 30) -> None:
        self._root = f"{base_url.rstrip('/')}/orgs/{urllib.parse.quote(org_id, safe='')}/api/v1/admin"
        self._api_key = api_key
        self._max_retries = max_retries
        self._timeout = timeout

    def request(self, method: str, path: str, query: Optional[dict] = None, body: Any = None) -> Any:
        url = self._root + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        headers = {"X-API-Key": self._api_key, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        idempotent = method in ("GET", "HEAD")

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    text = resp.read().decode("utf-8")
                    return json.loads(text) if text else None
            except urllib.error.HTTPError as err:
                status = err.code
                raw = err.read().decode("utf-8", errors="replace")
                # 429: the request was refused before it ran, so every method can be retried.
                if status == 429 and attempt < self._max_retries:
                    try:
                        delay = float(err.headers.get("Retry-After") or 1)
                    except ValueError:
                        delay = 1.0
                    time.sleep(delay + random.random() * 0.25)
                    attempt += 1
                    continue
                # 5xx: retry reads only.
                if status >= 500 and idempotent and attempt < self._max_retries:
                    time.sleep(2**attempt * 0.5 + random.random() * 0.25)
                    attempt += 1
                    continue
                try:
                    payload = json.loads(raw)
                except ValueError:
                    payload = {}
                code = payload.get("error") if isinstance(payload.get("error"), str) else "error"
                message = payload.get("message") or payload.get("error_description") or f"HTTP {status}"
                raise LumoAuthApiError(status, code, message, payload.get("details")) from None
            except urllib.error.URLError:
                # Network failure: retry reads only. A write may have reached the server.
                if idempotent and attempt < self._max_retries:
                    time.sleep(2**attempt * 0.5 + random.random() * 0.25)
                    attempt += 1
                    continue
                raise

    def paginate(self, path: str, query: Optional[dict] = None) -> Iterator[dict]:
        """Yield every item of a list endpoint, page by page."""
        page = 1
        while True:
            result = self.request("GET", path, {**(query or {}), "page": page, "limit": 100})
            yield from result["data"]
            if not result["meta"]["hasNextPage"]:
                return
            page += 1


if __name__ == "__main__":
    admin = AdminClient(
        base_url=os.environ.get("LUMO_BASE_URL", "https://app.lumoauth.dev"),
        org_id=os.environ["LUMO_ORG"],
        api_key=os.environ["LUMO_API_KEY"],
    )

    # Read: every user (scope admin:users:read).
    count = 0
    for user in admin.paginate("/users", {"sortBy": "createdAt", "sortDir": "ASC"}):
        count += 1
    print(f"{count} users")

    # Write: create a role; "already exists" is success (scope admin:roles:write).
    try:
        created = admin.request(
            "POST",
            "/roles",
            body={"name": "Finance", "description": "Finance team", "permissions": ["invoices.approve"]},
        )
        print("created role", created["data"]["slug"])
    except LumoAuthApiError as err:
        if err.status == 409:
            print("role exists")
        else:
            raise
```

Run it with `python3 lumoauth_admin.py` and the same three environment variables.

## Adapting the wrappers

| Need | Change |
|---|---|
| OAuth access token instead of an API key | Replace the `X-API-Key` header with `Authorization: Bearer <token>`. Never send both |
| A route outside `/admin` (for example `/abac/policies`) | Build the root without the `/admin` suffix for that call |
| Filters | Pass them in `query`. Filter names are endpoint-specific; read the endpoint's page first |
| Logging | Log the method, the path, the status and `code`. Never log the key or a response that holds a secret |
| Many writes | Keep concurrency low and let the 429 handling pace the job |
