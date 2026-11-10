# Approvals in Go, PHP, .NET and Java

Open this file when the agent is not written in Python or TypeScript. The flows are the same as in `SKILL.md`; the helper names and the way that a refusal is reported differ.

All four SDKs read `LUMOAUTH_URL` and `LUMOAUTH_ORG_ID`. The agent clients in Go, .NET and Java also read `AGENT_CLIENT_ID` and `AGENT_CLIENT_SECRET`. The agent secret stays on the server.

## How each SDK reports the outcome of the one-call helper

| SDK | Helper | Approved | Denied | No answer in time | Prompt not delivered |
|---|---|---|---|---|---|
| Python | `require_approval(agent, ...)` or `agent.approvals.require(...)` | `ApprovalResult` with `status == "approved"` | returns `status == "denied"` | returns `status` `"pending"` or `"expired"` | raises `LumoAuthApprovalNotDeliveredError` |
| TypeScript | `agent.approvals.require({...})` | `ApprovalResult` with `status === 'approved'` | returns `'denied'` | returns `'pending'` or `'expired'` | throws `LumoAuthApprovalNotDeliveredError` |
| PHP | `$lumo->approvals->require(...)` | `ApprovalResult`, `isApproved()` is true | returns `status` `denied` | returns `pending` or `expired` | throws `LumoAuthApprovalNotDeliveredError` |
| Go | `agent.Approvals.Require(ctx, params, opts)` | `*ApprovalResult`, `nil` error | error matches `ErrApprovalDenied` | error matches `ErrApprovalTimeout` | error matches `ErrApprovalNotDelivered` |
| .NET | `agent.Approvals.RequireAsync(request)` | `ApprovalResult` | throws `LumoAuthApprovalDeniedException` | throws `LumoAuthApprovalTimeoutException` | throws `LumoAuthApprovalNotDeliveredException` |
| Java | `agent.approvals().require(request)` | `ApprovalResult` | throws `LumoAuthApprovalDeniedException` | throws `LumoAuthApprovalTimeoutException` | throws `LumoAuthApprovalNotDeliveredException` |

The "not delivered" error carries a reason: `email_fallback_sent` (the approver has no enrolled phone or is not a user of the organization; a plain email notice may have been sent) or `no_enrolled_device`. Neither is an approval.

The Python and TypeScript packages also export `LumoAuthApprovalDeniedError` and `LumoAuthApprovalTimeoutError`. The approval helpers in those two SDKs do not raise them; check `status` instead.

Every SDK also has the two-step form: create the request, then wait. Use it to show a "waiting for approval" state in a UI.

| SDK | Create | Poll once | Wait |
|---|---|---|---|
| Python | `agent.approvals.create(...)` | `agent.approvals.get_status(token)` | `agent.approvals.wait(token, poll_interval_s=1.5, timeout_s=90.0)` |
| TypeScript | `agent.approvals.create({...})` | `agent.approvals.getStatus(token)` | `agent.approvals.wait(token, { pollIntervalMs, timeoutMs })` |
| PHP | `$lumo->approvals->create(...)` | `$lumo->approvals->status($token)` | `$lumo->approvals->wait($token, 1.5, 90.0)` |
| Go | `agent.Approvals.Create(ctx, params)` | `agent.Approvals.Status(ctx, token)` | `agent.Approvals.Wait(ctx, token, opts)` |
| .NET | `CreateAsync(request)` | `StatusAsync(token)` | `WaitForAsync(token, options)` |
| Java | `create(request)` | `status(token)` | `waitFor(token, options)` |

When no prompt was delivered, `create` returns the status `email_fallback_sent` with no token. There is nothing to poll.

`@lumoauth/backend` has the same `approvals` and `jit` modules on `LumoAuthBackend`. The server accepts these calls only from an agent credential, so `secretKey` must be the agent's token there. An organization API key (`lmk_...`) gets `403 agent_token_required`.

## Go

```bash
go get github.com/lumoauth/lumo-auth-go
```

Requires Go 1.22 or later.

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	ctx := context.Background()

	// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
	agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{})
	if err != nil {
		log.Fatal(err)
	}

	// Push approval. Any outcome other than approval is an error.
	_, err = agent.Approvals.Require(ctx, lumoauth.ApprovalParams{
		TaskID:     "wire-INV-7741",
		Reason:     "Wire $4,500 to Bluepeak Supplies for invoice INV-7741",
		OnBehalfOf: os.Getenv("APPROVER_EMAIL"),
		Impact:     lumoauth.ImpactHigh,
		Meta:       map[string]any{"amount": 4500, "invoice": "INV-7741"},
	}, nil)
	switch {
	case err == nil:
		fmt.Println("approved: run the action")
	case errors.Is(err, lumoauth.ErrApprovalDenied):
		fmt.Println("denied")
	case errors.Is(err, lumoauth.ErrApprovalTimeout):
		fmt.Println("no answer in time")
	case errors.Is(err, lumoauth.ErrApprovalNotDelivered):
		var approvalErr *lumoauth.ApprovalError
		if errors.As(err, &approvalErr) {
			fmt.Println("not delivered:", approvalErr.Reason)
		}
	default:
		log.Fatal(err)
	}

	// JIT permission. Close completes the task and revokes its JIT tokens.
	jit, err := lumoauth.NewJITContext(agent)
	if err != nil {
		log.Fatal(err)
	}
	defer jit.Close(ctx)

	if _, err := jit.CreateTask(ctx, lumoauth.CreateTaskParams{Name: "Close ticket 4812", Type: "support"}); err != nil {
		log.Fatal(err)
	}
	url := "https://api.example.com/v1/tickets/4812"
	result, err := jit.RequestPermission(ctx, map[string]any{
		"type": "api_call", "actions": []string{"DELETE"}, "identifier": url,
	}, &lumoauth.RequestPermissionOptions{
		Justification: "The customer asked to delete ticket 4812",
		TTL:           300,
	})
	if err != nil {
		log.Fatal(err)
	}
	if !result.Approved() {
		fmt.Println("not approved:", result.Status) // "pending" means the wait timed out
		return
	}
	token, err := jit.Token(ctx, result.RequestID)
	if err != nil {
		log.Fatal(err)
	}
	response, err := jit.Call(ctx, token, "DELETE", url, nil)
	if err != nil {
		log.Fatal(err)
	}
	defer response.Body.Close()
	fmt.Println(response.StatusCode)
}
```

`RequestPermissionOptions` also has `NoWait`, `PollInterval`, `PollTimeout` and `TaskID`. `jit.Status(ctx, requestID)` reads one request. `lumoauth.WithDelegatedToken(token)` makes the context use a delegation token (see `lumoauth-agent-delegation`).

## PHP

```bash
composer require lumoauth/lumoauth guzzlehttp/guzzle
```

Requires PHP 8.1 or later. There is no separate agent class. Create a client whose `tokenProvider` returns the agent's token. The token expires; request a new one when it does.

```php
<?php

declare(strict_types=1);

use LumoAuth\Error\LumoAuthApprovalNotDeliveredError;
use LumoAuth\LumoAuth;

require __DIR__ . '/vendor/autoload.php';

$tokens = (new LumoAuth(orgId: 'acme-corp'))->auth->clientCredentials(
    getenv('AGENT_CLIENT_ID'),
    getenv('AGENT_CLIENT_SECRET'),
);
$agent = new LumoAuth(orgId: 'acme-corp', tokenProvider: fn () => $tokens['access_token']);

// Push approval. Returns the status; it does not throw for a denial or a timeout.
try {
    $result = $agent->approvals->require(
        taskId: 'wire-INV-7741',
        reason: 'Wire $4,500 to Bluepeak Supplies for invoice INV-7741',
        onBehalfOf: getenv('APPROVER_EMAIL'),
        impact: 'high',
        meta: ['amount' => 4500, 'invoice' => 'INV-7741'],
    );
    echo $result->isApproved() ? "approved\n" : "not approved: {$result->status}\n";
} catch (LumoAuthApprovalNotDeliveredError $e) {
    echo "not delivered: {$e->reason}\n";
}

// JIT permission. PHP has no context helper: poll and complete the task yourself.
$task = $agent->jit->createTask(name: 'Close ticket 4812', taskType: 'support');
try {
    $url = 'https://api.example.com/v1/tickets/4812';
    $request = $agent->jit->request(
        $task['task_id'],
        ['type' => 'api_call', 'actions' => ['DELETE'], 'identifier' => $url],
        justification: 'The customer asked to delete ticket 4812',
        ttl: 300,
    );
    $deadline = time() + 300;
    while ($request['status'] === 'pending' && time() < $deadline) {
        sleep(5);
        $request = $agent->jit->status($request['request_id']);
    }
    if ($request['status'] === 'approved') {
        $jitToken = $agent->jit->token($request['request_id'])['access_token'];
        // Send $jitToken as "Authorization: Bearer ..." to the API with your HTTP client.
    }
} finally {
    $agent->jit->completeTask($task['task_id']);
}
```

## .NET

```bash
dotnet add package LumoAuth
```

Targets .NET 8.

```csharp
using LumoAuth;
using LumoAuth.Errors;
using LumoAuth.Models;

// Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
var agent = LumoAgent.FromEnvironment();

// Push approval. Anything other than approval is an exception.
try
{
    await agent.Approvals.RequireAsync(new ApprovalRequest
    {
        TaskId = "wire-INV-7741",
        Reason = "Wire $4,500 to Bluepeak Supplies for invoice INV-7741",
        OnBehalfOf = Environment.GetEnvironmentVariable("APPROVER_EMAIL")!,
        Impact = ApprovalImpact.High,
        Meta = new { amount = 4500, invoice = "INV-7741" },
    });
    Console.WriteLine("approved: run the action");
}
catch (LumoAuthApprovalDeniedException) { Console.WriteLine("denied"); }
catch (LumoAuthApprovalTimeoutException) { Console.WriteLine("no answer in time"); }
catch (LumoAuthApprovalNotDeliveredException e) { Console.WriteLine($"not delivered: {e.Reason}"); }

// JIT permission. Disposal completes the task and revokes its JIT tokens.
await using var jit = new JitContext(agent);
await jit.CreateTaskAsync(CreateTaskRequest.Named("Close ticket 4812").OfType("support"));

const string url = "https://api.example.com/v1/tickets/4812";
JitRequest result = await jit.RequestPermissionAsync(
    new { type = "api_call", actions = new[] { "DELETE" }, identifier = url },
    new JitContext.RequestOptions { Justification = "The customer asked to delete ticket 4812", Ttl = 300 });

if (result.IsApproved)
{
    string token = await jit.TokenAsync(result.RequestId);
    using HttpResponseMessage response = await jit.CallAsync(token, "DELETE", url);
    Console.WriteLine((int)response.StatusCode);
}
else
{
    Console.WriteLine($"not approved: {result.Status}"); // "pending" means the wait timed out
}
```

`JitContext.RequestOptions` also has `WaitForDecision`, `Polling` (a `WaitOptions(PollInterval, Timeout)`) and `TaskId`. `new JitContext(agent, delegatedToken)` uses a delegation token.

## Java

```xml
<dependency>
  <groupId>io.lumoauth</groupId>
  <artifactId>lumo-auth-java</artifactId>
  <version><!-- the current release on Maven Central --></version>
</dependency>
```

Requires Java 17 or later.

```java
import io.lumoauth.JitContext;
import io.lumoauth.LumoAgent;
import io.lumoauth.errors.LumoAuthApprovalDeniedException;
import io.lumoauth.errors.LumoAuthApprovalNotDeliveredException;
import io.lumoauth.errors.LumoAuthApprovalTimeoutException;
import io.lumoauth.model.ApprovalImpact;
import io.lumoauth.model.ApprovalRequest;
import io.lumoauth.model.CreateTaskRequest;
import io.lumoauth.model.JitRequest;

import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

public class ApprovalExample {
    public static void main(String[] args) {
        // Reads LUMOAUTH_URL, LUMOAUTH_ORG_ID, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET.
        LumoAgent agent = LumoAgent.fromEnvironment();

        // Push approval. Anything other than approval is an exception.
        try {
            agent.approvals().require(
                ApprovalRequest.builder(
                        "wire-INV-7741",
                        "Wire $4,500 to Bluepeak Supplies for invoice INV-7741",
                        System.getenv("APPROVER_EMAIL"))
                    .impact(ApprovalImpact.HIGH)
                    .meta(Map.of("amount", 4500, "invoice", "INV-7741"))
                    .build());
            System.out.println("approved: run the action");
        } catch (LumoAuthApprovalDeniedException e) {
            System.out.println("denied");
        } catch (LumoAuthApprovalTimeoutException e) {
            System.out.println("no answer in time");
        } catch (LumoAuthApprovalNotDeliveredException e) {
            System.out.println("not delivered: " + e.reason());
        }

        // JIT permission. close() completes the task and revokes its JIT tokens.
        String url = "https://api.example.com/v1/tickets/4812";
        try (JitContext jit = new JitContext(agent)) {
            jit.createTask(CreateTaskRequest.named("Close ticket 4812").type("support"));
            JitRequest result = jit.requestPermission(
                Map.of("type", "api_call", "actions", List.of("DELETE"), "identifier", url),
                JitContext.RequestOptions.justification("The customer asked to delete ticket 4812").ttl(300));
            if (result.approved()) {
                String token = jit.token(result.requestId());
                HttpResponse<byte[]> response = jit.call(token, "DELETE", url, null);
                System.out.println(response.statusCode());
            } else {
                System.out.println("not approved: " + result.status()); // "pending" means the wait timed out
            }
        }
    }
}
```

`RequestOptions` also has `noWait()`, `polling(WaitOptions.of(pollInterval, timeout))` and `taskId(...)`. `new JitContext(agent, delegatedToken)` uses a delegation token.

## Automatic escalation on 403

Python (`JITContext.call_with_escalation`), Go (`JITContext.CallWithEscalation`), .NET (`JitContext.CallWithEscalationAsync`) and Java (`JitContext.callWithEscalation`) can retry for you. The helper calls the API, and when the API answers `403` with an `Insufficient-Authorization-Details` header it requests exactly that permission, gets a JIT token and retries once. When the request is not approved, the helper returns the original `403`.

```python
from lumoauth import JITContext, LumoAuthAgent

agent = LumoAuthAgent()
agent.authenticate()

with JITContext(agent) as jit:
    jit.create_task(name="Read document doc_9982")
    response = jit.call_with_escalation(
        "GET",
        "https://api.example.com/v1/documents/doc_9982",
        justification="The user asked for a summary of doc_9982",
    )
    print(response.status_code)
```

The first attempt sends the agent's own access token to the URL. Use this helper only with APIs that your organization runs and that are meant to receive that token. Never point it at a third-party URL that came from model output or user input.
