# App Router browser verification

Date: 2026-10-26 (Asia/Singapore). Local app: `http://localhost:3010`. Signed in with the existing Clerk Development operator account against local data.

## Browser checks

- Opened Overview, Analytics, Clients, Subscriptions, Assigned plans, Payments, Payment methods, Operators, Support access, Audit log, Background jobs, and Notifications through path links.
- All enabled feature routes loaded without a blocked/error panel.
- Followed a recent business to `/clients/[tenantId]`; refreshed that dynamic URL and loaded the matching business.
- Preserved sidebar scroll at exactly 421 pixels through Back, Forward, and main-content business links.
- Refreshed `/subscriptions` directly and displayed nine local subscription rows without the previous crash.
- Changed analytics History to 12 months at `/analytics?months=12`.
- Loaded `/clients?tab=people&filter=trial` directly and switched to Businesses while retaining the filter.
- Selected a business in Assigned plans and loaded nine capabilities.
- Advanced the Background jobs list from 25 rows to the next 25 and returned to the first page.
- Confirmed a disabled `/businesses` route shows the availability state; automated tests verify it makes no feature API request.
- Confirmed `/?view=analytics` opens Overview and an unknown route renders the shared 404.
- Checked 320, 390, 768, 1024, and 1440 pixel viewport settings: document width matched the available viewport, with no page-level horizontal overflow.
- No new browser console errors occurred during the final route checks.

## Boundaries

Real payment, grant, profile, retry, and deletion commands were not submitted during browser QA. Their existing feature tests verify command behavior and idempotency using mock responses. Synthetic local sign-in and sign-out are also covered by a dedicated test.

The initial missing Client Component directive on StatePanels was fixed before the signed-in route checks. The browser's earlier development-error logs predate this final verification.
