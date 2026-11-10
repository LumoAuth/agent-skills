# AAuth clients in Go, Java, .NET and PHP

Each client does what `AAuthClient` from `@lumoauth/agent` does in `SKILL.md`. All of them read
`LUMOAUTH_URL` (default `https://app.lumoauth.dev`) and `LUMOAUTH_ORG_ID`. None reads the private
key from the environment: load the PEM from your secrets manager and pass it in. The examples use
`AGENT_PRIVATE_KEY` as your own variable name.

| | Go | Java | .NET | PHP | Python |
|---|---|---|---|---|---|
| Generate an Ed25519 key pair | `GenerateKeypair` | `AAuthKeys.generateKeypair` | `AAuthKeys.GenerateKeypair` | `Signer::generateKeypair` | `AAuthClient.generate_keypair` |
| Signing keys | Ed25519, RSA | Ed25519, RSA | Ed25519, RSA | Ed25519 | Ed25519 |
| Signs a query string (`@query`) | Yes | Yes | Yes | No | No |
| `auth`, `code`, `refresh` | Yes | Yes | Yes | Yes | Yes |
| `exchange`, revoke | Yes | Yes | Yes | No | No |
| Verify auth tokens (resource side) | Yes | Yes | Yes | No | No |

To get the agent token, every language signs the request to `/aauth/agent/issue` with the
`Signature-Key` value `sig1=jwks_uri;id="<agent identifier>";kid="<kid>"`. The Go example shows the
whole call; the other signers take the same value in their `signatureKey` option.

## Go

```bash
go get github.com/lumoauth/lumo-auth-go
```

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	lumoauth "github.com/lumoauth/lumo-auth-go"
)

const (
	agentIdentifier = "https://my-agent.example.com"
	kid             = "key-1"
)

// issueAgentToken asks LumoAuth for an agent token that is bound to the agent's own key.
func issueAgentToken(ctx context.Context, client *lumoauth.AAuthClient) (string, error) {
	jwk, err := client.PublicJWK()
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]any{
		"delegate_sub":        agentIdentifier + "/session/main",
		"delegate_public_key": jwk,
		"audience":            client.Issuer(),
	})
	if err != nil {
		return "", err
	}

	url := client.Issuer() + "/aauth/agent/issue"
	headers, err := client.SignRequest(http.MethodPost, url, lumoauth.SignOptions{
		Body:         body,
		SignatureKey: fmt.Sprintf(`sig1=jwks_uri;id="%s";kid="%s"`, agentIdentifier, kid),
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("agent token request failed: HTTP %d", resp.StatusCode)
	}
	var out struct {
		AgentToken string `json:"agent_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.AgentToken, nil
}

func main() {
	ctx := context.Background()

	client, err := lumoauth.NewAAuthClient(lumoauth.AAuthConfig{
		AgentIdentifier: agentIdentifier,
		PrivateKeyPEM:   os.Getenv("AGENT_PRIVATE_KEY"),
		Kid:             kid,
	})
	if err != nil {
		log.Fatal(err)
	}

	agentToken, err := issueAgentToken(ctx, client)
	if err != nil {
		log.Fatal(err)
	}

	resourceToken := os.Args[1] // the resource token that the resource issued for this agent

	result, err := client.RequestAuthToken(ctx, lumoauth.AuthTokenParams{
		ResourceToken: resourceToken,
		AgentToken:    agentToken,
		RedirectURI:   "https://my-agent.example.com/oauth/callback",
	})
	if err != nil {
		log.Fatal(err)
	}
	if result.AuthorizationRequired {
		// Send the user's browser to this URL, then call
		// client.ExchangeCode(ctx, code, redirectURI, agentToken) with the code from the callback.
		log.Fatalf("user consent needed: %s", result.AuthorizationURI)
	}

	resp, err := client.SignedRequest(ctx, http.MethodGet, "https://api.example.com/v1/data", result.AuthToken, nil)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	fmt.Println(resp.Status)
}
```

Key pair: `keypair, err := lumoauth.GenerateKeypair("")` returns `PrivateKeyPEM`, `JWK` and `JWKS`
(kid `key-1`). The thumbprint for the resource token: `client.PublicJWKThumbprint()`.

Other methods: `ExchangeCode(ctx, code, redirectURI, agentToken)`,
`ExchangeToken(ctx, authToken, resourceToken, agentToken)`, `Refresh(ctx, lumoauth.RefreshParams{...})`,
`Revoke(ctx, token, lumoauth.AAuthTokenTypeRefresh, agentToken)`, `DiscoverIssuer(ctx)`, `JWKS(ctx)`.

## Java

`io.lumoauth:lumo-auth-java`, Java 17 or later.

```java
import io.lumoauth.aauth.AAuthClient;
import io.lumoauth.aauth.AAuthTokenResponse;

import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

public class AAuthAgent {
    public static void main(String[] args) {
        String agentToken = args[0];     // from /aauth/agent/issue
        String resourceToken = args[1];  // from the resource

        AAuthClient client = AAuthClient.builder()
            .agentIdentifier("https://my-agent.example.com")
            .privateKeyPem(System.getenv("AGENT_PRIVATE_KEY"))
            .kid("key-1")
            .build();                    // reads LUMOAUTH_URL and LUMOAUTH_ORG_ID

        AAuthTokenResponse result = client.requestAuthToken(
            resourceToken, null, agentToken, "https://my-agent.example.com/oauth/callback");
        if (result.authorizationRequired()) {
            // Send the user's browser to this URL, then call
            // client.exchangeCode(code, redirectUri, agentToken) with the code from the callback.
            throw new IllegalStateException("User consent needed: " + result.authorizationUri());
        }

        HttpResponse<byte[]> response =
            client.signedRequest("GET", "https://api.example.com/v1/data", result.authToken(), null);
        System.out.println(response.statusCode() + " " + new String(response.body(), StandardCharsets.UTF_8));
    }
}
```

Key pair: `AAuthKeys.generateKeypair()` returns a `Keypair` record with `privateKeyPem()`, `jwk()`
and `jwks()`. To sign the `/aauth/agent/issue` request:
`client.signRequest("POST", url, SignOptions.body(bytes).signatureKey("sig1=jwks_uri;id=\"https://my-agent.example.com\";kid=\"key-1\""))`
returns the headers to send with those exact bytes. The body's `delegate_public_key` is
`client.publicJwk()`; the thumbprint for the resource token is `client.publicJwkThumbprint()`.

Other methods: `exchangeCode(code, redirectUri, agentToken)`,
`exchangeToken(authToken, resourceToken, agentToken)`,
`refresh(refreshToken, resourceToken, scope, agentToken)`,
`revoke(token, AAuthClient.TOKEN_TYPE_REFRESH, agentToken)`, `discoverIssuer()`, `jwks()`.

## .NET

`dotnet add package LumoAuth` (.NET 8 or later).

```csharp
using LumoAuth.AAuth;

string agentToken = args[0];     // from /aauth/agent/issue
string resourceToken = args[1];  // from the resource

using var client = new AAuthClient(new AAuthClientOptions
{
    AgentIdentifier = "https://my-agent.example.com",
    PrivateKeyPem = Environment.GetEnvironmentVariable("AGENT_PRIVATE_KEY"),
    Kid = "key-1",
});                              // reads LUMOAUTH_URL and LUMOAUTH_ORG_ID

AAuthTokenResponse result = await client.RequestAuthTokenAsync(
    resourceToken, null, agentToken, "https://my-agent.example.com/oauth/callback");
if (result.AuthorizationRequired)
{
    // Send the user's browser to this URL, then call
    // client.ExchangeCodeAsync(code, redirectUri, agentToken) with the code from the callback.
    throw new InvalidOperationException($"User consent needed: {result.AuthorizationUri}");
}

using HttpResponseMessage response =
    await client.SignedRequestAsync("GET", "https://api.example.com/v1/data", result.AuthToken!);
Console.WriteLine((int)response.StatusCode);
```

Key pair: `AAuthKeys.GenerateKeypair()` returns a `Keypair` record with `PrivateKeyPem`, `Jwk` and
`Jwks`. To sign the `/aauth/agent/issue` request:
`client.SignRequest("POST", url, new SignOptions { Body = bytes, SignatureKey = "sig1=jwks_uri;id=\"https://my-agent.example.com\";kid=\"key-1\"" })`
returns the headers. The body's `delegate_public_key` is `client.PublicJwk`; the thumbprint for
the resource token is `client.PublicJwkThumbprint`.

Other methods: `ExchangeCodeAsync`, `ExchangeTokenAsync`, `RefreshAsync`,
`RevokeAsync(token, AAuthClient.TokenTypeRefresh, agentToken)`, `DiscoverIssuerAsync`, `JwksAsync`.

## PHP

`composer require lumoauth/lumoauth guzzlehttp/guzzle`, PHP 8.1 or later, with `ext-sodium`.

```php
<?php

require 'vendor/autoload.php';

use LumoAuth\AAuth\AAuthClient;
use LumoAuth\LumoAuth;

$agentToken = $argv[1];     // from /aauth/agent/issue
$resourceToken = $argv[2];  // from the resource

$lumo = new LumoAuth();     // reads LUMOAUTH_URL and LUMOAUTH_ORG_ID
$aauth = new AAuthClient(getenv('AGENT_PRIVATE_KEY'), $lumo->http(), orgId: $lumo->orgId);

$grant = $aauth->requestAuthorization(
    $resourceToken,
    '',                      // scope: ignored by the server, it comes from the resource token
    agentToken: $agentToken,
    redirectUri: 'https://my-agent.example.com/oauth/callback',
);

if (!isset($grant['auth_token'])) {
    if (!empty($grant['authorization_uri'])) {
        // Send the user's browser to this URL, then call
        // $aauth->exchangeCode($code, $redirectUri, $agentToken) with the code from the callback.
        throw new RuntimeException('User consent needed: ' . $grant['authorization_uri']);
    }
    // The client reports a 401 as ['authorization_required' => true, 'auth_url' => ''].
    throw new RuntimeException('LumoAuth refused the request: check the agent token and the signing key');
}

$response = $aauth->signedRequest('GET', 'https://api.example.com/v1/data', $grant['auth_token']);
echo $response->getStatusCode(), PHP_EOL;
```

Key pair: `[$pem, $jwks] = \LumoAuth\AAuth\Signer::generateKeypair();`. The token is in
`auth_token`, not `access_token`. To sign the `/aauth/agent/issue` request, call
`$aauth->signer()->sign('POST', $url, $body, signatureKey: $signatureKey)` and add the header
yourself: `$headers['Signature-Key'] = $signatureKey;` (the signer covers the value but does not
return the header). The body's `delegate_public_key` is `$aauth->signer()->publicJwk('key-1')`.

The PHP signer does not sign a query string: put request parameters in the path or in the JSON
body when you call a resource with it. Other methods:
`exchangeCode($code, $redirectUri, $agentToken)`,
`refresh($refreshToken, $resourceToken, $agentToken)`, `discoverIssuer()`.

For the resource side in Go, Java and .NET, read `resource-server.md` in this folder.
