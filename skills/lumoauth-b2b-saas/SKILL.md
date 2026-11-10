---
name: lumoauth-b2b-saas
description: >-
  Builds a multi-customer (B2B, multi-tenant) SaaS on LumoAuth where each customer company is
  its own unit. Explains the model (one LumoAuth organization that the SaaS vendor owns, with
  customer organizations inside it), creates and manages customer organizations, members,
  member roles and invitations through the portal and the Admin API (/admin/organizations),
  and covers the customer portal, the org_id, org_slug, org_name and org_role token claims,
  the organization parameter and organization selector at sign-in, switching organization,
  tenant isolation in the app's data layer, and where per-customer SSO (SAML, OIDC), SCIM and
  branding are configured. Use when the user asks for workspaces, teams, tenants, customer
  accounts, per-customer roles or admins, inviting teammates, an organization switcher, or
  enterprise onboarding. Not for the vendor's own users (lumoauth-users-sessions), SAML or
  OIDC setup (lumoauth-enterprise-sso) or SCIM setup (lumoauth-scim).
license: MIT
metadata:
  author: lumoauth
  version: "1.0.0"
---

# LumoAuth for multi-customer SaaS

Model each customer company of a SaaS as a customer organization in LumoAuth, manage its members and roles, and carry the customer organization from sign-in into the app's data layer.

## When to use

- The app serves several customer companies, teams or workspaces and must keep their data apart.
- The app needs "invite a teammate", per-workspace roles (owner, admin, member) or an organization switcher.
- A customer asks for its own SSO connection or directory sync.

Do not use this skill for:

- Users of the organization in general (create, block, sessions): use `lumoauth-users-sessions`.
- Setting up a SAML or OIDC identity provider: use `lumoauth-enterprise-sso`.
- Setting up SCIM: use `lumoauth-scim`.
- Organization-wide roles and permissions: use `lumoauth-rbac`.
- Login page and email branding: use `lumoauth-branding`.

## The model

Two different things are called "organization". Keep them apart in code and in conversation.

| Term | What it is | Identifier |
|---|---|---|
| **Organization** (the LumoAuth organization) | The SaaS vendor's isolated LumoAuth environment. It holds all users, applications, identity providers, settings, signing keys and the audit log. | The slug in every URL: `/orgs/{orgId}/...`, for example `acme-corp` |
| **Customer organization** | A company, team or workspace that the product serves. It exists inside the organization and has its own members, member roles and invitations. | A UUID (`id`) and a slug, for example `globex` |

Facts that follow from this model:

- A user is an account in the LumoAuth organization. A user can be a member of zero, one or several customer organizations, with one role in each.
- A new customer organization starts with three system roles: `owner`, `admin` and `member` (the default). More roles can be added per customer organization.
- A member role is a name and a slug. It carries no permission list in LumoAuth. The app maps the role slug to what the member can do.
- A membership has a status: `active` or `suspended`. A customer organization is active or deactivated. A suspended membership or a deactivated customer organization grants nothing.
- Identity providers (SAML, OIDC), SCIM, branding, MFA policy and the audit log are settings of the LumoAuth organization. A customer organization has no SSO, SCIM or branding settings of its own. See "Per-customer SSO, SCIM and branding" below.

A product that needs full isolation per customer (separate users, signing keys, audit log, sign-in settings, custom domain) can give each customer a separate LumoAuth organization instead. This skill covers customer organizations inside one LumoAuth organization, which is what the Admin API in this skill creates.

## Before you start

Ask the user for a value that you cannot find. Do not guess one.

| Value | Where it comes from |
|---|---|
| Base URL | `https://app.lumoauth.dev` (US) or `https://eu.app.lumoauth.dev` (EU) |
| Organization slug (`{orgId}`) | The portal URL: `/orgs/acme-corp/portal/` |
| Admin API key | Portal page `/orgs/{orgId}/portal/settings/api-keys`. Scopes: `admin:users:read` and `admin:users:write` for customer organizations, members and invitations; `admin:roles:read` and `admin:roles:write` for member roles. |
| The app's record of each customer | The app's own database. Store the customer organization `id` on it. |

The creator of the API key must hold the matching permissions: `organizations.view`, `organizations.create`, `organizations.edit`, `organizations.delete`, `organizations.members.manage`, `organizations.invitations.manage`.

Availability of customer organizations and of the Admin API depends on the organization's plan (see https://docs.lumoauth.dev/pricing-matrix).

The API key manages every customer. Keep it on the server. Show the user every command that creates, changes or deletes something before you run it.

## Where each task is done

| Task | Portal | Admin API |
|---|---|---|
| Create, edit, deactivate, delete a customer organization | `/orgs/{orgId}/portal/organizations` (**Identity → Customer organizations**) | `/admin/organizations` |
| Invite a person by email | **Invite member** on the customer organization's page | `POST /admin/organizations/{organizationId}/invitations` |
| Add an existing user directly | Customer portal | `POST /admin/organizations/{organizationId}/members` |
| Change a member's role, suspend a member | Customer portal | `PATCH /admin/organizations/{organizationId}/members/{userId}` |
| Remove a member | **Members** tab, **Remove** | `DELETE /admin/organizations/{organizationId}/members/{userId}` |
| Create or edit member roles | Customer portal (the admin portal lists roles read-only) | `/admin/organizations/{organizationId}/roles` |
| Limit an application to members | **Who can sign in** on the application | See `lumoauth-oauth-oidc` |

All Admin API paths are relative to `{base}/orgs/{orgId}/api/v1`. `{orgId}` is the LumoAuth organization slug. `{organizationId}` is the customer organization's UUID or its slug. They are different values.

The `lumo` CLI has no command for customer organizations. `lumo org` reads and updates the LumoAuth organization itself. Use `lumo api`, where the path is relative to the Admin API:

```bash
lumo api GET /organizations --query search=globex
```

The **customer portal** is a hosted page for the members of one customer organization: `/b2b/{orgId}/{organizationSlug}/`. Members see their role and what it allows (**Your access**); owners and admins of the customer organization manage members, roles and invitations there. Link to it from the app when the customer's own admins should manage their team without custom UI.

## Steps

### 1. Create the customer organization when a customer signs up

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/organizations" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Globex",
    "slug": "globex",
    "metadata": { "customer_ref": "cus_1042" }
  }'
```

- `name` is required. Optional: `slug` (generated from the name when it is left out), `displayName`, `description`, `logoUrl`, `metadata` (a JSON object), `isActive`.
- The response is `201` with `{ "data": { "id", "slug", "name", "displayName", "description", "logoUrl", "isActive", "memberCount", "metadata", "createdAt", "updatedAt" }, "message": "Organization created" }`.
- `409` means that the slug is taken or the data is invalid.
- Store `data.id` on the customer record in the app's database.

### 2. Add the first member as owner

List the roles of the new customer organization to get the role IDs:

```bash
curl -s "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/organizations/globex/roles" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY"
```

Each role is `{ "id", "slug", "name", "description", "isDefault", "isOwner", "isSystem" }`.

If the person already has a user account in the organization, add the membership directly:

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/organizations/globex/members" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$USER_ID\", \"roleId\": $OWNER_ROLE_ID}"
```

`roleId` is optional; without it the member gets the default role. `409` means that the user is already a member. The owner role can be granted only by a credential whose owner is an owner of that customer organization or an organization admin (`403` otherwise).

If the person has no account, send an invitation:

```bash
curl -s -X POST "https://app.lumoauth.dev/orgs/acme-corp/api/v1/admin/organizations/globex/invitations" \
  -H "Authorization: ApiKey $LUMOAUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"pat@example.com\", \"roleId\": $OWNER_ROLE_ID, \"message\": \"Welcome to Globex on Acme.\"}"
```

- `email` is required. `roleId` and `message` are optional.
- The invited person gets an email with a link, registers or signs in, and becomes a member. A new account must meet the organization's password policy. The MFA policy applies as for any sign-in.
- The invitation expires after 7 days. `POST .../invitations/{invId}/resend` sends it again. `DELETE .../invitations/{invId}` revokes it.

### 3. Restrict the application to members

In the portal, open the application (`/orgs/{orgId}/portal/applications`) and set **Who can sign in**:

| Choice | Effect |
|---|---|
| **Everyone** (default) | Users with and without a membership can sign in |
| **Individual users only** | Users who are members of a customer organization are refused |
| **Customer organization members only** | Users without a membership are refused |

For a B2B product choose **Customer organization members only**. A refused user sees an "Access denied" page on the hosted login.

### 4. Carry the customer organization through sign-in

When a user who is a member signs in through `/authorize`, LumoAuth resolves one customer organization for the session:

| The user is a member of | Result |
|---|---|
| One customer organization | That one is selected. No prompt. |
| Several, and the request has `organization=<slug>` | That one is selected when the user is an active member of it. |
| Several, and the request has no `organization` | The hosted page shows an organization selector. |
| Several, with `prompt=none` and no `organization` | The request fails with `interaction_required`. |

`organization` is a query parameter of the authorization request. Its value is the slug of the customer organization. Add it as an extra authorization parameter in the SDK or OIDC library that the app uses (in the LumoAuth JS SDK the authorization URL builder takes `extraParams`). The framework skills (`lumoauth-nextjs`, `lumoauth-react`, `lumoauth-express` and the others) show where.

The documented claims that identify the customer organization in the access token:

| Claim | Value |
|---|---|
| `org_id` | UUID of the customer organization |
| `org_slug` | Its slug |
| `org_name` | Its display name, or its name when no display name is set |
| `org_role` | Slug of the member's role in it, for example `owner`, `admin`, `member` |

The claims are added only for an active customer organization and an active membership.

**Check before you rely on the claims.** Sign in as a test member and decode the access token (portal page `/orgs/{orgId}/portal/developer/jwt-inspector`). If the token has no `org_id`, do not fall back to a value from the request. Resolve the membership on the server instead (step 5, "Fallback"), and tell the user that the token did not carry the claims.

### 5. Enforce isolation in the app

LumoAuth authenticates the user and states the customer organization. The app must scope every read and write. Apply these rules:

1. Take the customer organization from the verified token or from a server-side lookup. Never from a URL segment, header, query parameter or request body that the client controls.
2. Verify the access token first: signature, issuer, audience, expiry (see `lumoauth-api-protection`).
3. Key every tenant-owned row by the customer organization `id` (the UUID; a slug can be renamed).
4. Make the customer organization a required argument of every data-access function. Do not offer an unscoped variant.
5. When the URL names an organization (for example `/app/globex/projects`), compare it with the verified one and return `404` on a mismatch.
6. Map `org_role` to permissions in one place in the app.

```ts
// tenant-context.ts — runs after the access token has been verified.
export interface VerifiedClaims {
  sub: string;
  org_id?: string;
  org_slug?: string;
  org_role?: string;
}

export interface TenantContext {
  userId: string;
  orgId: string;      // UUID of the customer organization
  orgSlug: string;
  role: string;       // slug of the member role
}

export class NoOrganizationError extends Error {}

export function tenantFromClaims(claims: VerifiedClaims): TenantContext {
  if (!claims.org_id || !claims.org_slug || !claims.org_role) {
    // Fail closed: no organization in the token means no tenant data.
    throw new NoOrganizationError("The access token carries no customer organization");
  }
  return { userId: claims.sub, orgId: claims.org_id, orgSlug: claims.org_slug, role: claims.org_role };
}

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ["projects.read", "projects.write", "members.manage", "billing.manage"],
  admin: ["projects.read", "projects.write", "members.manage"],
  member: ["projects.read", "projects.write"],
};

export function can(ctx: TenantContext, permission: string): boolean {
  return ROLE_PERMISSIONS[ctx.role]?.includes(permission) ?? false;
}
```

```ts
// projects-repo.ts — every query takes the tenant context.
import type { Pool } from "pg";
import type { TenantContext } from "./tenant-context";

export async function listProjects(db: Pool, ctx: TenantContext) {
  const { rows } = await db.query(
    "SELECT id, name FROM projects WHERE org_id = $1 ORDER BY name",
    [ctx.orgId],
  );
  return rows;
}

export async function getProject(db: Pool, ctx: TenantContext, projectId: string) {
  const { rows } = await db.query(
    "SELECT id, name FROM projects WHERE org_id = $1 AND id = $2",
    [ctx.orgId, projectId],
  );
  return rows[0] ?? null; // a project of another customer is "not found", not "forbidden"
}
```

**Fallback: resolve the membership on the server.** Use it when the token carries no `org_*` claims. From the backend, look the user up in the customer organization that the app's own record points to: `GET /admin/organizations/{organizationId}/members?search=<email>&status=active`, then compare the email exactly (`search` is a substring match) and read `role.slug`. A complete function is in [references/organizations-api.md](references/organizations-api.md#membership-lookup-from-the-backend). Cache the result for a short time and refresh it on the `organization.member.*` webhook events.

### 6. Switch organization in the app

A session is bound to one customer organization. To switch:

1. List the user's organizations in the app (from the app's own records, or link to `/account/organizations`, the hosted **Your organizations** page).
2. Start a new authorization request with `organization=<slug of the target>`. A user who still has a LumoAuth session is normally returned without a sign-in prompt.
3. Replace the app session and tokens with the new ones. Drop every cached row of the previous organization.

Do not switch by changing a value in the app session without a new token.

### 7. Keep the app in step with membership changes

Subscribe a webhook endpoint (see `lumoauth-webhooks`) to:

- `organization.created`, `organization.updated`, `organization.deleted`
- `organization.member.added`, `organization.member.updated`, `organization.member.removed`
- `organization.invitation.accepted`
- `user.created`, `user.deleted`

To offboard a customer without deleting data, deactivate the customer organization: `PATCH /admin/organizations/{organizationId}` with `{"isActive": false}`, or the **Active** switch on its **Settings** tab. Its members can still sign in to applications that do not require a membership.

## Per-customer SSO, SCIM and branding

| Need | Where it is configured | Skill |
|---|---|---|
| A customer signs in through its own identity provider | Add an identity provider to the LumoAuth organization: `/orgs/{orgId}/portal/saml-idps` (SAML) or `/orgs/{orgId}/portal/oidc-idps` (OIDC). One organization can hold several. | `lumoauth-enterprise-sso` |
| A customer's directory creates and removes users | SCIM of the LumoAuth organization: `/orgs/{orgId}/portal/integrations/scim` | `lumoauth-scim` |
| A different login page per product or customer app | Per-application branding on the application's **Branding** tab; organization-wide branding on the login page settings | `lumoauth-branding` |

A user who arrives through SSO or SCIM is a user of the LumoAuth organization. The user is not placed in a customer organization by these features. Add the membership with `POST /admin/organizations/{organizationId}/members`, for example from the handler of the `user.created` webhook, using the app's own rule (such as the email domain that the customer verified with the vendor).

## Verify

1. `lumo api GET /organizations` lists the customer organization with `isActive: true` and the expected `memberCount`.
2. Sign in as a member. The access token carries the expected `org_id` and `org_role` (or the fallback lookup returns the role).
3. Sign in as a member of customer A and request a resource of customer B by ID. The app returns `404`.
4. Sign in as a user without a membership to an application that is limited to members. The hosted page shows "Access denied".
5. Suspend a test membership (`PATCH .../members/{userId}` with `{"status": "suspended"}`), sign in again and confirm that the app grants nothing.
6. As a user with two memberships, start sign-in without `organization`: the selector appears. With `organization=<slug>`: no selector.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `404 Organization not found` on `/admin/organizations/{organizationId}` | The LumoAuth organization slug was used as `{organizationId}` | `{orgId}` is the vendor's slug; `{organizationId}` is the customer organization's UUID or slug |
| Portal URL `/orgs/globex/portal/...` does not open | A customer organization slug is not a LumoAuth organization slug | Customer members use `/b2b/{orgId}/{organizationSlug}/`; SSO and SCIM pages are under the vendor's `/orgs/{orgId}/portal/` |
| `lumo org update` changed the vendor's own name | `lumo org` manages the LumoAuth organization | Use `lumo api` with `/organizations` paths |
| Data of another customer is visible | The app read the organization from the URL or a header | Take it from the verified token; scope every query |
| No `org_*` claims in the token | The user has no active membership, the customer organization is deactivated, or the token was not bound to one | Check membership and status; use the server-side lookup; fail closed |
| `interaction_required` on silent sign-in | The user has several memberships and the request has no `organization` | Send `organization=<slug>` |
| `403` when granting `owner` | The caller is not an owner of that customer organization or an organization admin | Use a key that an organization admin created |
| `422` when suspending a member | The member is the last owner | Make another member an owner first |
| Expecting SSO users to land in the customer's workspace | SSO and SCIM create users of the LumoAuth organization only | Add the membership through the members endpoint |
| Admin API key in the browser | It can manage every customer | Call the Admin API from the backend only and rotate the key |

## Related skills

- `lumoauth-users-sessions`: the user accounts behind the members.
- `lumoauth-enterprise-sso`: SAML and OIDC identity providers for a customer.
- `lumoauth-scim`: provisioning from a customer's directory.
- `lumoauth-rbac`: organization-wide roles and permission checks.
- `lumoauth-api-protection`: verify the access token before reading its claims.
- `lumoauth-webhooks`: receive the `organization.*` events.
- `lumoauth-branding`: login page and per-application branding.
- `lumoauth-admin-api`: API keys, pagination and errors.

## References

- [Admin API for customer organizations](references/organizations-api.md): open it when you need an endpoint, permission, scope, body field or response shape for customer organizations, members, roles or invitations.
- https://docs.lumoauth.dev/tracks/b2b
- https://docs.lumoauth.dev/user-guide/user-management/organizations
- https://docs.lumoauth.dev/user-guide/multi-tenancy/overview
- https://docs.lumoauth.dev/user-guide/multi-tenancy/tenant-portal
