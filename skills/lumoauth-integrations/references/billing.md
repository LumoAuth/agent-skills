# Billing

LumoAuth bills through Stripe. Plan names, prices and limits change, so this file does not state them. The current values are on the organization's Billing page and at https://docs.lumoauth.dev/pricing-matrix.

- Page: `/orgs/{orgId}/portal/billing` (**Settings → Billing**)
- Permission: `billing.manage`
- API and CLI: none for plan changes. Portal only.

An agent must not change a plan, add an add-on or cancel a subscription for the user. These actions cost money. Tell the user which page to open and what to choose.

## What the page does

- Shows this month's usage, the plans, the add-ons that the current plan offers, and the plan limits.
- **Upgrade** and **Downgrade** on a plan card open a review page first: price, features gained or lost, limits that change, and what happens to each add-on.
- A change that costs more starts at once. A change that costs less takes effect at the end of the billing period. A scheduled change is listed with a button to undo it.
- **Payment & invoices** opens the Stripe customer portal for payment methods, invoices, the billing address and the tax ID. Plan changes are made on the Billing page, not there.
- **Cancel subscription** asks for confirmation and takes effect at the end of the billing period.

## How a missing feature shows up

What an organization may use is its plan plus its add-ons.

**In the portal.** A page whose feature the plan lacks still opens. It shows a "not included in your plan" notice, its form is greyed out, and the primary action reads **Upgrade to enable**, which leads to the Billing page. Disable and delete stay available.

**On the API.** A call to a feature that the plan lacks, or beyond a plan limit, returns `403`:

```json
{
  "error": "feature_not_in_plan",
  "message": "Feature \"siem_export\" is not included in the current plan",
  "feature": "siem_export",
  "upgrade": { "plan": "..." }
}
```

- `error` is `feature_not_in_plan` (with a `feature` field) or `plan_limit_reached` (with the fields `limit`, `included` and `current`).
- `upgrade` names the `plan` or the `addon` that unlocks the feature. It can be `null`.

Handle it in code as a configuration problem, not a transient error:

```ts
interface PlanGateError {
  error: "feature_not_in_plan" | "plan_limit_reached";
  feature?: string;
  message?: string;
  limit?: string;
  included?: number;
  current?: number;
  upgrade?: { plan?: string; addon?: string } | null;
}

export function isPlanGate(status: number, body: unknown): body is PlanGateError {
  if (status !== 403 || typeof body !== "object" || body === null) return false;
  const code = (body as { error?: unknown }).error;
  return code === "feature_not_in_plan" || code === "plan_limit_reached";
}
```

When an agent meets this error, stop, report the `feature` or `limit` to the user, and point to the Billing page. Do not retry, and do not look for another endpoint.

A billing lapse or a downgrade does not lock end users out of sign-in. Features that the plan no longer covers fall back to their defaults.

## What is metered

The Billing page shows month-to-date usage for these meters, next to the volumes that the plan includes:

| Meter | Counts |
|---|---|
| Monthly active users | Distinct users with an interactive sign-in (password, passkey, magic link, social, SSO) in the calendar month. A user counts once. Token refreshes, agents and API keys do not count. |
| Active agents | Distinct agents that obtained a token in the calendar month. A registered agent that is idle does not count. |
| Machine-to-machine tokens | Tokens issued through the client credentials, token exchange and JWT bearer grants, and agent platform tokens. Grants with an end user behind them (authorization code, refresh, device, CIBA) do not count. |
| Ask API calls | Requests to the Ask API |

Design hints that follow from the meters:

- Cache a client-credentials token until shortly before it expires instead of requesting one per call.
- Do not create a new agent identity per task when one registered agent fits.

## Reference

- https://docs.lumoauth.dev/integrations/billing
- https://docs.lumoauth.dev/pricing-matrix
