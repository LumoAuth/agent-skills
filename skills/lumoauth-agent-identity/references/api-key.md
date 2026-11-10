# Agent API keys (`agk_`)

An `api_key` agent authenticates with one static key that starts with `agk_`. LumoAuth shows the
key once, when the agent is registered. This is the default type of `lumo agents create` and of
the Admin API when `identityType` is left out.

Prefer a workload identity or a private key JWT where possible. Use an API key for a script or a
tool that can send only one static value. Do not confuse the three key kinds: `agt_…` is an agent
ID (not a secret), `agk_…` is an agent API key, `lmk_…` is an organization API key for the Admin
API.

## Register

Show the user the command before you run it.

```bash
lumo agents create \
  --name "Report script" \
  --type api_key \
  --capabilities reports.read \
  --key-expires-in-days 90
```

The response contains `agentId` and, once, `apiKey`. Store the key in a secrets manager.

Key lifetime: a new key expires after 180 days unless you choose otherwise.

| CLI flag | Admin API field | Meaning |
|---|---|---|
| `--key-expires-in-days 90` | `apiKeyExpiresInDays` (1 to 3650) | Days until the key expires |
| `--key-expires-at 2027-03-31` | `apiKeyExpiresAt` (ISO 8601) | A fixed expiry time |
| `--key-never-expires` | either field set to `null` | The key is valid until it is revoked or rotated |

## Use the key

Send the key as a bearer token to the agent routes:

```bash
curl "https://app.lumoauth.dev/orgs/acme-corp/api/v1/agents/me" \
  -H "Authorization: Bearer $AGENT_API_KEY"
```

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/agents/ask" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "reports.read"}'
```

LumoAuth accepts the key on the agent routes, the just-in-time permission routes, the
authorization check routes, the token endpoint, and agent-initiated CIBA. It accepts the key only
for an agent whose identity type is `api_key`.

To get a short-lived access token instead of sending the key on every call, use the key as the
`client_id` of the client credentials grant, with no `client_secret`:

```bash
curl -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/oauth/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$AGENT_API_KEY"
```

Send the access token, not the key, to anything outside LumoAuth. A resource server must never
receive the `agk_` key.

The SDK agent classes (`LumoAgent`, `LumoAuthAgent`, Go `Agent`) need a client secret or a private
key. For an API key agent, call the HTTP API as shown. In PHP, pass the key through `tokenProvider`:

```php
<?php

require 'vendor/autoload.php';

use LumoAuth\LumoAuth;

$agent = new LumoAuth(orgId: 'acme-corp', tokenProvider: fn () => getenv('AGENT_API_KEY'));

if ($agent->agents->isAllowed('reports.read')) {
    // run the report
}
```

## Rotate and expire

```bash
lumo agents rotate-credentials agt_0123456789abcdef --key-expires-in-days 90
```

The old key stops working at once, and the access tokens that the agent obtained with it are
revoked. The new key is printed once. Without a lifetime flag the new key keeps the current expiry
date, or gets 180 days when that date has passed. Only an admin who holds every capability of the
agent can rotate.

An expired key gets `401` on every route, including the token endpoint.

Docs: https://docs.lumoauth.dev/agents/registry
