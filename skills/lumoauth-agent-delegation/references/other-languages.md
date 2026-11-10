# Token exchange in Go, .NET, Java and PHP

Each example does what the Python and TypeScript examples in `SKILL.md` do: the agent exchanges a
user's access token plus its own token for a delegated token whose audience is
`https://api.example.com`.

All agent classes read `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID`, `AGENT_CLIENT_ID` and
`AGENT_CLIENT_SECRET`. The agent needs **May act on behalf of users** switched on in the portal.
Run this code on a server only.

| | Go | .NET | Java | PHP |
|---|---|---|---|---|
| Session helper | `DelegationChain` | `DelegationChain` | `DelegationChain` | None |
| Exchange with `resource` | `chain.ExchangeForResource` | `agent.Delegation.ExchangeForResourceAsync` | `agent.delegation().exchangeForResource` | `$lumo->delegation->exchange(..., resource:)` |
| Verify the delegated token in an API | `VerifyAccessToken`, `RequireAccessToken` | See `lumoauth-aspnetcore` | See `lumoauth-spring-boot` | See `lumoauth-php` |

In .NET and Java, `DelegationChain.ExchangeAsync` / `exchange` take no `resource`: the token that
they return has the agent's ID as audience. Use the methods in the table to bind the token to an
API.

## Go

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func main() {
	ctx := context.Background()
	userAccessToken := os.Args[1] // from the application where the user signed in

	agent, err := lumoauth.NewAgent(lumoauth.AgentConfig{}) // reads the environment
	if err != nil {
		log.Fatal(err)
	}

	chain := lumoauth.NewDelegationChain(agent, "")
	if err := chain.SetUserToken("session-1", userAccessToken); err != nil {
		log.Fatal(err)
	}

	delegated, err := chain.ExchangeForResource(ctx, "session-1", "https://api.example.com", "documents.read")
	if err != nil {
		log.Fatal(err) // 403: the agent may not act for users; 400: see the error code
	}
	fmt.Println(len(delegated) > 0)
}
```

Sub-agent: `chain.DelegateToSubAgentForResource(ctx, sessionID, subAgentToken, resource, scopes...)`.
Run `chain.Exchange(ctx, sessionID)` first, without a resource, so that the first token can be the
subject of the second exchange. Without the helper:
`agent.Client().Delegation.ExchangeForResource(ctx, subjectToken, actorToken, resource, scopes...)`
returns a `*TokenResponse` (`AccessToken`, `ExpiresIn`, `Scope`, `TokenType`).

Verify the delegated token in the downstream API:

```go
package main

import (
	"encoding/json"
	"net/http"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

func documents(w http.ResponseWriter, r *http.Request) {
	claims, ok := lumoauth.AccessTokenFromContext(r.Context())
	if !ok || !claims.HasScope("documents.read") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"user":   claims.Subject,      // the user
		"actors": claims.ActorChain(), // "agent_agt_…", outermost actor first; empty when no agent acts
	})
}

func main() {
	guard := lumoauth.RequireAccessToken(lumoauth.AccessTokenVerifyOptions{
		Issuer:   "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
		Resource: "https://api.example.com", // the token's aud must contain this
	})
	http.Handle("/v1/documents", guard(http.HandlerFunc(documents)))
	_ = http.ListenAndServe(":3000", nil)
}
```

`RequireAccessToken` answers `401` with a `WWW-Authenticate` challenge for a missing or invalid
token, and checks the DPoP proof of a DPoP-bound token. `claims.Act` holds the full actor objects
(`Subject`, `Issuer`, `SubjectProfile`, `Name`, nested `Act`).

## .NET

```csharp
using LumoAuth;
using LumoAuth.Models;

string userAccessToken = args[0]; // from the application where the user signed in

using var agent = LumoAgent.FromEnvironment();

TokenResponse delegated = await agent.Delegation.ExchangeForResourceAsync(
    userAccessToken,                       // subject: the user
    await agent.GetAccessTokenAsync(),     // actor: the agent's own token
    "https://api.example.com",             // becomes the token's aud
    new[] { "documents.read" });           // optional: narrow further

Console.WriteLine(delegated.ExpiresIn);
// Send delegated.AccessToken as a bearer token to https://api.example.com only.
```

`new DelegationChain(agent)` keeps tokens per session: `SetUserToken(sessionId, token)`,
`ExchangeAsync(sessionId, scopes)`, `DelegateToSubAgentAsync(sessionId, subAgentToken, scopes)`,
`RevokeAsync(sessionId)`. Use it for tokens that stay inside LumoAuth's API or go on to a
sub-agent, since it sends no `resource`. `DelegationChain.ActorChain(token)` decodes the chain for
display, without verification.

## Java

```java
import io.lumoauth.LumoAgent;
import io.lumoauth.model.TokenResponse;

import java.util.List;

public class Delegate {
    public static void main(String[] args) {
        String userAccessToken = args[0]; // from the application where the user signed in

        LumoAgent agent = LumoAgent.fromEnvironment();

        TokenResponse delegated = agent.delegation().exchangeForResource(
            userAccessToken,             // subject: the user
            agent.accessToken(),         // actor: the agent's own token
            "https://api.example.com",   // becomes the token's aud
            List.of("documents.read"));  // optional: narrow further

        System.out.println(delegated.expiresIn());
        // Send delegated.accessToken() as a bearer token to https://api.example.com only.
    }
}
```

`new DelegationChain(agent, null)` keeps tokens per session: `setUserToken(sessionId, token)`,
`exchange(sessionId, scopes...)`, `delegateToSubAgent(sessionId, subAgentToken, scopes...)`,
`revoke(sessionId)`. It sends no `resource`. `chain.actorChain(token)` decodes the chain for
display, without verification.

## PHP

```php
<?php

require 'vendor/autoload.php';

use LumoAuth\LumoAuth;

$userAccessToken = $argv[1]; // from the application where the user signed in

$lumo = new LumoAuth();      // reads LUMOAUTH_URL and LUMOAUTH_ORG_ID

// The agent's own token (client credentials).
$agentTokens = $lumo->auth->clientCredentials(
    getenv('AGENT_CLIENT_ID'),
    getenv('AGENT_CLIENT_SECRET'),
);

$delegated = $lumo->delegation->exchange(
    $userAccessToken,                    // subject: the user
    $agentTokens['access_token'],        // actor: the agent's own token
    scopes: ['documents.read'],          // optional: narrow further
    resource: 'https://api.example.com', // becomes the token's aud
);

echo $delegated['expires_in'], PHP_EOL;
// Send $delegated['access_token'] as a bearer token to https://api.example.com only.
```

`$lumo->auth->tokenExchange(...)` is the general form. It has an `$audience` argument, but
LumoAuth binds `aud` from `$resource` only. `Delegation::parseActorChain($token)` decodes the chain
for display, without verification.

## Any language, over HTTP

See step 6 of `SKILL.md`. The request is a form POST with `subject_token`, `actor_token`, their
types and `resource`; it needs no client authentication.
