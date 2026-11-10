# LumoAuth Agent Skills

Skills that teach AI coding agents how to work with [LumoAuth](https://lumoauth.dev): adding sign-in and access control to an app, giving an AI agent its own identity, securing an MCP server and running an organization from the terminal.

Skills follow the [Agent Skills](https://agentskills.io/) format. They work in Claude Code, Cursor, Codex, GitHub Copilot and any other agent that supports the format.

## Installation

```bash
npx skills add lumoauth/agent-skills
```

Install one skill:

```bash
npx skills add lumoauth/agent-skills --skill lumoauth-nextjs
```

## Usage

An installed skill is used automatically when a task matches it. Examples:

```
Add LumoAuth sign-in to this Next.js app
```

```
Only users with the billing.manage permission may open the billing page
```

```
Protect this FastMCP server with LumoAuth
```

```
Make the agent ask for approval on my phone before it sends a payment
```

New to LumoAuth? Start with `lumoauth-getting-started`. It collects the values that every integration needs and points to the skill for the task.

## Available skills

### Getting started

| Skill | Use it to |
|---|---|
| [`lumoauth-getting-started`](skills/lumoauth-getting-started) | Understand organizations, regions, URLs and credentials, choose the SDK package, scaffold an app with `lumo init` and find the next skill |
| [`lumoauth-cli`](skills/lumoauth-cli) | Install and use the `lumo` command line: login, profiles, every resource command, JSON output, sandboxes, raw API access |

### Web and mobile apps

| Skill | Use it to |
|---|---|
| [`lumoauth-nextjs`](skills/lumoauth-nextjs) | Add sign-in, sessions, route protection and permission checks to Next.js with `@lumoauth/nextjs` |
| [`lumoauth-react`](skills/lumoauth-react) | Add sign-in components, hooks and `<Protect>` to a React single-page app with `@lumoauth/react` |
| [`lumoauth-vue`](skills/lumoauth-vue) | Add PKCE sign-in, router guards and permission checks to Vue 3 with `@lumoauth/client` |
| [`lumoauth-angular`](skills/lumoauth-angular) | Add a sign-in service, route guards and an HTTP interceptor to Angular with `@lumoauth/client` |
| [`lumoauth-react-native`](skills/lumoauth-react-native) | Sign users in from React Native and Expo apps with `@lumoauth/client`: PKCE, deep links and secure storage |

### Backends and APIs

| Skill | Use it to |
|---|---|
| [`lumoauth-express`](skills/lumoauth-express) | Mount sign-in routes and protect handlers in Express with `@lumoauth/express` |
| [`lumoauth-node-backend`](skills/lumoauth-node-backend) | Verify tokens and check access in any Node.js API or service with `@lumoauth/backend` |
| [`lumoauth-fastapi`](skills/lumoauth-fastapi) | Add the sign-in router and auth dependencies to FastAPI with `lumoauth[fastapi]` |
| [`lumoauth-python`](skills/lumoauth-python) | Use the `lumoauth` Python package in Flask, Django, workers and scripts |
| [`lumoauth-go`](skills/lumoauth-go) | Add sign-in and access checks to Go services (net/http, chi) with `lumo-auth-go` |
| [`lumoauth-aspnetcore`](skills/lumoauth-aspnetcore) | Add bearer tokens, OpenID Connect sign-in and `[RequirePermission]` to ASP.NET Core and .NET |
| [`lumoauth-spring-boot`](skills/lumoauth-spring-boot) | Add sign-in, token checks and `@RequirePermission` to Spring Boot and Java |
| [`lumoauth-laravel`](skills/lumoauth-laravel) | Use the `lumoauth/laravel` package: facade, configuration, permission middleware, sign-in routes and bearer-token APIs |
| [`lumoauth-symfony`](skills/lumoauth-symfony) | Use `lumoauth/symfony-bundle` in Symfony: autowired client, the access-token authenticator, voters and web sign-in |
| [`lumoauth-php`](skills/lumoauth-php) | Use the `lumoauth/lumoauth` Composer package in any PHP application |

### OAuth and OpenID Connect

| Skill | Use it to |
|---|---|
| [`lumoauth-oauth-oidc`](skills/lumoauth-oauth-oidc) | Connect any standard OAuth 2.0 / OpenID Connect library: discovery, authorization code with PKCE, tokens, refresh, userinfo, logout, client registration |
| [`lumoauth-oauth-advanced`](skills/lumoauth-oauth-advanced) | Use PAR, DPoP, FAPI 2.0, resource indicators, CIBA, device authorization, client attestation, introspection and revocation |
| [`lumoauth-api-protection`](skills/lumoauth-api-protection) | Protect an API in any language: validate access tokens, use client credentials for machine-to-machine calls, choose between API keys and tokens |

### Sign-in features

| Skill | Use it to |
|---|---|
| [`lumoauth-login-methods`](skills/lumoauth-login-methods) | Configure email and password, magic links, email-first login and social login |
| [`lumoauth-mfa-passkeys`](skills/lumoauth-mfa-passkeys) | Configure MFA factors, adaptive MFA, passkeys and push authentication |
| [`lumoauth-enterprise-sso`](skills/lumoauth-enterprise-sso) | Connect a customer's identity provider with SAML or OIDC, or act as a SAML identity provider |
| [`lumoauth-scim`](skills/lumoauth-scim) | Provision users and groups with SCIM 2.0, in and out |
| [`lumoauth-branding`](skills/lumoauth-branding) | Brand the hosted login page, set up a custom domain and edit email templates |

### Authorization

| Skill | Use it to |
|---|---|
| [`lumoauth-authorization`](skills/lumoauth-authorization) | Choose an access-control model, use the unified check API and decide where to enforce |
| [`lumoauth-rbac`](skills/lumoauth-rbac) | Design and check roles, permissions and groups |
| [`lumoauth-abac`](skills/lumoauth-abac) | Write and evaluate attribute-based policies |
| [`lumoauth-rebac`](skills/lumoauth-rebac) | Model relationships (Zanzibar): object types, relation tuples, checks and expansion |

### AI agents

| Skill | Use it to |
|---|---|
| [`lumoauth-agent-identity`](skills/lumoauth-agent-identity) | Register an agent, choose its credential, get tokens, check capabilities and budgets, use the Ask API |
| [`lumoauth-aauth`](skills/lumoauth-aauth) | Give an agent a signing key and send or verify signed HTTP requests with the AAuth protocol |
| [`lumoauth-agent-delegation`](skills/lumoauth-agent-delegation) | Let an agent act for a user: token exchange, cross-app access and agent connections |
| [`lumoauth-agent-approvals`](skills/lumoauth-agent-approvals) | Require a person's approval before an agent acts: JIT permissions, push approval, async authorization |
| [`lumoauth-agent-frameworks`](skills/lumoauth-agent-frameworks) | Connect LumoAuth to LangChain, LangGraph, CrewAI, OpenAI Agents SDK, Agno, Google ADK and Microsoft Agent Framework |
| [`lumoauth-agent-governance`](skills/lumoauth-agent-governance) | Review, restrict, suspend and stop agents; shared signals and tracing |

### MCP

| Skill | Use it to |
|---|---|
| [`lumoauth-mcp-server`](skills/lumoauth-mcp-server) | Add OAuth to an MCP server with `lumoauth-fastmcp` or `@lumoauth/mcp`, and authorize each tool call |
| [`lumoauth-mcp-client`](skills/lumoauth-mcp-client) | Call a protected MCP server from an agent or app |

### Operations

| Skill | Use it to |
|---|---|
| [`lumoauth-admin-api`](skills/lumoauth-admin-api) | Automate an organization with the Admin API and the generated API clients; keep configuration as code |
| [`lumoauth-users-sessions`](skills/lumoauth-users-sessions) | Manage users, invitations, sessions and self-service account pages |
| [`lumoauth-b2b-saas`](skills/lumoauth-b2b-saas) | Build a SaaS where each customer company is its own organization |
| [`lumoauth-webhooks`](skills/lumoauth-webhooks) | Receive events: endpoints, signature verification, retries and local testing with `lumo tunnel` |
| [`lumoauth-audit-compliance`](skills/lumoauth-audit-compliance) | Read and export audit logs, handle data requests and choose a data region |
| [`lumoauth-integrations`](skills/lumoauth-integrations) | Connect alerting, approval channels, device posture, risk, SMS, email and key storage providers |
| [`lumoauth-migrate`](skills/lumoauth-migrate) | Move from Auth0, Clerk, Okta, Cognito or Firebase Auth |

## Skill structure

Each skill contains:

- `SKILL.md` - Instructions for the agent
- `references/` - Supporting documentation that the agent opens when it needs it (optional)
- `scripts/` - Helper scripts (optional)
- `assets/` - Files that the agent copies into the project, such as a ready-made auth module (optional)

## Manual installation

Claude Code:

```bash
git clone https://github.com/lumoauth/agent-skills.git
cp -r agent-skills/skills/lumoauth-nextjs ~/.claude/skills/
```

claude.ai: add the skill folder to project knowledge, or paste the contents of its `SKILL.md` into the conversation.

## Development

```bash
npm ci --ignore-scripts
node scripts/validate-skills.mjs
```

The validator checks every skill against the Agent Skills specification and the rules in [AGENTS.md](AGENTS.md): valid frontmatter, a `name` that matches the directory, a `SKILL.md` of 500 lines or fewer, working relative links and an entry in `skills.sh.json`.

## Discovery index

Every change to a skill on `main` publishes a GitHub release with an Agent Skills discovery index and one artifact per skill. Build the same artifacts locally with:

```bash
npm ci --ignore-scripts
node scripts/build-discovery-index.mjs https://example.com/skills
```

## Resources

- Documentation: https://docs.lumoauth.dev
- SDKs and libraries: https://docs.lumoauth.dev/developer/sdks
- API reference: https://docs.lumoauth.dev/api-reference

## License

MIT
