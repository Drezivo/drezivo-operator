# Operator tenant administration (MVP)

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

Every `POST` requires an `Idempotency-Key` header (16–200 characters of `A-Z a-z 0-9 _ . : -`).
Generate one key per operator intent and reuse it on retry. The response is
`{ tenant, changed, replayed }`: `replayed: true` means the same key was already applied and nothing
ran again; `changed: false` means the business was already in the requested state.

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 STATE_CONFLICT` (with a
plain-language reason), `503 DEPENDENCY_UNAVAILABLE` (not configured or database unreachable — no
internal details are returned).

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `OPERATOR_TENANT_ADMIN_DATABASE_URL` | to enable the routes | `postgres://drezivo_app:…@host:port/db`. Use the business runtime role, never `postgres` or `service_role` — the adapter refuses roles that bypass RLS. On Supabase use the transaction pooler (port 6543). |
| `OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE` | in production | Path to the database CA certificate (Supabase: Project Settings → Database → SSL certificate). TLS is verified against it. |
| `BUSINESS_CLERK_SECRET_KEY` | optional | Secret key of the **business** Clerk instance (where shop owners and staff sign in), not the operator instance. Used only to show staff names, emails and last sign-in. If unset or Clerk is slow (> 4 s), staff are listed by Clerk user ID and `profile` is `null`. |

Without `OPERATOR_TENANT_ADMIN_DATABASE_URL` every `/tenants` and `/people` route returns 503.

Operator session tokens are accepted only when minted for an origin in `OPERATOR_CORS_ORIGINS`
(Clerk `authorizedParties`), and `INTERNAL_SERVICE_AUTH` must be at least 32 bytes.

## Staff names and emails

The business database stores Clerk user IDs, not names or emails. With `BUSINESS_CLERK_SECRET_KEY`
set, every member carries `profile: { email, name, last_sign_in_at, banned, locked }` read from the
business Clerk instance in batches of 100. This is display data only; nothing is authorized from it.

## Tests

- `npm test` — route contract, validation, permissions, fail-closed and redaction (`test/operator-tenant-admin.test.ts`).
- Real database, opt-in (`test/tenant-admin-db.integration.test.ts`): starts a throwaway Postgres 17,
  applies every business migration, and runs the adapter as `drezivo_app`, including sequential and
  concurrent double-fire checks.

```bash
# export the business migrations (read-only), then run
git -C ../Rentivo archive origin/main api/src/db/migrations | tar -x -C /tmp/biz-migrations --strip-components=4
TENANT_ADMIN_IT_MIGRATIONS_DIR=/tmp/biz-migrations npm run test:integration
```
