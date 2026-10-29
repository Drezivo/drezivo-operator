# Drezivo Operator Console

An internal operations interface for reviewing Drezivo platform records. It uses Clerk for operator sign-in and the Drezivo Operator API as the sole source of business data and authorization decisions.

## Run locally

Requirements: Node.js 22.9 or newer (below 25) and npm.

1. Install dependencies once from the repository root with `npm ci`.
2. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in an ignored local environment file from the Drezivo-internal Clerk application used by this console. Never put the Clerk secret key in this web repository or in a `NEXT_PUBLIC_` variable, and never commit `.env.local`.
3. Keep `NEXT_PUBLIC_DREZIVO_API_BASE_URL` set to the operator API origin plus `/api/v1`. Production requires HTTPS; development may use plain HTTP only with a loopback host (`localhost`, `127.0.0.0/8`, or `::1`). The API's local default is `http://localhost:5080/api/v1`.
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

## Clients

`/clients` is the day-to-day screen for the first client businesses. It lists every business
with its account status, plan, trial or paid-until date and staff counts (search by name, storefront
slug or ID). **Manage** opens one business, where an operator can:

- lock or unlock the business (staff keep read-only access while locked),
- review the proofs of payment the owner sent: open the proof, then approve or reject with a reason,
- extend view-only access for a business whose trial or paid month ended,
- keep operator-only notes (businesses never see them),
- set the last trial day, or record a payment made outside the app (for example cash),
- correct the business name or time zone,
- suspend or reactivate a staff member,

Every action needs a reason (stored in the audit log), disables all buttons while it is in flight, and
reuses the same `Idempotency-Key` if it is retried, so a double click or a retry never applies twice.
Dates are shown in Manila time; a date picker value means "until 23:59:59 that day, Manila time".
The data and rules come from the Operator API `/api/v1/tenants*` routes (see the Operator API's
`docs/OPERATOR-CLIENT-ADMINISTRATION.md`). The **People** tab lists every owner and staff member across businesses; names,
emails and last sign-in appear when the Operator API has `BUSINESS_CLERK_SECRET_KEY`, otherwise the Clerk user ID is shown.

Environment variables are documented above. Never commit any `.env*` file, including examples.

### Views in this build

The console shows only views whose Operator API routes and business endpoints are live. By default
that is **Overview**, **Analytics**, **Clients**, **Subscriptions**, **Assigned plans**, **Operators**,
**Audit log**, **Background jobs**, **Notifications**, **Payments** and **Payment methods**.
The matching API and business migrations must be released first. Override the list with a comma-separated value in
`NEXT_PUBLIC_OPERATOR_VIEWS` (for example `clients,operators`); unknown names are ignored.

Clients state is in the URL, so links and the Back button work: `/clients?filter=attention`
(filters: `attention`, `pending`, `free`, `trial`, `unpaid`, `locked`, `paid`, `all`), `/clients?tab=people`, and
`/clients/<business id>`. Layouts adapt by available width from 320px phones to 3840px
displays; lists become cards on narrow screens and aligned columns on wide ones.

### Pilot billing

Plan prices come from the business database. Free is perpetual; Starter and Standard have paid periods.
**Free** has no renewal due. Paid plans show **Trial** or **Paid** until the end date, then **View-only** for 30 days (the storefront stays up without
bookings for the first 3), then **Expired**, where only Subscribe works. **Payment to review** lists
businesses that sent a proof.

- `/payments` is the queue of proofs, oldest first, with recently reviewed ones one tab away.
  Paid renewals add one paid month; Free upgrades queue activation of the requested paid plan.
  Both queue an owner notification through the business worker. A reject reason is shown to the owner.
  A proof opens from a link that works for 5 minutes.
- `/payment-methods` manages where businesses pay Drezivo: GCash, Maya or bank accounts with
  their QR images (PNG, JPEG or WebP, up to 512 KB). At most 10 are shown to businesses. Methods are
  turned off, never deleted.

## Connected API views

The console uses the `/api/v1` routes for overview, businesses, subscriptions, business entitlements, audit events, operators, jobs, and notifications. Job and notification retries require an operator-provided reason. A retry sends that exact reason and an `Idempotency-Key` tied to the reason text. A failed retry keeps its key so a repeated request replays the same intent. Editing the reason starts a new intent. Requests use `cache: no-store`.

The overview response includes a server-generated `as_of` snapshot time; the console does not send one as a query parameter. Support-grant creation, activity, and workspace administration have been retired from the operator console and API. Historical operator audit events remain available in the Audit log; merchant and front-desk activity remains excluded.

## Navigation and page shells

Regular console views use client-side navigation inside one persistent shell. The content area changes while the sidebar and session controls stay mounted, and the sidebar keeps its scroll position through view changes and browser Back/Forward. A larger area such as Settings can use a separate Next.js layout with its own sidebar and item tabs plus a clear link back to the operator console. That changes the visible shell without forcing a full browser reload. Build that area only after its API and permission contracts are ready.

## Current backend readiness

The API may return `403` when operator membership resolution denies the session, `503` when Clerk integration is not configured, or `503` when a read or command adapter is unavailable. These results are displayed as returned; this UI does not treat an API health check as proof that data dependencies are ready. The Analytics navigation link is visible to signed-in members of the internal organization because this console does not hold a verified permission-role view; the Operator API enforces `platform.analytics.read` and returns `403` for unauthorized roles. Operator activity is served by the platform audit route.

## Checks

- `npm test` runs Vitest and React Testing Library unit/UI tests.
- `npm run typecheck` checks TypeScript.
- `npm run build` creates the production Next.js build.


See [coordinated release requirements](../api/docs/OPERATOR-CONSOLE-RELEASE.md) before
promoting the frontend. A frontend-only deployment does not install database functions or release the API.

## Architecture

Pages use App Router paths and feature modules. See [Web architecture](docs/WEB-ARCHITECTURE.md) for route ownership and data flow. Old `?view=` links no longer select a view.
