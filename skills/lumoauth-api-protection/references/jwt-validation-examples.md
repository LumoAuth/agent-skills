# JWT validation examples

The same checks as the Node.js example in `SKILL.md`, with standard libraries for Python, Go, C#
and Java. Every example verifies: signature against the organization's JWKS, `typ: at+jwt`,
`iss`, `aud`, `exp`, and one required scope.

Configuration used by all examples:

| Variable | Example |
|---|---|
| `LUMOAUTH_ISSUER` | `https://app.lumoauth.dev/orgs/acme-corp/api/v1` |
| `API_AUDIENCE` | `https://api.example.com` |

The JWKS URL is `{issuer}/.well-known/jwks.json` on the organization path. On a custom domain
read `jwks_uri` from `{issuer}/.well-known/openid-configuration`.

The examples refuse DPoP-bound tokens (tokens with a `cnf` claim) because they do not verify DPoP
proofs. To accept them, see `lumoauth-oauth-advanced`.

## Python: PyJWT

Written for Python 3.10 or later and PyJWT 2.x.

```bash
pip install "pyjwt[crypto]"
```

```python
# lumoauth_token.py
import os

import jwt
from jwt import PyJWKClient

ISSUER = os.environ["LUMOAUTH_ISSUER"]
AUDIENCE = os.environ["API_AUDIENCE"]
ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"]

# Caches the key set and fetches it again when a token carries an unknown kid.
_jwks = PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True)


class AuthError(Exception):
    def __init__(self, status: int, code: str | None, message: str, scope: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.scope = scope

    @property
    def challenge(self) -> str:
        """Value for the WWW-Authenticate response header."""
        if self.code is None:
            return 'Bearer realm="api"'
        value = f'Bearer realm="api", error="{self.code}", error_description="{self}"'
        if self.scope:
            value += f', scope="{self.scope}"'
        return value


def verify_access_token(authorization: str | None, required_scope: str | None = None) -> dict:
    if not authorization:
        raise AuthError(401, None, "Missing access token")
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token or " " in token:
        raise AuthError(401, "invalid_token", "Malformed Authorization header")

    try:
        header = jwt.get_unverified_header(token)
        if str(header.get("typ", "")).lower() not in ("at+jwt", "application/at+jwt"):
            raise jwt.InvalidTokenError("not an access token")
        signing_key = _jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            issuer=ISSUER,
            audience=AUDIENCE,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "jti"]},
        )
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
        raise AuthError(401, "invalid_token", "The access token is invalid or expired") from exc

    if "cnf" in claims:
        raise AuthError(401, "invalid_token", "DPoP-bound tokens are not accepted as Bearer tokens")

    if required_scope and required_scope not in str(claims.get("scope", "")).split(" "):
        raise AuthError(403, "insufficient_scope", "The access token lacks a required scope", required_scope)
    return claims
```

In a request handler, call `verify_access_token(request.headers.get("Authorization"),
"read:reports")`. On `AuthError`, answer with `exc.status` and the header
`WWW-Authenticate: exc.challenge`. For FastAPI, Flask and Django with the LumoAuth package, use
`lumoauth-fastapi` or `lumoauth-python`.

## Go: golang-jwt and keyfunc

```bash
go get github.com/golang-jwt/jwt/v5 github.com/MicahParks/keyfunc/v3
```

```go
// auth/auth.go
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

var algorithms = []string{"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"}

type contextKey struct{}

// Verifier validates LumoAuth access tokens for one API.
type Verifier struct {
	issuer   string
	audience string
	keys     keyfunc.Keyfunc
}

// NewVerifier loads the JWKS and keeps it fresh in the background until ctx ends.
func NewVerifier(ctx context.Context, issuer, audience string) (*Verifier, error) {
	keys, err := keyfunc.NewDefaultCtx(ctx, []string{issuer + "/.well-known/jwks.json"})
	if err != nil {
		return nil, err
	}
	return &Verifier{issuer: issuer, audience: audience, keys: keys}, nil
}

// Verify checks signature, typ, iss, aud and exp and returns the claims.
func (v *Verifier) Verify(raw string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, v.keys.Keyfunc,
		jwt.WithValidMethods(algorithms),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return nil, err
	}
	typ, _ := token.Header["typ"].(string)
	if !strings.EqualFold(typ, "at+jwt") && !strings.EqualFold(typ, "application/at+jwt") {
		return nil, errors.New("not an access token")
	}
	if _, bound := claims["cnf"]; bound {
		return nil, errors.New("DPoP-bound tokens are not accepted as Bearer tokens")
	}
	return claims, nil
}

func hasScope(claims jwt.MapClaims, required string) bool {
	scope, _ := claims["scope"].(string)
	for _, s := range strings.Fields(scope) {
		if s == required {
			return true
		}
	}
	return false
}

// Require returns middleware that admits requests with a valid token and the given scope.
func (v *Verifier) Require(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				w.Header().Set("WWW-Authenticate", `Bearer realm="api"`)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			raw, ok := strings.CutPrefix(header, "Bearer ")
			if !ok {
				w.Header().Set("WWW-Authenticate", `Bearer realm="api", error="invalid_token"`)
				http.Error(w, "invalid_token", http.StatusUnauthorized)
				return
			}
			claims, err := v.Verify(raw)
			if err != nil {
				w.Header().Set("WWW-Authenticate", `Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"`)
				http.Error(w, "invalid_token", http.StatusUnauthorized)
				return
			}
			if scope != "" && !hasScope(claims, scope) {
				w.Header().Set("WWW-Authenticate", `Bearer realm="api", error="insufficient_scope", scope="`+scope+`"`)
				http.Error(w, "insufficient_scope", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, claims)))
		})
	}
}

// Claims returns the verified claims of the request, or nil.
func Claims(r *http.Request) jwt.MapClaims {
	claims, _ := r.Context().Value(contextKey{}).(jwt.MapClaims)
	return claims
}
```

```go
// main.go
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"example.com/api/auth"
)

func main() {
	verifier, err := auth.NewVerifier(context.Background(), os.Getenv("LUMOAUTH_ISSUER"), os.Getenv("API_AUDIENCE"))
	if err != nil {
		log.Fatal(err)
	}
	reports := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"subject": auth.Claims(r)["sub"]})
	})
	http.Handle("/reports", verifier.Require("read:reports")(reports))
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Replace `example.com/api` with the module path of the project. `strings.CutPrefix` needs Go 1.20
or later. With the LumoAuth Go SDK, use `lumoauth-go`.

## C#: ASP.NET Core JwtBearer

```bash
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

```csharp
// Program.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;

var builder = WebApplication.CreateBuilder(args);

var issuer = builder.Configuration["LumoAuth:Issuer"]
    ?? throw new InvalidOperationException("LumoAuth:Issuer is not configured");
var audience = builder.Configuration["LumoAuth:Audience"]
    ?? throw new InvalidOperationException("LumoAuth:Audience is not configured");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Reads {issuer}/.well-known/openid-configuration and the JWKS, and refreshes the keys.
        options.Authority = issuer;
        options.Audience = audience;
        options.MapInboundClaims = false;
        options.TokenValidationParameters.ValidIssuer = issuer;
        options.TokenValidationParameters.ValidTypes = new[] { "at+jwt" };
        options.TokenValidationParameters.ValidAlgorithms = new[]
        {
            "RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512",
        };
        options.TokenValidationParameters.NameClaimType = "sub";
        options.TokenValidationParameters.ClockSkew = TimeSpan.FromSeconds(30);
    });

static bool HasScope(ClaimsPrincipal user, string scope) =>
    user.FindFirst("cnf") is null
    && (user.FindFirst("scope")?.Value.Split(' ').Contains(scope) ?? false);

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("reports:read", policy => policy
        .RequireAuthenticatedUser()
        .RequireAssertion(context => HasScope(context.User, "read:reports")));

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/reports", (ClaimsPrincipal user) => Results.Ok(new { subject = user.FindFirst("sub")?.Value }))
    .RequireAuthorization("reports:read");

app.Run();
```

```json
{
  "LumoAuth": {
    "Issuer": "https://app.lumoauth.dev/orgs/acme-corp/api/v1",
    "Audience": "https://api.example.com"
  }
}
```

The handler answers `401` with a `WWW-Authenticate: Bearer` challenge for a missing or invalid
token and `403` when the policy fails. `AddAuthorizationBuilder` needs .NET 8 or later; on .NET 6
and 7 use `builder.Services.AddAuthorization(options => options.AddPolicy(...))`. With the
LumoAuth packages, use `lumoauth-aspnetcore`.

## Java: Spring Security resource server

Written for Spring Boot 3.1 to 3.5 (Spring Security 6.1 to 6.5) with
`spring-boot-starter-oauth2-resource-server`. For other versions, and for the LumoAuth starter,
use `lumoauth-spring-boot`.

Two defaults of Spring Security matter here: the decoder accepts only `RS256`, and it refuses a
token whose `typ` is not `JWT`. LumoAuth access tokens have `typ: at+jwt`, so configure both.

```yaml
# src/main/resources/application.yml
lumoauth:
  issuer: https://app.lumoauth.dev/orgs/acme-corp/api/v1
  audience: https://api.example.com
```

```java
// SecurityConfig.java
package com.example.api;

import java.util.List;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    JwtDecoder jwtDecoder(
            @Value("${lumoauth.issuer}") String issuer,
            @Value("${lumoauth.audience}") String audience) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(issuer)
                .jwsAlgorithms(algorithms -> algorithms.addAll(List.of(
                        SignatureAlgorithm.RS256, SignatureAlgorithm.RS384, SignatureAlgorithm.RS512,
                        SignatureAlgorithm.ES256, SignatureAlgorithm.ES384, SignatureAlgorithm.ES512,
                        SignatureAlgorithm.PS256, SignatureAlgorithm.PS384, SignatureAlgorithm.PS512)))
                .jwtProcessorCustomizer(processor -> processor.setJWSTypeVerifier(
                        new DefaultJOSEObjectTypeVerifier<>(new JOSEObjectType("at+jwt"))))
                .build();

        OAuth2TokenValidator<Jwt> audienceValidator = new JwtClaimValidator<List<String>>(
                JwtClaimNames.AUD, aud -> aud != null && aud.contains(audience));
        OAuth2TokenValidator<Jwt> unboundValidator = new JwtClaimValidator<Object>(
                "cnf", cnf -> cnf == null);

        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(),
                new JwtIssuerValidator(issuer),
                audienceValidator,
                unboundValidator));
        return decoder;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/reports/**").hasAuthority("SCOPE_read:reports")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
```

Spring Security turns each value of the `scope` claim into an authority with the prefix `SCOPE_`.
It answers `401` with `WWW-Authenticate: Bearer error="invalid_token"` for a bad token and `403`
with `error="insufficient_scope"` for a missing authority.

## Other languages

Any JWT library that supports remote JWKS works. Configure it with these values:

| Setting | Value |
|---|---|
| JWKS URL | `jwks_uri` from discovery |
| Allowed algorithms | The asymmetric `RS*`, `ES*`, `PS*` families. Never `none`, never `HS*` |
| Expected issuer | The discovery `issuer` |
| Expected audience | The API identifier |
| Expected type | `at+jwt` |
| Clock tolerance | 30 to 60 seconds at most |

Then check the `scope` claim yourself: split it on spaces and look for the exact scope string.

## Sources

- https://docs.lumoauth.dev/oauth/token-management
- https://docs.lumoauth.dev/user-guide/applications/signing-keys
- https://docs.lumoauth.dev/tracks/backend
