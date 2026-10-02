# Operator client administration

The minimum operator toolset for the first client businesses. Design and trade-offs: ADR 0025.

## Routes

All routes are under `/api/v1`, require a verified operator (Clerk session in the internal operator
organization), return `Cache-Control: no-store`, and use the standard envelope
`{ success, data, request_id }`.

| Method | Path | Permission | Body | What it does |
|---|---|---|---|---|
| GET | `/tenants` | `tenant.admin.read` | — | Businesses (newest first, max 200) with status, plan, subscription dates and staff counts |
| GET | `/tenants/:tenantId` | `tenant.admin.read` | — | One business plus staff list (with name/email when the directory is configured) and its last 20 audit events |
| GET | `/people` | `tenant.admin.read` | — | Every staff member across all businesses: business, role, status, and name, email, last sign-in, banned/locked from the business Clerk instance |
| POST | `/tenants/:tenantId/profile` | `tenant.admin.manage` | `{ name?, timezone?, reason }` | Edit business name and/or IANA time zone |
| POST | `/tenants/:tenantId/lock` | `tenant.admin.manage` | `{ reason }` | Business → `restricted`: staff keep read-only context, every permission-gated action is denied |
| POST | `/tenants/:tenantId/unlock` | `tenant.admin.manage` | `{ reason }` | Business → `active`. Refused (409) while the subscription itself is restricted or cancelled |
| POST | `/tenants/:tenantId/members/:membershipId/suspend` | `tenant.admin.manage` | `{ reason }` | Staff member → `suspended`: next request gets 403 in the business app |
| POST | `/tenants/:tenantId/members/:membershipId/reactivate` | `tenant.admin.manage` | `{ reason }` | Staff member → `active` |
| POST | `/tenants/:tenantId/trial` | `tenant.admin.manage` | `{ trial_ends_at, reason }` | Set the trial end (future, ≤ 90 days). Restores a trial-expired business |
| POST | `/tenants/:tenantId/activate` | `tenant.admin.manage` | `{ current_period_end, reason }` | Mark paid after a verified manual payment (future, ≤ 400 days) |
| POST | `/tenants/:tenantId/read-only-extension` | `tenant.admin.manage` | `{ read_only_until, reason }` | Pilot: keep a lapsed business in view-only access (storefront visible, bookings paused) until this date (future, ≤ 90 days) |
| POST | `/tenants/:tenantId/notes` | `tenant.admin.manage` | `{ body }` | Append an operator-only note (1–2000 characters). Businesses never see notes; the audit row records only the length |
| GET | `/subscription-payments?status=pending\|recent` | `tenant.admin.read` | — | Proofs of payment across businesses: `pending` oldest first (default), `recent` newest first (max 200) |
| POST | `/tenants/:tenantId/subscription-payments/:paymentId/approve` | `tenant.admin.manage` | `{ reason }` | Payment → `verified`, subscription → `active` for one more month from the later of now, the trial end, or the current paid-through date; the owner is emailed |
| POST | `/tenants/:tenantId/subscription-payments/:paymentId/reject` | `tenant.admin.manage` | `{ reason }` | Payment → `failed`. **The owner sees the reason** in the app and by email |
| GET | `/tenants/:tenantId/subscription-payments/:paymentId/proof-link` | `tenant.admin.read` | — | A 5-minute link to the uploaded proof on the business API (503 when proof links are not configured) |
| GET | `/platform-payment-methods` | `tenant.admin.read` | — | Drezivo's own payment methods that businesses pay the subscription to (no image bytes; `has_qr`) |
| GET | `/platform-payment-methods/:methodId/qr` | `tenant.admin.read` | — | The QR image (type detected from its bytes) |
| POST | `/platform-payment-methods` | `tenant.admin.manage` | `{ label, account_name?, account_number?, instructions?, sort_order?, qr?: { data_base64 }, reason }` | Add a method. 201 for a new intent, 200 on replay. At most 10 active (`409 PAYMENT_METHOD_LIMIT`) |
| POST | `/platform-payment-methods/:methodId` | `tenant.admin.manage` | `{ version, label, …, qr?, reason }` | Edit at the version you opened (`409` if it changed). `qr` omitted keeps the image, `null` removes it |
| POST | `/platform-payment-methods/:methodId/activate` and `/deactivate` | `tenant.admin.manage` | `{ version, reason }` | Show or hide the method in the business app's Subscribe dialog. Methods are never deleted |

Every `POST` requires an `Idempotency-Key` header (16–200 characters of `A-Z a-z 0-9 _ . : -`).
Generate one key per operator intent and reuse it on retry. The response is
`{ tenant, changed, replayed }` (payment methods: `{ method, changed, replayed }`): `replayed: true`
means the same key was already applied and nothing ran again; `changed: false` means the business
was already in the requested state. Reusing a payment-method key for a different change returns
`409 IDEMPOTENCY_KEY_REUSED`.

### Pilot billing (business migration 0063)

- There is one plan, Standard, ₱300 a month, stored as code `starter`. Owners pay by QR or bank
  transfer to a method listed under `/platform-payment-methods`, and upload a proof and a reference
  number in the business app. Each business has at most one pending proof.
- Approving or rejecting writes one `subscription.payment_reviewed` outbox row. The business worker
  then emails the owner, because this API cannot send business emails.
- Access is derived in the business API from the subscription dates, with no background job:
  - full access until the end date, with a reminder in the last 3 days;
  - then view-only for 30 days, with the storefront online for only the first 3 of them;
  - then locked, until a payment is approved.
- `read-only-extension` sets `subscription.grace_ends_at`, which now means "view-only until".
- Proof images stay in the business storage. This API signs
  `p1.<tenant>.<payment>.<expires>.<HMAC-SHA256>` with `OPERATOR_PROOF_LINK_SECRET`. The business
  route `GET /api/v1/operator/payment-proofs/<token>` checks the link and redirects to a short-lived
  storage URL. The format is pinned by a shared test vector in both repositories
  (`test/proof-link.test.ts` here).
- Who can do what: `platform_owner` and `platform_operator` can review and edit. `support_operator`
  can only read. `billing_operator` has no `tenant.admin.*` permission.

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 STATE_CONFLICT` (with a
plain-language reason), `503 DEPENDENCY_UNAVAILABLE` (not configured or database unreachable — no
internal details are returned).

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `OPERATOR_TENANT_ADMIN_DATABASE_URL` | to enable the routes | `postgres://drezivo_app:…@host:port/db`. Use the business runtime role, never `postgres` or `service_role` — the adapter refuses roles that bypass RLS. On Supabase use the transaction pooler (port 6543). |
| `OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE` | in production | Path to the database CA certificate (Supabase: Project Settings → Database → SSL certificate). TLS is verified against it. |
| `OPERATOR_PROOF_LINK_SECRET` | to view proofs | At least 32 random characters, identical to the business API's `OPERATOR_PROOF_LINK_SECRET`. Secret: set it in the host's environment, never in a committed file. |
| `BUSINESS_API_PUBLIC_URL` | to view proofs | Public origin of the business API, for example `https://api.drezivo.shop`. Proof links point there. |
| `BUSINESS_CLERK_SECRET_KEY` | optional | Secret key of the **business** Clerk instance (where shop owners and staff sign in), not the operator instance. Used only to show staff names, emails and last sign-in. If unset or Clerk is slow (> 4 s), staff are listed by Clerk user ID and `profile` is `null`. |

Without `OPERATOR_TENANT_ADMIN_DATABASE_URL` every `/tenants`, `/people`, `/subscription-payments`
and `/platform-payment-methods` route returns 503. Without both proof-link variables, only
`proof-link` returns 503.

Operator session tokens are accepted only when minted for an origin in `OPERATOR_CORS_ORIGINS`
(Clerk `authorizedParties`), and `INTERNAL_SERVICE_AUTH` must be at least 32 bytes.

## Staff names and emails

The business database stores Clerk user IDs, not names or emails. With `BUSINESS_CLERK_SECRET_KEY`
set, every member carries `profile: { email, name, last_sign_in_at, banned, locked }` read from the
business Clerk instance in batches of 100 (up to four batches at a time). Profiles are reused for
60 seconds. This is display data only; nothing is authorized from it.

## Cross-tenant lists (business migration 0069)

`/tenants`, `/people` and `/subscription-payments` each run ONE query: the read-only
`SECURITY DEFINER` functions `operator_tenant_summaries`, `operator_people` and
`operator_subscription_payment_queue` from business migration 0069, called in a read-only
transaction with `app.actor_kind = 'operator'` and no tenant set (the functions return nothing
otherwise). Lists are capped at 1,000 businesses, 5,000 memberships and 200 payments. Detail pages
and every command still run per tenant under RLS. Deploy the business migration before this API.

## Tests

- `npm test` — route contract, validation, permissions, fail-closed and redaction
  (`test/operator-tenant-admin.test.ts`, `test/operator-platform-payments.test.ts`, `test/proof-link.test.ts`).
- Real database, opt-in (`test/tenant-admin-db.integration.test.ts`): starts a throwaway Postgres 17,
  applies every business migration, and runs both adapters as `drezivo_app`, including sequential and
  concurrent double-fire checks: approve races, and the 10-active-method limit under racing writes.

```bash
# export the business migrations (read-only), then run
git -C ../Rentivo archive origin/main api/src/db/migrations | tar -x -C /tmp/biz-migrations --strip-components=4
TENANT_ADMIN_IT_MIGRATIONS_DIR=/tmp/biz-migrations npm run test:integration
```
