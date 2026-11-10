# Admin API endpoints, permissions and scopes

Open this file to find the endpoint for a task, the scope that an API key or access token
needs, and the permission that the key's creator (or the token's user) must hold.

Paths are relative to `{base}/orgs/{orgId}/api/v1`. Example:
`https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/users`.

- **Scope**: checked on the credential. Matched exactly, per resource. A Bearer token may
  hold the blanket `admin` scope instead.
- **Permission**: checked on the person. Where an endpoint lists more than one, any one
  is enough. A missing permission returns 403 with `details.required_permissions`.

Request and response bodies are documented per resource at
https://docs.lumoauth.dev/api-reference/ (users, groups, roles, permissions, sessions,
webhooks, audit-logs, social-providers, settings, organization, mfa). Read the page of the
resource before you write a body: do not guess field names. The OpenAPI document is
described at https://docs.lumoauth.dev/admin/spec.

## Resource areas

| Area | Path prefix | Scope family |
|---|---|---|
| Users (profile, block, password, roles, groups, direct permissions, identities, authenticators) | `/admin/users` | `admin:users:*` |
| User sessions and tokens | `/admin/users/{userId}/sessions`, `/admin/users/{userId}/tokens` | `admin:sessions:*` |
| Roles | `/admin/roles` | `admin:roles:*` |
| Groups | `/admin/groups` | `admin:groups:*` |
| Permissions and OAuth scopes | `/admin/permissions`, `/admin/scopes` | `admin:permissions:*` |
| OAuth clients (applications) | `/admin/clients` | `admin:clients:*` |
| AI agents | `/admin/agents` | `admin:agents:*` |
| MCP servers | `/admin/mcp/servers` | `admin:agents:*` |
| Webhooks and deliveries | `/admin/webhooks` | `admin:webhooks:*` |
| Audit logs | `/admin/audit-logs` | `admin:audit:read` |
| Sessions and tokens | `/admin/sessions`, `/admin/tokens` | `admin:sessions:*` |
| Settings by area, organization profile | `/admin/settings`, `/admin/organization` | `admin:settings:*` |
| MFA policy, MFA coverage report | `/admin/policies/mfa`, `/admin/reports/mfa-coverage` | `admin:settings:*`, `admin:users:read` |
| Email templates | `/admin/email-templates` | `admin:settings:*` |
| Social login providers | `/admin/social-providers` | `admin:social:*` |
| Customer organizations (B2B), members, invitations | `/admin/organizations` | `admin:users:*` (roles: `admin:roles:*`) |
| Analytics | `/admin/analytics` | `admin:analytics:read` |
| Sandbox organizations | `/admin/sandbox` | `admin:settings:*` |
| ABAC attributes and policies | `/abac/attributes`, `/abac/policies` | `admin:abac:*` |

`/admin/tenant` and `/admin/settings/auth` are older names of `/admin/organization` and
`/admin/settings/authentication`. Use the newer names.


## Users

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/users` | `users.view` | `admin:users:read` |
| GET | `/admin/users/{userId}` | `users.view` | `admin:users:read` |
| POST | `/admin/users` | `users.create` | `admin:users:write` |
| PUT, PATCH | `/admin/users/{userId}` | `users.edit` | `admin:users:write` |
| DELETE | `/admin/users/{userId}` | `users.delete` | `admin:users:write` |
| POST | `/admin/users/{userId}/block` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/unblock` | `users.edit` | `admin:users:write` |
| GET | `/admin/users/{userId}/roles` | `users.view` | `admin:users:read` |
| PUT | `/admin/users/{userId}/roles` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/roles` | `users.edit` | `admin:users:write` |
| DELETE | `/admin/users/{userId}/roles/{roleId}` | `users.edit` | `admin:users:write` |
| GET | `/admin/users/{userId}/groups` | `users.view` | `admin:users:read` |
| PUT | `/admin/users/{userId}/groups` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/groups` | `users.edit` | `admin:users:write` |
| DELETE | `/admin/users/{userId}/groups/{groupId}` | `users.edit` | `admin:users:write` |
| GET | `/admin/users/{userId}/permissions` | `users.view` | `admin:users:read` |
| POST | `/admin/users/{userId}/permissions` | `users.edit` | `admin:users:write` |
| DELETE | `/admin/users/{userId}/permissions/{permissionId}` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/verify-email` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/mark-verified` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/password-reset` | `users.edit` | `admin:users:write` |
| PUT, POST | `/admin/users/{userId}/password` | `users.edit` | `admin:users:write` |

## Federated identities

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/users/{userId}/identities` | `users.view` | `admin:users:read` |
| POST | `/admin/users/{userId}/identities` | `users.edit` | `admin:users:write` |
| DELETE | `/admin/users/{userId}/identities/{type}` | `users.edit` | `admin:users:write` |
| GET | `/admin/identities/legacy-saml` | `users.view` | `admin:users:read` |
| POST | `/admin/identities/legacy-saml` | `users.edit` | `admin:users:write` |

`{type}` is `saml`, `ldap` or `social`. A link change signs the user out everywhere.

## MFA (admin)

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/users/{userId}/authenticators` | `users.view` | `admin:users:read` |
| DELETE | `/admin/users/{userId}/authenticators/{authenticatorId}` | `users.edit` | `admin:users:write` |
| POST | `/admin/users/{userId}/temporary-access-code` | `users.edit` | `admin:users:write` |
| GET | `/admin/policies/mfa` | `settings.view` | `admin:settings:read` |
| PUT | `/admin/policies/mfa` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/reports/mfa-coverage` | `users.view` | `admin:users:read` |

## Sessions and tokens

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/sessions` | `users.view` | `admin:sessions:read` |
| GET | `/admin/users/{userId}/sessions` | `users.view` | `admin:sessions:read` |
| DELETE | `/admin/sessions/{sessionId}` | `users.edit` | `admin:sessions:write` |
| DELETE | `/admin/users/{userId}/sessions` | `users.edit` | `admin:sessions:write` |
| GET | `/admin/tokens` | `users.view` | `admin:sessions:read` |
| DELETE | `/admin/tokens/{tokenId}` | `users.edit` | `admin:sessions:write` |
| DELETE | `/admin/users/{userId}/tokens` | `users.edit` | `admin:sessions:write` |
| POST | `/admin/users/{userId}/sessions/revoke` | `users.edit` | `admin:sessions:write` |
| POST | `/admin/sessions/revoke-all` | `users.edit` | `admin:sessions:write` |
| POST | `/admin/users/{userId}/tokens/revoke` | `users.edit` | `admin:sessions:write` |
| POST | `/admin/clients/{clientId}/tokens/revoke` | `clients.edit` | `admin:sessions:write` |
| DELETE | `/admin/clients/{clientId}/tokens` | `clients.edit` | `admin:sessions:write` |
| GET | `/admin/sessions/stats` | `users.view` | `admin:sessions:read` |
| GET | `/admin/sessions/count` | `users.view` | `admin:sessions:read` |

## Roles

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/roles` | `roles.view` | `admin:roles:read` |
| GET | `/admin/roles/{roleId}` | `roles.view` | `admin:roles:read` |
| POST | `/admin/roles` | `roles.create` | `admin:roles:write` |
| PUT, PATCH | `/admin/roles/{roleId}` | `roles.edit` | `admin:roles:write` |
| DELETE | `/admin/roles/{roleId}` | `roles.delete` | `admin:roles:write` |
| GET | `/admin/roles/{roleId}/permissions` | `roles.view` | `admin:roles:read` |
| PUT | `/admin/roles/{roleId}/permissions` | `roles.assign-permissions` | `admin:roles:write` |
| POST | `/admin/roles/{roleId}/permissions` | `roles.assign-permissions` | `admin:roles:write` |
| DELETE | `/admin/roles/{roleId}/permissions/{permissionId}` | `roles.assign-permissions` | `admin:roles:write` |
| GET | `/admin/roles/{roleId}/users` | `roles.view` | `admin:roles:read` |
| POST | `/admin/roles/{roleId}/users` | `roles.edit` | `admin:roles:write` |
| DELETE | `/admin/roles/{roleId}/users/{userId}` | `roles.edit` | `admin:roles:write` |

## Groups

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/groups` | `groups.view` | `admin:groups:read` |
| GET | `/admin/groups/{groupId}` | `groups.view` | `admin:groups:read` |
| POST | `/admin/groups` | `groups.create` | `admin:groups:write` |
| PUT, PATCH | `/admin/groups/{groupId}` | `groups.edit` | `admin:groups:write` |
| DELETE | `/admin/groups/{groupId}` | `groups.delete` | `admin:groups:write` |
| GET | `/admin/groups/{groupId}/members` | `groups.view` | `admin:groups:read` |
| POST | `/admin/groups/{groupId}/members` | `groups.edit` | `admin:groups:write` |
| DELETE | `/admin/groups/{groupId}/members/{userId}` | `groups.edit` | `admin:groups:write` |
| GET | `/admin/groups/{groupId}/roles` | `groups.view` | `admin:groups:read` |
| POST | `/admin/groups/{groupId}/roles` | `groups.edit` | `admin:groups:write` |
| DELETE | `/admin/groups/{groupId}/roles/{roleId}` | `groups.edit` | `admin:groups:write` |
| PUT | `/admin/groups/{groupId}/roles` | `groups.edit` | `admin:groups:write` |

## Permissions and OAuth scopes

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/permissions` | `roles.view` | `admin:permissions:read` |
| GET | `/admin/permissions/{permissionId}` | `roles.view` | `admin:permissions:read` |
| POST | `/admin/permissions` | `roles.assign-permissions` | `admin:permissions:write` |
| PATCH | `/admin/permissions/{permissionId}` | `roles.assign-permissions` | `admin:permissions:write` |
| DELETE | `/admin/permissions/{permissionId}` | `roles.assign-permissions` | `admin:permissions:write` |
| GET | `/admin/permissions/{permissionId}/usage` | `roles.view` | `admin:permissions:read` |
| GET | `/admin/scopes` | `roles.view` | `admin:permissions:read` |
| POST | `/admin/scopes` | `roles.assign-permissions` | `admin:permissions:write` |
| DELETE | `/admin/scopes/{scopeId}` | `roles.assign-permissions` | `admin:permissions:write` |

## OAuth clients

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/clients` | `clients.view` | `admin:clients:read` |
| GET | `/admin/clients/{clientId}` | `clients.view` | `admin:clients:read` |
| POST | `/admin/clients` | `clients.create` | `admin:clients:write` |
| PUT, PATCH | `/admin/clients/{clientId}` | `clients.edit` | `admin:clients:write` |
| DELETE | `/admin/clients/{clientId}` | `clients.delete` | `admin:clients:write` |
| POST | `/admin/clients/{clientId}/enable` | `clients.edit` | `admin:clients:write` |
| POST | `/admin/clients/{clientId}/disable` | `clients.edit` | `admin:clients:write` |
| GET | `/admin/clients/{clientId}/scopes` | `clients.view` | `admin:clients:read` |
| PUT | `/admin/clients/{clientId}/scopes` | `clients.edit` | `admin:clients:write` |
| POST | `/admin/clients/{clientId}/rotate-secret` | `clients.rotate-secret` | `admin:clients:write` |
| GET | `/admin/clients/{clientId}/branding` | `branding.view` | `admin:clients:read` |
| PUT, PATCH | `/admin/clients/{clientId}/branding` | `branding.edit` | `admin:clients:write` |

## Customer organizations

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/organizations` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations` | `organizations.create` | `admin:users:write` |
| GET | `/admin/organizations/{organizationId}` | `organizations.view` | `admin:users:read` |
| PUT, PATCH | `/admin/organizations/{organizationId}` | `organizations.edit` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}` | `organizations.delete` | `admin:users:write` |
| GET | `/admin/organizations/{organizationId}/members` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations/{organizationId}/members` | `organizations.members.manage` | `admin:users:write` |
| PUT, PATCH | `/admin/organizations/{organizationId}/members/{userId}` | `organizations.members.manage` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}/members/{userId}` | `organizations.members.manage` | `admin:users:write` |
| GET | `/admin/organizations/{organizationId}/roles` | `organizations.view` | `admin:roles:read` |
| POST | `/admin/organizations/{organizationId}/roles` | `organizations.edit` | `admin:roles:write` |
| PUT, PATCH | `/admin/organizations/{organizationId}/roles/{roleId}` | `organizations.edit` | `admin:roles:write` |
| DELETE | `/admin/organizations/{organizationId}/roles/{roleId}` | `organizations.edit` | `admin:roles:write` |
| GET | `/admin/organizations/{organizationId}/invitations` | `organizations.view` | `admin:users:read` |
| POST | `/admin/organizations/{organizationId}/invitations` | `organizations.invitations.manage` | `admin:users:write` |
| DELETE | `/admin/organizations/{organizationId}/invitations/{invId}` | `organizations.invitations.manage` | `admin:users:write` |
| POST | `/admin/organizations/{organizationId}/invitations/{invId}/resend` | `organizations.invitations.manage` | `admin:users:write` |

## Social providers

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/social-providers` | `idps.view` | `admin:social:read` |
| GET | `/admin/social-providers/available` | `idps.view` | `admin:social:read` |
| GET | `/admin/social-providers/types` | `idps.view` | `admin:social:read` |
| GET | `/admin/social-providers/callback-urls` | `idps.view` | `admin:social:read` |
| GET | `/admin/social-providers/{providerId}` | `idps.view` | `admin:social:read` |
| POST | `/admin/social-providers` | `idps.create` | `admin:social:write` |
| PUT, PATCH | `/admin/social-providers/{providerId}` | `idps.edit` | `admin:social:write` |
| DELETE | `/admin/social-providers/{providerId}` | `idps.delete` | `admin:social:write` |
| POST | `/admin/social-providers/{providerId}/enable` | `idps.edit` | `admin:social:write` |
| POST | `/admin/social-providers/{providerId}/disable` | `idps.edit` | `admin:social:write` |

## Webhooks

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/webhooks` | `webhooks.view` | `admin:webhooks:read` |
| GET | `/admin/webhooks/events` | `webhooks.view` | `admin:webhooks:read` |
| GET | `/admin/webhooks/{webhookId}` | `webhooks.view` | `admin:webhooks:read` |
| POST | `/admin/webhooks` | `webhooks.create` | `admin:webhooks:write` |
| PUT, PATCH | `/admin/webhooks/{webhookId}` | `webhooks.edit` | `admin:webhooks:write` |
| POST | `/admin/webhooks/{webhookId}/enable` | `webhooks.edit` | `admin:webhooks:write` |
| POST | `/admin/webhooks/{webhookId}/disable` | `webhooks.edit` | `admin:webhooks:write` |
| DELETE | `/admin/webhooks/{webhookId}` | `webhooks.delete` | `admin:webhooks:write` |
| POST | `/admin/webhooks/{webhookId}/test` | `webhooks.edit` | `admin:webhooks:write` |
| POST | `/admin/webhooks/{webhookId}/rotate-secret` | `webhooks.edit` | `admin:webhooks:write` |
| GET | `/admin/webhooks/{webhookId}/deliveries` | `webhooks.view` | `admin:webhooks:read` |
| GET | `/admin/webhooks/{webhookId}/deliveries/{deliveryId}` | `webhooks.view` | `admin:webhooks:read` |
| POST | `/admin/webhooks/{webhookId}/deliveries/{deliveryId}/replay` | `webhooks.edit` | `admin:webhooks:write` |
| POST | `/admin/webhooks/tunnel/start` | `webhooks.create` | `admin:webhooks:write` |
| POST | `/admin/webhooks/tunnel/{webhookId}/stop` | `webhooks.edit` | `admin:webhooks:write` |
| GET | `/admin/webhooks/tunnel/{webhookId}/stream` | `webhooks.view` | `admin:webhooks:read` |

## Audit logs

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/audit-logs` | `audit.view` | `admin:audit:read` |
| GET | `/admin/audit-logs/{logId}` | `audit.view` | `admin:audit:read` |
| GET | `/admin/audit-logs/stats` | `audit.view` | `admin:audit:read` |
| GET | `/admin/audit-logs/actions` | `audit.view` | `admin:audit:read` |
| GET | `/admin/audit-logs/retention` | `audit.view` | `admin:audit:read` |
| PUT, PATCH | `/admin/audit-logs/retention` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/audit-logs/export` | `audit.export` | `admin:audit:read` |

## Settings, analytics and organization

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/settings` | `settings.view` | `admin:settings:read` |
| GET | `/admin/settings/general` | `settings.view` | `admin:settings:read` |
| PATCH, PUT | `/admin/settings/general` | `settings.edit` | `admin:settings:write` |
| GET | `/admin/settings/authentication` | `settings.view` | `admin:settings:read` |
| PATCH, PUT | `/admin/settings/authentication` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/settings/security` | `settings.view` | `admin:settings:read` |
| PATCH, PUT | `/admin/settings/security` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/settings/email` | `settings.view` | `admin:settings:read` |
| PATCH, PUT | `/admin/settings/email` | `settings.edit` | `admin:settings:write` |
| GET | `/admin/organization` | `settings.view` | `admin:settings:read` |
| PUT, PATCH | `/admin/organization` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/settings/branding` | `branding.view` | `admin:settings:read` |
| PUT, PATCH | `/admin/settings/branding` | `branding.edit` | `admin:settings:write` |
| GET | `/admin/settings/scim` | `scim.view` | `admin:settings:read` |
| PUT, PATCH | `/admin/settings/scim` | `scim.edit` | `admin:settings:write` |
| GET | `/admin/analytics/dashboard` | `analytics.view` | `admin:analytics:read` |
| GET | `/admin/analytics/logins` | `analytics.view` | `admin:analytics:read` |
| GET | `/admin/analytics/users` | `analytics.view` | `admin:analytics:read` |

## Email templates

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/email-templates` | `settings.view` | `admin:settings:read` |
| GET | `/admin/email-templates/{type}` | `settings.view` | `admin:settings:read` |
| PUT | `/admin/email-templates/{type}` | `settings.edit` | `admin:settings:write` |
| DELETE | `/admin/email-templates/{type}` | `settings.edit` | `admin:settings:write` |
| POST | `/admin/email-templates/{type}/preview` | `settings.edit` | `admin:settings:write` |
| GET | `/admin/email-templates/{type}/variables` | `settings.view` | `admin:settings:read` |

## Sandboxes

| Method | Path | Permission | Scope |
|---|---|---|---|
| POST | `/admin/sandbox/spawn` | `settings.manage` | `admin:settings:write` |
| GET | `/admin/sandbox` | `settings.view` | `admin:settings:read` |
| POST | `/admin/sandbox/{sandboxSlug}/destroy` | `settings.manage` | `admin:settings:write` |

## AI agents

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/agents` | `agents.view` | `admin:agents:read` |
| GET | `/admin/agents/{agentId}` | `agents.view` | `admin:agents:read` |
| POST | `/admin/agents` | `agents.create` | `admin:agents:write` |
| PUT, PATCH | `/admin/agents/{agentId}` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/rotate-key` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/enable` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/disable` | `agents.edit` | `admin:agents:write` |
| DELETE | `/admin/agents/{agentId}` | `agents.delete` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/revoke-key` | `agents.edit` | `admin:agents:write` |
| GET | `/admin/agents/{agentId}/scopes` | `agents.view` | `admin:agents:read` |
| PUT | `/admin/agents/{agentId}/scopes` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/rotate-credentials` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/activate` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/deactivate` | `agents.edit` | `admin:agents:write` |
| POST | `/admin/agents/{agentId}/token` | `agents.edit` | `admin:agents:write` |

## MCP servers

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/admin/mcp/servers` | `agents.view` | `admin:agents:read` |
| POST | `/admin/mcp/servers` | `agents.create` | `admin:agents:write` |
| GET | `/admin/mcp/servers/{serverId}` | `agents.view` | `admin:agents:read` |
| DELETE | `/admin/mcp/servers/{serverId}` | `agents.delete` | `admin:agents:write` |

## ABAC attributes

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/abac/attributes` | `abac.view` | `admin:abac:read` |
| GET | `/abac/attributes/{id}` | `abac.view` | `admin:abac:read` |
| POST | `/abac/attributes` | `abac.manage` | `admin:abac:write` |
| PUT, PATCH | `/abac/attributes/{id}` | `abac.manage` | `admin:abac:write` |
| DELETE | `/abac/attributes/{id}` | `abac.manage` | `admin:abac:write` |

## ABAC policies

| Method | Path | Permission | Scope |
|---|---|---|---|
| GET | `/abac/policies` | `abac.view` | `admin:abac:read` |
| GET | `/abac/policies/{id}` | `abac.view` | `admin:abac:read` |
| POST | `/abac/policies` | `abac.manage` | `admin:abac:write` |
| PUT, PATCH | `/abac/policies/{id}` | `abac.manage` | `admin:abac:write` |
| DELETE | `/abac/policies/{id}` | `abac.manage` | `admin:abac:write` |
| POST | `/abac/policies/{id}/toggle` | `abac.manage` | `admin:abac:write` |

## Notes

- `POST /admin/users/{userId}/mfa/reset` is removed. Use the authenticator and temporary
  access code endpoints.
- The ABAC routes are outside `/admin/` but follow the same rules.
- Some user actions give control of another account: set password, change email, activate,
  deactivate, block, delete, remove an authenticator, issue a temporary access code. They
  succeed only when the caller holds every permission that the target user holds.
  Otherwise the answer is 403.
- MCP servers can be created, read and deleted through the API, not edited.
- Signing keys are managed in the portal; there is no Admin API for them.
- `/orgs/{orgId}/api/v1/me` is not part of the Admin API. It takes an OAuth access token,
  not an API key.
- Dynamic client registration (`POST /orgs/{orgId}/api/v1/connect/register`) takes an API
  key with `admin:clients:register`.
- The authorization decision endpoints (`/api/v1/authz/...`,
  `/orgs/{orgId}/api/v1/zanzibar/...`) take an API key with the scope `authz:check`. Use
  the `lumoauth-authorization` skill for them.
