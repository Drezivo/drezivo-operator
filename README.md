# Drezivo Operator Console

An internal operations interface for reviewing Drezivo platform records. It uses Clerk for operator sign-in and the Drezivo Operator API as the sole source of business data and authorization decisions.

## Run locally

Requirements: Node.js 20.9 or newer and npm.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from the Drezivo-internal Clerk application used by this console. Never put the Clerk secret key in this web repository or in a `NEXT_PUBLIC_` variable, and never commit `.env.local`.
3. Keep `NEXT_PUBLIC_DREZIVO_API_BASE_URL` set to the operator API origin plus `/api/v1`. Production requires HTTPS; development may use plain HTTP only with a loopback host (`localhost`, `127.0.0.0/8`, or `::1`). The template points to the API's local default, `http://localhost:5080/api/v1`.
4. Run `npm run dev` and open `http://localhost:3010`. The console reserves port 3010 so it does not take over another local app on ports 3000 or 3001.

If another Drezivo Operator Web development server is already running from this same checkout,
Next.js shares a build lock between instances. Start the 3010 monitor with a separate local build
directory in PowerShell:

```powershell
$env:DREZIVO_NEXT_DIST_DIR = '.next-operator-3010'
npm run dev
```

The custom build directory stays inside this repository and is ignored by Git. Do not start a
second instance on a port owned by another local app.

The Web key selects the Clerk application used by browser sign-in and organization creation or
selection. Updating only the Operator API's Clerk configuration does not retarget the browser.
Set the API's `OPERATOR_CLERK_ORGANIZATION_ID` to the Internal Operator organization in the same Clerk
instance selected by the Web key.

The API receives the active short-lived Clerk session token as a Bearer token. Select the dedicated Internal Operator organization before the console makes API requests because the API also requires Clerk organization context. The API validates operator membership and permissions on every request; a successful Clerk sign-in or organization selection alone does not grant operator access. The console does not implement a custom token refresh flow.

Sign-in lives at `/sign-in` with an optional catch-all segment so Clerk can complete nested SSO callback steps. Signed-out visits to the console go to this route, and successful sign-in returns to `/`. The Web app does not use Clerk middleware or a proxy; its client components handle sign-in navigation, while the Operator API remains the authorization boundary and validates every request.

If Clerk is not configured, the page explains which public key is missing and does not show the console. If the API URL is missing or malformed, a setup state explains the required value and no request is sent. API data is never seeded with local examples. Unavailable routes, denied access, network errors, and empty API results have separate states.

## Clients (operator MVP)

`/?view=clients` is the day-to-day screen for the first client businesses. It lists every business
with its account status, plan, trial or paid-until date and staff counts (search by name, storefront
slug or ID). **Manage** opens one business, where an operator can:

- lock or unlock the business (staff keep read-only access while locked),
- set the last trial day, or mark the subscription as paid after verifying a GCash, Maya, bank or cash payment,
- correct the business name or time zone,
- suspend or reactivate a staff member,
- read the business's recent activity.

Every action needs a reason (stored in the audit log), disables all buttons while it is in flight, and
reuses the same `Idempotency-Key` if it is retried, so a double click or a retry never applies twice.
Dates are shown in Manila time; a date picker value means "until 23:59:59 that day, Manila time".
The data and rules come from the Operator API `/api/v1/tenants*` routes (see the Operator API's
`docs/OPERATOR-TENANT-ADMIN-MVP.md`). The **People** tab lists every owner and staff member across businesses; names,
emails and last sign-in appear when the Operator API has `BUSINESS_CLERK_SECRET_KEY`, otherwise the Clerk user ID is shown.

Environment variables are documented above. Never commit any `.env*` file, including examples.

## Connected API views

The console uses the `/api/v1` routes for overview, businesses, subscriptions, business entitlements, audit events, operators, jobs, and notifications. Job and notification retries require an operator-provided reason. A retry sends that exact reason and an `Idempotency-Key` tied to the reason text. A failed retry keeps its key so a repeated request replays the same intent. Editing the reason starts a new intent. Requests use `cache: no-store`.

The overview response includes a server-generated `as_of` snapshot time; the console does not send one as a query parameter. Its `active_support_grants` value is a count supplied by the API, which counts grants where `revoked_at IS NULL`, `starts_at <= as_of`, and `as_of < expires_at`. The browser displays the returned number and does not calculate grant status.

Support grants are created through `POST /support-grants` with tenant ID, permission codes, reason, and start/end times. Grants can be revoked by entering a grant UUID returned by the API. Both controls use stable idempotency keys, pending/disabled states, and an in-flight guard. The API remains authoritative for permission and time-window validation. A grant list is not shown because no list route is documented. Support activity is intentionally not requested: the API contract is blocked while business-wire semantics are unresolved.

## Navigation and page shells

Regular console views use client-side navigation inside one persistent shell. The content area changes while the sidebar and session controls stay mounted, and the sidebar keeps its scroll position through view changes and browser Back/Forward. A larger area such as Settings can use a separate Next.js layout with its own sidebar and item tabs plus a clear link back to the operator console. That changes the visible shell without forcing a full browser reload. Build that area only after its API and permission contracts are ready.

## Current backend readiness

The API may return `403` when operator membership resolution denies the session, `503` when Clerk integration is not configured, or `503` when a read or command adapter is unavailable. These results are displayed as returned; this UI does not treat an API health check as proof that data dependencies are ready. The Analytics navigation link is visible to signed-in members of the internal organization because this console does not hold a verified permission-role view; the Operator API enforces `platform.analytics.read` and returns `403` for unauthorized roles. Support activity remains blocked by its unresolved backend contract.

## Checks

- `npm test` runs Vitest and React Testing Library unit/UI tests.
- `npm run typecheck` checks TypeScript.
- `npm run build` creates the production Next.js build.
