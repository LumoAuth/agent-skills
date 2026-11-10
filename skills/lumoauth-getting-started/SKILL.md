---
name: lumoauth-getting-started
description: >-
  Orientation for any LumoAuth task: how organizations, regions, URLs and
  credentials work, which SDK package fits which stack, how to scaffold a
  working app with `lumo init`, and which LumoAuth skill to load next. Use when
  the user mentions LumoAuth without naming a framework or feature, asks to
  "add auth", "add login", "add sign-in", "add authorization" or "secure my
  agent" with LumoAuth, starts a new project on LumoAuth, needs to find the
  organization slug, client ID, issuer URL, discovery URL or API key, or asks
  which LumoAuth package or SDK to install.
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth: getting started

LumoAuth is a hosted identity platform for apps and AI agents. It provides OAuth 2.0 and OpenID Connect sign-in, SAML single sign-on, SCIM provisioning, passkeys and MFA, three authorization models (roles, attribute rules, relationships), an identity for every AI agent, MCP authorization and human approval of agent actions.

Use this skill to collect the values that every integration needs, choose the package, and move to the skill that owns the task.

## When to use

- The user wants LumoAuth in a project and the stack or the feature is not clear yet.
- A value is missing: organization slug, region, client ID, issuer, API key.
- A new project should start from a working scaffold.

When the stack and the task are already clear, go straight to the skill in [Choose the next skill](#choose-the-next-skill).

## The model in one minute

- **Organization.** An isolated environment that owns its users, applications, roles, settings and logs. It is identified by a slug such as `acme-corp`. The slug is chosen at sign-up and cannot change.
- **Region.** An organization is in one data region. The base URL is `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU).
- **URLs.** Everything is scoped to the organization:

  | What | URL |
  |---|---|
  | Portal (admin dashboard) | `{base}/orgs/{orgId}/portal/` |
  | Hosted login page | `{base}/orgs/{orgId}/login` |
  | API root | `{base}/orgs/{orgId}/api/v1/` |
  | OIDC discovery | `{base}/orgs/{orgId}/api/v1/.well-known/openid-configuration` |
  | Admin API | `{base}/orgs/{orgId}/api/v1/admin/...` |

- **Issuer.** The OIDC issuer is `{base}/orgs/{orgId}/api/v1`. An organization with a verified custom domain uses that domain as its issuer. Read `issuer` from the discovery document instead of building the string.
- **Application (OAuth client).** Every app that signs users in is registered as an application with a client ID, redirect URIs and a type. Every new organization has a **Starter App**: a public PKCE client that already allows `http://localhost:3000/auth/callback`.

## Collect the values first

Look in the project (`.env*` files, config files) before asking. Ask the user for anything that is missing. Never guess a slug or a client ID.

| Value | Where it comes from |
|---|---|
| Organization slug | The user. It is the `{orgId}` in the portal URL. `lumo whoami` prints it when the CLI is logged in. |
| Base URL (region) | `https://app.lumoauth.dev` unless the organization is in the EU region. |
| Client ID | Portal → **Applications** (`/orgs/{orgId}/portal/applications`), or `lumo apps list`. The portal's **Get started → Quickstarts** page shows snippets with the organization's real values. Create a browser or mobile (public) application in the portal: choose **Single-page or mobile app**. |
| Client secret | Shown once when a **Web application** or **Machine to machine** application is created. Server-side only. |
| Redirect URI | Each framework integration has its own default callback path; the framework skill states it. It must be registered on the application exactly. Plain `http` is accepted on `localhost` for development. The scaffolds use `http://localhost:3000/auth/callback`. |
| API key (`lmk_...`) | Portal → **Applications & developer tools → API keys** (`/orgs/{orgId}/portal/settings/api-keys`). Shown once. Sent as `X-API-Key`. |
| Agent credentials | Created when an agent is registered. See `lumoauth-agent-identity`. |

Confirm the slug and the region before writing code. This call is public and sends no credentials:

```bash
bash scripts/check-org.sh acme-corp                              # US region
bash scripts/check-org.sh acme-corp https://eu.app.lumoauth.dev  # EU region
```

It prints the discovery document, or an error that says the organization was not found at that base URL. The same check with plain curl:

```bash
curl -fsS https://app.lumoauth.dev/orgs/acme-corp/api/v1/.well-known/openid-configuration
```

## Which credential for which job

| Job | Credential | Where it may be stored |
|---|---|---|
| Sign a user in from a browser or mobile app | Public client: client ID + PKCE, no secret | Client ID is public |
| Sign a user in from a server-rendered app | Confidential client: client ID + client secret (+ PKCE) | Secret on the server only |
| Service calls an API without a user | Machine-to-machine application, client credentials grant | Server only |
| Scripts, CI, the `lumo` CLI, server-side permission checks | Organization API key (`lmk_...`) with only the scopes that the job needs | Server or CI secret store only |
| AI agent | The agent's own credential (client secret, private key or workload identity) | Where the agent runs, never in a prompt |

A client secret, an API key or an agent secret never goes into browser code, mobile code, a repository or a log. Read them from environment variables.

The SDKs share these environment variable names: `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID`, `LUMOAUTH_API_KEY`, and for agents `AGENT_CLIENT_ID` and `AGENT_CLIENT_SECRET`. The `lumo` CLI reads `LUMO_BASE_URL`, `LUMO_ORG` and `LUMO_API_KEY`. Each framework skill states the exact names that its code reads.

## New project: scaffold it

`lumo init` writes a minimal project that already signs users in. It needs the CLI (see `lumoauth-cli`).

```bash
curl -fsSL https://raw.githubusercontent.com/LumoAuth/cli/main/install.sh | sh   # or: brew install lumoauth/tap/lumo
lumo login --org acme-corp        # the user approves in the browser
lumo doctor                       # confirms the credential and the organization
lumo apps list                    # find the Starter App client ID
lumo init --framework next --dir ./my-app --client-id CLIENT_ID_FROM_THE_LIST
```

`--framework` is one of `next`, `express`, `fastapi` or `go`. Every scaffold listens on `http://localhost:3000` and uses `/auth/callback`, which the Starter App already allows. `lumo login` opens a browser for the user; do not try to complete it yourself. Existing files are skipped unless `--force` is passed.

Then continue in the matching skill (`lumoauth-nextjs`, `lumoauth-express`, `lumoauth-fastapi`, `lumoauth-go`).

## Existing project: choose the package

| Stack | Package | Skill |
|---|---|---|
| Next.js | `@lumoauth/nextjs` | `lumoauth-nextjs` |
| React single-page app | `@lumoauth/react` | `lumoauth-react` |
| Vue | `@lumoauth/client` | `lumoauth-vue` |
| Angular | `@lumoauth/client` | `lumoauth-angular` |
| React Native / Expo | `@lumoauth/client` | `lumoauth-react-native` |
| Express | `@lumoauth/express` | `lumoauth-express` |
| Node.js API or service | `@lumoauth/backend` | `lumoauth-node-backend` |
| FastAPI | `lumoauth[fastapi]` | `lumoauth-fastapi` |
| Python (Flask, Django, scripts) | `lumoauth` | `lumoauth-python` |
| Go | `github.com/lumoauth/lumo-auth-go` | `lumoauth-go` |
| ASP.NET Core / .NET | `LumoAuth.AspNetCore` / `LumoAuth` | `lumoauth-aspnetcore` |
| Spring Boot / Java | `io.lumoauth:lumo-auth-spring-boot-starter` / `io.lumoauth:lumo-auth-java` | `lumoauth-spring-boot` |
| Laravel | `lumoauth/laravel` | `lumoauth-laravel` |
| Symfony | `lumoauth/symfony-bundle` | `lumoauth-symfony` |
| Plain PHP | `lumoauth/lumoauth` | `lumoauth-php` |
| Anything else, or an existing OIDC library | none needed | `lumoauth-oauth-oidc` |
| An API that only validates tokens | none needed | `lumoauth-api-protection` |
| MCP server (Python FastMCP, TypeScript) | `lumoauth-fastmcp`, `@lumoauth/mcp` | `lumoauth-mcp-server` |
| AI agent | `@lumoauth/agent`, `lumoauth`, and the other SDKs | `lumoauth-agent-identity` |

## Choose the next skill

| The user wants to | Skill |
|---|---|
| Manage the organization from a terminal or CI | `lumoauth-cli` |
| Call the Admin API, use a generated API client, keep configuration as code | `lumoauth-admin-api` |
| Configure passwords, magic links, email-first login, social login | `lumoauth-login-methods` |
| Turn on MFA, passkeys, adaptive MFA or push sign-in | `lumoauth-mfa-passkeys` |
| Connect a customer's identity provider (SAML, OIDC), or act as a SAML identity provider | `lumoauth-enterprise-sso` |
| Provision users and groups with SCIM | `lumoauth-scim` |
| Brand the login page, use a custom domain, edit email templates | `lumoauth-branding` |
| Decide how to model access control | `lumoauth-authorization` |
| Roles, permissions, groups | `lumoauth-rbac` |
| Attribute-based policies | `lumoauth-abac` |
| Relationship-based access ("owner of", "member of") | `lumoauth-rebac` |
| Use PAR, DPoP, FAPI 2.0, CIBA, device flow or resource indicators | `lumoauth-oauth-advanced` |
| Give an AI agent an identity, capabilities and a budget | `lumoauth-agent-identity` |
| Sign agent HTTP requests with AAuth | `lumoauth-aauth` |
| Let an agent act for a user (token exchange, cross-app access, token vault) | `lumoauth-agent-delegation` |
| Require a person's approval before an agent acts | `lumoauth-agent-approvals` |
| Connect LangChain, LangGraph, CrewAI, OpenAI Agents SDK, Agno, Google ADK | `lumoauth-agent-frameworks` |
| Monitor, restrict, suspend or stop agents | `lumoauth-agent-governance` |
| Add OAuth to an MCP server | `lumoauth-mcp-server` |
| Call a protected MCP server | `lumoauth-mcp-client` |
| Manage users, invitations and sessions | `lumoauth-users-sessions` |
| Build a SaaS where each customer is its own organization | `lumoauth-b2b-saas` |
| Receive events through webhooks | `lumoauth-webhooks` |
| Read or export audit logs, handle GDPR requests, choose a data region | `lumoauth-audit-compliance` |
| Connect alerting, SMS, email, risk, device posture or key storage providers | `lumoauth-integrations` |
| Move from Auth0, Clerk, Okta, Cognito or Firebase Auth | `lumoauth-migrate` |

## Rules for every LumoAuth task

1. Ask the user for a missing slug, client ID or secret. Do not invent one, and do not create an organization for them.
2. Show the user every command or API call that creates, changes or deletes something in the organization before you run it.
3. Keep secrets in environment variables. Add `.env*` files to `.gitignore`. Never print a token or a key in output or logs.
4. Browser and mobile apps are public clients: PKCE, no client secret, no API key.
5. Enforce access on the server. A check in the UI only hides a control.
6. Read endpoints from the discovery document. Do not hardcode token or JWKS URLs.
7. Some features depend on the organization's plan. When the API answers `403` with a message about the plan, or a portal page is greyed out, tell the user and link to https://docs.lumoauth.dev/pricing-matrix.

## Verify

- `bash scripts/check-org.sh <slug>` returns a discovery document with the expected `issuer`.
- With the CLI: `lumo doctor` reports every check as passed.
- After an integration: the app redirects to `{base}/orgs/{orgId}/...` for sign-in, returns to the registered redirect URI and shows the signed-in user.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Discovery returns `404` | Wrong slug, or the organization is in the other region | Confirm the slug with the user and try the other base URL |
| `redirect_uri` error on the login page | The redirect URI in the request is not registered on the application, character for character | Add the exact URI on the application's **Configuration** tab |
| Browser sign-in fails with a CORS error | The app's origin is not allowed on the application | Add the origin under **Browser CORS origins** on the application's **Configuration** tab |
| Token validation fails on `iss` | The issuer was built by hand, or the organization uses a custom domain | Use `issuer` from the discovery document |
| `401` from the Admin API with an API key | Key sent as a bearer token | Send it in the `X-API-Key` header |
| `403` from the Admin API | The key or token lacks the scope for that resource | Create a key with the scope that the error names (see `lumoauth-admin-api`) |

## References

- Start page: https://docs.lumoauth.dev/
- Core concepts: https://docs.lumoauth.dev/user-guide/getting-started/concepts
- First 15 minutes in the portal: https://docs.lumoauth.dev/user-guide/getting-started/first-tenant
- SDKs and libraries: https://docs.lumoauth.dev/developer/sdks
- `lumo init`: https://docs.lumoauth.dev/cli/init
