# ADR 0025: Client administration through the business database

**Status:** Accepted (time-boxed; see Exit plan)
**Date:** 2026-09-28
**Scope:** Operator API `/api/v1/tenants*` routes and the `tenant-admin-db` adapter

## Context

Drezivo is onboarding its first one to five client businesses. Operators need, now: a list of
businesses and their staff, and the actions that keep those clients running — lock and unlock a
business, suspend and reactivate a staff member, set a trial end date, activate a subscription after a
manual QR/GCash payment, and correct a business name or time zone.

ADR 0001 says the Operator API never writes business data directly; the business API owns every
invariant and exposes operator commands over internal routes. On business `main` (commit `8814859`)
those internal routes cover only support grants, support activity and job retries. There is no route
for any action above, and the business repository is outside this change's scope.

## Decision

Add a narrow, audited, direct database adapter to the Operator API for exactly these actions, and keep
the business database's own protections in force:

- Connect as the business runtime role (`drezivo_app`). The adapter checks `pg_roles` on first use
  and refuses to run if the role is a superuser or has `BYPASSRLS`.
- Run every tenant read and write in a transaction that sets `app.tenant_id` with
  `set_config(…, true)`, so the business schema's forced row-level security decides visibility,
  exactly as in the business API. `statement_timeout` 5 s and `lock_timeout` 3 s are set per
  transaction.
- Make every mutation duplicate-safe with the existing `operator_command` table: the command row is
  keyed by `(tenant, operator, command kind, Idempotency-Key)`; a duplicate replays current state and
  applies nothing. The tenant row is locked `FOR UPDATE` so commands on one business serialize.
- Write one `audit_event` (`actor_kind = 'operator'`, linked by `operator_command_id`) in the same
  transaction as the state change. Activation also writes a `subscription_event`
  (`converted` or `renewed`).
- State changes are conditional `UPDATE … WHERE status = …`, and time-based actions take absolute
  target dates (never "+N days"), so repeating an intent is a no-op.
- Trial extension lifts a lifecycle restriction (subscription and tenant both `restricted`) but never a
  manual operator lock (tenant `restricted` while the subscription is not).
- Permissions: `tenant.admin.read` (platform owner, platform operator, support operator) and
  `tenant.admin.manage` (platform owner, platform operator).
- Production requires verified TLS: `OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE` must point to the
  database CA certificate.

## Consequences

- Operators can serve the first clients without waiting for new business API routes.
- The Operator API now depends on the business schema (`tenant`, `subscription`, `plan`, `membership`,
  `operator_command`, `audit_event`, `subscription_event`). A business migration that changes these
  tables must be checked against this adapter. The integration test runs every business migration and
  exercises the adapter as `drezivo_app`; run it before merging business schema changes.
- The Operator API holds a business database credential. Store it only in the host's secret manager.

## Exit plan

When the business API exposes equivalent internal operator commands, replace this adapter with an
HTTP adapter behind the same `TenantAdminPort` interface and remove the database credential. The
route contract, permissions and Operator Web code do not change.
