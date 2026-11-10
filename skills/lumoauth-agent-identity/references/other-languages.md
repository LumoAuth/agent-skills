# Agent classes in Go, .NET, Java and PHP

Each example does the same as the Python and TypeScript examples in `SKILL.md`: authenticate a
`client_secret` agent with the client credentials grant, ask before an action, read the agent's
own record and report usage.

All of them read `LUMOAUTH_URL` (default `https://app.lumoauth.dev`) and `LUMOAUTH_ORG_ID`. Go,
.NET and Java also read `AGENT_CLIENT_ID` and `AGENT_CLIENT_SECRET`. Keep the secret on the
server and load it from the environment or a secrets manager.

What each SDK supports for agents:

| | Go | .NET | Java | PHP |
|---|---|---|---|---|
| Agent class with token renewal | `Agent` | `LumoAgent` | `LumoAgent` | None: use `LumoAuth` with `tokenProvider` |
| Private key JWT (`AGENT_PRIVATE_KEY`) | Yes | No | No | No |
| DPoP-bound tokens | Yes | No | No | No |

For a private key JWT agent in .NET, Java or PHP, sign the assertion with a JWT library and call
the token endpoint (see `private-key-jwt.md`).

## Go

```bash
go get github.com/lumoauth/lumo-auth-go
```

```go
package main

import (
	"context"
	"fmt"
	"log"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	ctx := context.Background()

	// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
	agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{})
	if err != nil {
		log.Fatal(err)
	}

	// Optional: fail early when the credential is wrong.
	if _, err := agent.Authenticate(ctx); err != nil {
		log.Fatal(err)
	}

	decision, err := agent.Ask(ctx, "document.read", map[string]any{"id": "doc_99"})
	if err != nil {
		log.Fatal(err)
	}
	if !decision.Allowed {
		log.Fatalf("not allowed: %s", decision.Reason)
	}

	me, err := agent.Identity(ctx, false)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(me.Identity["agent_id"], me.Capabilities)

	report, err := agent.ReportUsage(ctx, 1530, 0.0042)
	if err != nil {
		log.Fatal(err)
	}
	if report.Budget != nil && report.Budget.Exhausted() {
		log.Fatal("the agent's budget is spent")
	}
}
```

Other methods: `IsAllowed(ctx, action, context)`, `HasCapability(ctx, name)`,
`RequireCapability(ctx, name)`, `Capabilities(ctx)`, `Budget(ctx)`, `CheckBudget(ctx)`,
`AccessToken(ctx)` (the current token, renewed when needed), `Do(ctx, method, path, body, out)` for
an endpoint without a helper. Set `ClientID`, `ClientSecret`, `OrgID`, `BaseURL` and `Scopes` in
`AgentConfig` to pass values in code. The module needs Go 1.22 or later.

## .NET

```bash
dotnet add package LumoAuth
```

The package targets .NET 8 or later.

```csharp
using LumoAuth;
using LumoAuth.Models;

// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
using var agent = LumoAgent.FromEnvironment();

// Optional: fail early when the credential is wrong.
await agent.AuthenticateAsync();

AgentAskResult decision = await agent.AskAsync("document.read", new { id = "doc_99" });
if (!decision.Allowed)
{
    throw new InvalidOperationException(decision.Reason ?? "Not allowed");
}

AgentIdentity me = await agent.IdentityAsync();
Console.WriteLine(string.Join(", ", me.Capabilities));

UsageReportResult report = await agent.ReportUsageAsync(1530, 0.0042);
if (report.Budget.Exhausted)
{
    throw new InvalidOperationException("The agent's budget is spent");
}
```

Other members: `IsAllowedAsync(action, context)`, `HasCapabilityAsync(name)`,
`RequireCapabilityAsync(name)`, `CapabilitiesAsync()`, `BudgetAsync()`, `CheckBudgetAsync()`,
`GetAccessTokenAsync()`. To pass values in code use
`new LumoAgent(clientId, clientSecret, orgId, baseUrl)` or `new LumoAgent(new LumoAgentOptions { ... })`
with `ClientId`, `ClientSecret`, `OrgId`, `BaseUrl` and `Scopes`.

## Java

Add `io.lumoauth:lumo-auth-java` to the build (Java 17 or later). Take the current version from
Maven Central.

```java
import io.lumoauth.LumoAgent;
import io.lumoauth.model.AgentAskResult;
import io.lumoauth.model.AgentIdentity;
import io.lumoauth.model.UsageReportResult;

import java.util.Map;

public class AgentMain {
    public static void main(String[] args) {
        // Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
        LumoAgent agent = LumoAgent.fromEnvironment();

        // Optional: fail early when the credential is wrong.
        agent.authenticate();

        AgentAskResult decision = agent.ask("document.read", Map.of("id", "doc_99"));
        if (!decision.allowed()) {
            throw new IllegalStateException(decision.reason());
        }

        AgentIdentity me = agent.identity();
        System.out.println(me.capabilities());

        UsageReportResult report = agent.reportUsage(1530, 0.0042);
        if (report.budget() != null && report.budget().exhausted()) {
            throw new IllegalStateException("The agent's budget is spent");
        }
    }
}
```

Other methods: `isAllowed(action, context)`, `hasCapability(name)`, `requireCapability(name)`,
`capabilities()`, `budget()`, `checkBudget()`, `accessToken()`. To pass values in code use
`LumoAgent.builder().clientId(...).clientSecret(...).orgId(...).baseUrl(...).build()`. `LumoAgent`
is thread-safe: build one and share it. For Spring Boot wiring see `lumoauth-spring-boot`.

## PHP

```bash
composer require lumoauth/lumoauth guzzlehttp/guzzle
```

There is no separate agent class. Get the token with the client credentials grant, then create a
client whose `tokenProvider` returns it. PHP 8.1 or later.

```php
<?php

require 'vendor/autoload.php';

use LumoAuth\LumoAuth;

// LUMOAUTH_URL and LUMOAUTH_ORG_ID are read from the environment.
$tokens = (new LumoAuth())->auth->clientCredentials(
    getenv('AGENT_CLIENT_ID'),
    getenv('AGENT_CLIENT_SECRET'),
);

$agent = new LumoAuth(tokenProvider: fn () => $tokens['access_token']);

$decision = $agent->agents->ask('document.read', ['id' => 'doc_99']);
if (!($decision['allowed'] ?? false)) {
    throw new RuntimeException($decision['reason'] ?? 'Not allowed');
}

$me = $agent->agents->me();
echo implode(', ', $me['capabilities'] ?? []), PHP_EOL;

$report = $agent->agents->reportUsage(1530, 0.0042);
if ($report['budget']['exhausted'] ?? false) {
    throw new RuntimeException("The agent's budget is spent");
}
```

The token lasts at most one hour and this client does not renew it. In a long-running worker,
store `expires_in` with the token and request a new token before it runs out. Other methods of
`$agent->agents`: `isAllowed($action, $context)`, `capabilities()`, `budget()`, `info()`.
For Laravel and Symfony wiring see `lumoauth-laravel` and `lumoauth-symfony`.
