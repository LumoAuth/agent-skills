<div align="center">

<a href="https://lumoauth.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://docs.lumoauth.dev/img/lumoauth-logo-horizontal-reversed.svg">
    <img src="https://docs.lumoauth.dev/img/lumoauth-logo-horizontal.svg" alt="LumoAuth" height="36">
  </picture>
</a>

# LumoAuth Agent Skills

**Teach your coding agent to add sign-in, access control and agent identity with LumoAuth.**<br>
45 skills for Claude Code, Cursor, Codex, GitHub Copilot and every other agent that supports Agent Skills.

[![Skills: 45](https://img.shields.io/badge/skills-45-111)](#skills)
[![Format: Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-111)](https://agentskills.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

[Quick start](#quick-start) · [What you can ask](#what-you-can-ask) · [Install](#install) · [Skills](#skills) · [Contributing](#contributing) · [Docs](https://docs.lumoauth.dev)

</div>

---

## Quick start

**1. Install the skills** in your project:

```bash
npx skills add lumoauth/agent-skills
```

**2. Ask your agent** for the change in plain words:

```text
Add LumoAuth sign-in to this Next.js app
```

**3. Answer its questions.** The agent looks in your project for the organization slug, the client ID and other values. It asks you for each value that it cannot find.

No organization yet? [Sign up at app.lumoauth.dev](https://app.lumoauth.dev/register). The slug that you choose there is the one that the agent asks for.

## What you can ask

You never need to name a skill. Your agent reads the task and loads the skill that fits.

| Ask your agent | Skill that it loads |
|---|---|
| Add LumoAuth sign-in to this Next.js app | [`lumoauth-nextjs`](skills/lumoauth-nextjs) |
| Only users with the `reports.read` permission may call this FastAPI route | [`lumoauth-fastapi`](skills/lumoauth-fastapi) |
| Turn on passkeys and require MFA for administrators | [`lumoauth-mfa-passkeys`](skills/lumoauth-mfa-passkeys) |
| Let our customers sign in with their company's Okta | [`lumoauth-enterprise-sso`](skills/lumoauth-enterprise-sso) |
| Make the agent ask for approval on my phone before it sends a payment | [`lumoauth-agent-approvals`](skills/lumoauth-agent-approvals) |
| Add LumoAuth to the tool calls of this LangGraph agent | [`lumoauth-agent-frameworks`](skills/lumoauth-agent-frameworks) |
| Protect this FastMCP server with LumoAuth | [`lumoauth-mcp-server`](skills/lumoauth-mcp-server) |
| Create an application in my LumoAuth organization for this app and store the client ID | [`lumoauth-mcp-management`](skills/lumoauth-mcp-management) |
| Verify LumoAuth webhooks in this Express app | [`lumoauth-webhooks`](skills/lumoauth-webhooks) |
| Move our users from Auth0 to LumoAuth | [`lumoauth-migrate`](skills/lumoauth-migrate) |

> [!TIP]
> Not sure where to begin? Ask your agent to **use `lumoauth-getting-started`**. It collects the values that every integration needs, checks your organization and points to the right skill for the task.

## Connect your organization

The skills teach your agent how LumoAuth works. The **LumoAuth MCP server** lets the agent act in your organization: create an application, add a user, register an AI agent or read the audit log, with no API key. Add it once:

| Agent | Run |
|---|---|
| Claude Code | `claude mcp add --transport http lumoauth https://app.lumoauth.dev/mcp`, then `/mcp` |
| Codex | `codex mcp add lumoauth --url https://app.lumoauth.dev/mcp`, then `codex mcp login lumoauth` |
| opencode | `opencode mcp add lumoauth --url https://app.lumoauth.dev/mcp`, then `opencode mcp auth lumoauth` |

For an organization in the EU region, use `https://eu.app.lumoauth.dev/mcp`. You sign in to your organization in the browser and choose what the agent may read and change. The [`lumoauth-mcp-management`](skills/lumoauth-mcp-management) skill has the steps for Cursor, VS Code and Claude on the web, and the [documentation](https://docs.lumoauth.dev/mcp-server) lists every tool.

In Claude Code you can install the skills and the MCP server together as one plugin:

```text
/plugin install lumoauth --marketplace lumoauth/agent-skills
```

The plugin asks for the MCP address of your region. The default is the US region.

## How the skills work with you

- **They ask, and never guess.** The agent reads `.env` and config files first. It asks you for any slug, client ID or key that is missing.
- **They show a change before making it.** The agent shows you each command that creates, changes or deletes something in your organization, before it runs the command.
- **They keep secrets on the server.** Client secrets, API keys and agent secrets come from environment variables. They never go into browser or mobile code.
- **They end with a check.** Each skill tells the agent how to prove that the change works.
- **They follow the source code.** Package names, functions, endpoints and CLI flags come from the LumoAuth SDK and CLI source, not from memory.

## Install

| To | Run |
|---|---|
| Install every skill in this project | `npx skills add lumoauth/agent-skills` |
| Install one skill | `npx skills add lumoauth/agent-skills --skill lumoauth-nextjs` |
| Install for all your projects | `npx skills add lumoauth/agent-skills -g` |
| Install for Claude Code only | `npx skills add lumoauth/agent-skills -a claude-code` |
| Update the installed skills | `npx skills update` |

Installing all 45 skills is cheap. At startup your agent reads only the name and the description of each skill. It loads the full instructions when a task matches, and it opens the reference files only when it needs them.

<details>
<summary><b>Install without the skills CLI</b></summary>

<br>

Claude Code:

```bash
git clone https://github.com/lumoauth/agent-skills.git
cp -r agent-skills/skills/lumoauth-nextjs ~/.claude/skills/
```

claude.ai: add the skill folder to project knowledge, or paste the contents of its `SKILL.md` into the conversation.

</details>

## Skills

[Getting started](#getting-started) · [Web and mobile apps](#web-and-mobile-apps) · [Backends and APIs](#backends-and-apis) · [OAuth and OpenID Connect](#oauth-and-openid-connect) · [Sign-in features](#sign-in-features) · [Authorization](#authorization) · [AI agents](#ai-agents) · [MCP](#mcp) · [Operations](#operations)

### Getting started

Orientation for a new LumoAuth organization and the `lumo` command line.

| Skill | Use it to |
|---|---|
| [`lumoauth-getting-started`](skills/lumoauth-getting-started) | Understand organizations, regions, URLs and credentials, choose the SDK package, scaffold an app with `lumo init` and find the next skill |
| [`lumoauth-cli`](skills/lumoauth-cli) | Install and use the `lumo` command line: login, profiles, every resource command, JSON output, sandboxes, raw API access |

### Web and mobile apps

Add sign-in, sessions and access control to browser and mobile apps.

| Skill | Use it to |
|---|---|
| [`lumoauth-nextjs`](skills/lumoauth-nextjs) | Add sign-in, sessions, route protection, a themed profile page and permission checks to Next.js with `@lumoauth/nextjs` |
| [`lumoauth-react`](skills/lumoauth-react) | Add sign-in components, hooks and `<Protect>` to a React single-page app with `@lumoauth/react` |
| [`lumoauth-vue`](skills/lumoauth-vue) | Add PKCE sign-in, router guards and permission checks to Vue 3 with `@lumoauth/client` |
| [`lumoauth-angular`](skills/lumoauth-angular) | Add a sign-in service, route guards and an HTTP interceptor to Angular with `@lumoauth/client` |
| [`lumoauth-react-native`](skills/lumoauth-react-native) | Sign users in from React Native and Expo apps with `@lumoauth/client`: PKCE, deep links and secure storage |

### Backends and APIs

Sign users in on the server and check access in Node.js, Python, Go, .NET, Java and PHP.

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

Use LumoAuth with any standard library, harden the flows and protect APIs.

| Skill | Use it to |
|---|---|
| [`lumoauth-oauth-oidc`](skills/lumoauth-oauth-oidc) | Connect any standard OAuth 2.0 or OpenID Connect library: discovery, authorization code with PKCE, tokens, refresh, userinfo, logout, client registration |
| [`lumoauth-oauth-advanced`](skills/lumoauth-oauth-advanced) | Use PAR, DPoP, FAPI 2.0, resource indicators, CIBA, device authorization, client attestation, introspection and revocation |
| [`lumoauth-api-protection`](skills/lumoauth-api-protection) | Protect an API in any language: validate access tokens, use client credentials for machine-to-machine calls, choose between API keys and tokens |

### Sign-in features

Configure how people sign in: passwords, magic links, social login, MFA, passkeys, enterprise SSO, SCIM and branding.

| Skill | Use it to |
|---|---|
| [`lumoauth-login-methods`](skills/lumoauth-login-methods) | Configure email and password, magic links, email-first login and social login |
| [`lumoauth-mfa-passkeys`](skills/lumoauth-mfa-passkeys) | Configure MFA factors, adaptive MFA, passkeys and push authentication |
| [`lumoauth-enterprise-sso`](skills/lumoauth-enterprise-sso) | Connect a customer's identity provider with SAML or OIDC, or act as a SAML identity provider |
| [`lumoauth-scim`](skills/lumoauth-scim) | Provision users and groups with SCIM 2.0, in and out |
| [`lumoauth-branding`](skills/lumoauth-branding) | Brand the hosted login page, set up a custom domain and edit email templates |

### Authorization

Roles, attribute rules and relationships behind one check.

| Skill | Use it to |
|---|---|
| [`lumoauth-authorization`](skills/lumoauth-authorization) | Choose an access-control model, use the unified check API and decide where to enforce |
| [`lumoauth-rbac`](skills/lumoauth-rbac) | Design and check roles, permissions and groups |
| [`lumoauth-abac`](skills/lumoauth-abac) | Write and evaluate attribute-based policies |
| [`lumoauth-rebac`](skills/lumoauth-rebac) | Model relationships (Zanzibar): object types, relation tuples, checks and expansion |

### AI agents

Give an agent its own identity, let it act for a user, ask a person for approval and keep it under control.

| Skill | Use it to |
|---|---|
| [`lumoauth-agent-identity`](skills/lumoauth-agent-identity) | Register an agent, choose its credential, get tokens, check capabilities and budgets, use the Ask API |
| [`lumoauth-aauth`](skills/lumoauth-aauth) | Give an agent a signing key and send or verify signed HTTP requests with the AAuth protocol |
| [`lumoauth-agent-delegation`](skills/lumoauth-agent-delegation) | Let an agent act for a user: token exchange, cross-app access and agent connections |
| [`lumoauth-agent-approvals`](skills/lumoauth-agent-approvals) | Require a person's approval before an agent acts: JIT permissions, push approval, async authorization |
| [`lumoauth-agent-frameworks`](skills/lumoauth-agent-frameworks) | Connect LumoAuth to LangChain, LangGraph, CrewAI, OpenAI Agents SDK, Agno, Google ADK and Microsoft Agent Framework |
| [`lumoauth-agent-governance`](skills/lumoauth-agent-governance) | Review, restrict, suspend and stop agents; shared signals and tracing |

### MCP

Add OAuth to an MCP server, call a protected MCP server, and manage your organization through the LumoAuth MCP server.

| Skill | Use it to |
|---|---|
| [`lumoauth-mcp-server`](skills/lumoauth-mcp-server) | Add OAuth to an MCP server with `lumoauth-fastmcp` or `@lumoauth/mcp`, and authorize each tool call |
| [`lumoauth-mcp-client`](skills/lumoauth-mcp-client) | Call a protected MCP server from an agent or app |
| [`lumoauth-mcp-management`](skills/lumoauth-mcp-management) | Connect the LumoAuth MCP server to your agent and manage users, applications, AI agents and more with tool calls |

### Operations

Run an organization: the Admin API, users and sessions, customer organizations, webhooks, audit logs, integrations and migrations.

| Skill | Use it to |
|---|---|
| [`lumoauth-admin-api`](skills/lumoauth-admin-api) | Automate an organization with the Admin API and the generated API clients; keep configuration as code |
| [`lumoauth-users-sessions`](skills/lumoauth-users-sessions) | Manage users, invitations, sessions and self-service account pages |
| [`lumoauth-b2b-saas`](skills/lumoauth-b2b-saas) | Build a SaaS where each customer company is its own organization |
| [`lumoauth-webhooks`](skills/lumoauth-webhooks) | Receive events: endpoints, signature verification, retries and local testing with `lumo tunnel` |
| [`lumoauth-audit-compliance`](skills/lumoauth-audit-compliance) | Read and export audit logs, handle data requests and choose a data region |
| [`lumoauth-integrations`](skills/lumoauth-integrations) | Connect alerting, approval channels, device posture, risk, SMS, email and key storage providers |
| [`lumoauth-migrate`](skills/lumoauth-migrate) | Move from Auth0, Clerk, Okta, Cognito or Firebase Auth |

## Inside a skill

Each skill is a folder in the [Agent Skills](https://agentskills.io/) format:

```text
skills/lumoauth-getting-started/
├── SKILL.md       instructions that the agent follows
├── references/    detail that the agent opens only when it needs it
├── scripts/       helper scripts that the agent can run
└── assets/        files that the agent copies into your project
```

Only `SKILL.md` is required. A skill adds the other folders when it needs them.

## Contributing

Read [AGENTS.md](AGENTS.md) before you add or change a skill. It holds the format, the naming rules and the rules for accuracy and content.

Run the checks before you open a pull request:

```bash
npm ci --ignore-scripts
npm run validate
```

The validator checks each skill against the Agent Skills specification and the rules in AGENTS.md:

- valid frontmatter, with a `name` that matches the folder
- a `SKILL.md` of 500 lines or fewer
- relative links that point to existing files
- an entry in `skills.sh.json`, which sets the groups on skills.sh

To build the discovery index and one archive per skill into `dist/`:

```bash
node scripts/build-discovery-index.mjs https://example.com/skills
```

## Resources

- [LumoAuth documentation](https://docs.lumoauth.dev)
- [SDKs and libraries](https://docs.lumoauth.dev/developer/sdks)
- [API reference](https://docs.lumoauth.dev/api-reference)
- [The `lumo` command line](https://github.com/LumoAuth/cli)
- [Agent Skills specification](https://agentskills.io/)

## License

[MIT](LICENSE)
