---
title: Wayfind admin plan changes for client details
status: completed
labels:
  - wayfinder:map
---

# Wayfind admin plan changes for client details

## Destination

Add a subscription plan editor to `/clients/[id]` backed by an authorized, idempotent Business API command. Make internal reasons optional on client administration forms while keeping payment rejection reasons required.

## Notes

- The Business API owns subscription and payment rules; the Operator API must not write subscription plan state directly.
- Consult the Wayfinder skill, both repositories' `AGENTS.md` files, and the relevant client administration and billing ADRs.
- Preserve action and actor audit records when an optional reason is omitted; persist no reason value in that case.
- Preserve the existing payment rejection requirement because the business owner sees that reason.
- Plan changes must use the canonical active plan catalog and must not grant paid access without the existing payment path.
- Continue implementation after recording the approved decision, as requested by the user.
- Business API implementation base: fetched `origin/staging` commit `d24848d3`, whose latest migration is `0094_operator_announcements.sql`. Migration 0085 already adds `operator_command.request_fingerprint`.

## Decisions so far

- [Keep operator plan changes business-owned and payment-gated](tickets/closed/keep-operator-plan-changes-business-owned-and-payment-gated.md): Plan selection uses the Business API's catalog and eligibility rules; the command cannot bypass payment requirements.

## Implementation

- `/clients/[tenantId]` now shows the active v1 plan catalog and a plan selector. The Operator API requires `tenant.admin.manage`, sends a 60-second HMAC assertion bound to the tenant, request, idempotency key, and body, then refreshes the tenant details from the read adapter.
- The Business API exposes `POST /internal/operator/v1/tenants/:tenantId/plan`. Its command runs under explicit operator tenant context, locks the tenant/subscription, checks the active trial or paid period and pending payments using database time, resolves the active v1 catalog, checks plan capacity, and writes the plan event, nullable-reason command record, and audit event atomically. It accepts Starter, Standard, Growth, and Scale; Free remains payment-gated.
- An operator may change a currently paid plan immediately without an additional charge. The paid period is unchanged, the next renewal uses the selected plan price, and no plan-change email is sent. The console asks for confirmation and blocks downgrades that exceed the target plan's capacity.
- Idempotency fingerprints use normalized command data so a blank optional reason matches an omitted reason, consistent with the nullable audit reason.
- Business API config requires `INTERNAL_SERVICE_AUTH` and `INTERNAL_OPERATOR_ASSERTION_SECRET` together. Configure matching values on both APIs and apply `0095_operator_plan_change_support.sql` before deploying this endpoint. The migration only makes `operator_command.reason` nullable; it does not add the fingerprint column again.
- Internal client-detail action reasons are optional, including member suspend/reactivate and plan changes. Payment approval may omit a reason; payment rejection still requires one visible to the business owner. Omitted reasons are stored as SQL `NULL` while action/actor audit records remain.

## Verification

- Business API typecheck, lint, test, and build passed. The API suite reported 335 passed and 2 skipped.
- Operator API typecheck, lint, test, and build passed. The API suite reported 212 passed and 31 integration tests skipped. Operator web typecheck and build passed; tests reported 146 passed.
- The docs link check passed. Repository-wide Markdown lint remains blocked by pre-existing table-format errors in four unrelated documents; neither changed document was reported.
- No browser check was run, as requested. No database migration was applied.
- `graphify update .` completed in both repositories.

## Out of scope

- Direct Operator API writes to subscription plan or entitlement records.
- Changes to owner-visible payment rejection requirements.
