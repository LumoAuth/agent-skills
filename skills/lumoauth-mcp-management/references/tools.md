# Tools of the LumoAuth MCP server

Every tool by area. The tool list of the session has the arguments of each tool and shows
only the tools that the connection may use. The full reference with arguments is at
https://docs.lumoauth.dev/mcp-server/tools.

- **Read**: returns data. Needs **Read** access to the area (`manage:<area>:read`).
- **Add**: adds something new. Needs **Read and change** access (`manage:<area>:write`).
- **Change or delete**: changes or removes something that exists. Needs **Read and change**
  access. Show the call to the user and wait for agreement.

## Every connection

- **Read**: `whoami`

## Users

Scopes: `manage:users:read` to read, `manage:users:write` to change.

- **Read**: `list_users`, `get_user`, `list_user_roles`, `list_user_groups`, `list_user_permissions`, `list_customer_organizations`, `get_customer_organization`
- **Add**: `create_user`, `add_user_role`, `add_user_to_group`, `send_password_reset`
- **Change or delete**: `update_user`, `delete_user`, `block_user`, `unblock_user`, `remove_user_role`, `remove_user_from_group`

## Groups

Scopes: `manage:groups:read` to read, `manage:groups:write` to change.

- **Read**: `list_groups`, `get_group`, `list_group_members`, `list_group_roles`
- **Add**: `create_group`, `add_group_members`, `add_group_role`
- **Change or delete**: `update_group`, `delete_group`, `remove_group_member`, `remove_group_role`

## Roles

Scopes: `manage:roles:read` to read, `manage:roles:write` to change.

- **Read**: `list_roles`, `get_role`, `list_role_permissions`, `list_role_users`
- **Add**: `create_role`, `add_role_permissions`
- **Change or delete**: `update_role`, `delete_role`, `remove_role_permission`

## Permissions and scopes

Scopes: `manage:permissions:read` to read, `manage:permissions:write` to change.

- **Read**: `list_permissions`, `list_scopes`
- **Add**: `create_permission`
- **Change or delete**: `delete_permission`

## Applications

Scopes: `manage:clients:read` to read, `manage:clients:write` to change.

- **Read**: `list_applications`, `get_application`
- **Add**: `create_application`
- **Change or delete**: `update_application`, `delete_application`, `disable_application`, `enable_application`, `rotate_application_secret`

## AI agents and MCP servers

Scopes: `manage:agents:read` to read, `manage:agents:write` to change.

- **Read**: `list_agents`, `get_agent`, `list_mcp_servers`, `get_mcp_server`
- **Add**: `create_agent`, `create_mcp_server`
- **Change or delete**: `update_agent`, `delete_agent`, `deactivate_agent`, `activate_agent`, `rotate_agent_credentials`, `delete_mcp_server`

## Webhooks

Scopes: `manage:webhooks:read` to read, `manage:webhooks:write` to change.

- **Read**: `list_webhooks`, `get_webhook`, `list_webhook_deliveries`
- **Add**: `create_webhook`
- **Change or delete**: `update_webhook`, `delete_webhook`, `disable_webhook`, `enable_webhook`

## Social sign-in providers

Scopes: `manage:social:read`.

- **Read**: `list_social_providers`, `get_social_provider`

## Organization settings

Scopes: `manage:settings:read`.

- **Read**: `get_organization`, `get_settings`, `get_mfa_policy`

## Sessions and tokens

Scopes: `manage:sessions:read` to read, `manage:sessions:write` to change.

- **Read**: `list_sessions`, `list_user_sessions`, `list_tokens`, `get_session_stats`
- **Change or delete**: `revoke_session`, `revoke_user_sessions`, `revoke_user_tokens`

## Audit logs

Scopes: `manage:audit:read`.

- **Read**: `list_audit_logs`, `get_audit_log`, `get_audit_log_stats`, `list_audit_event_types`

## Analytics

Scopes: `manage:analytics:read`.

- **Read**: `get_dashboard_analytics`, `get_login_analytics`

## Access policies

Scopes: `manage:abac:read` to read, `manage:abac:write` to change.

- **Read**: `list_abac_policies`, `get_abac_policy`, `list_abac_attributes`
- **Add**: `create_abac_policy`
- **Change or delete**: `update_abac_policy`, `delete_abac_policy`
