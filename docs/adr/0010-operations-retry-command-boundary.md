# ADR 0010: Operations retry command boundary

**Status:** Proposed for review
**Date:** 2026-09-17

## Decision

The operator API will request job and notification retries through two typed, allowlisted business command adapters:

- `POST /api/v1/jobs/:jobId/retry`, authorized by `job.retry`.
- `POST /api/v1/notifications/:deliveryId/retry`, authorized by `notification.retry`.

Each request will require a validated `reason` body and an `Idempotency-Key`. Authentication, authorization, scope checks, input validation, and safe response validation belong at the operator boundary. The operator route forwards the key; the business command owns the atomic idempotency claim and replay outcome. Eligibility, state transitions, outbox/job creation or reuse, provider reconciliation, audit persistence, and durable idempotency remain owned by the business API and Neon source of truth.

No operator database table, migration, direct Neon query, local worker, notification send, lease manipulation, or retry ledger is introduced by this ADR.

## Context

The read-only operations surface reports `outbox_event` and `notification_delivery` facts. The product requirements call for operator retries, but a retry is a stateful command with concurrency, lease, deduplication, external-provider, and audit consequences. A control-plane shortcut could duplicate work or resend a notification that was already accepted. The business data model already supplies the authoritative outbox, delivery, idempotency, and audit concepts.

## Consequences

Operators receive a controlled, auditable retry request while the business platform preserves tenant invariants and delivery semantics. The route factory remains unmounted until the business command paths, service authentication, exact eligibility rules, response contract, and error policy are approved. A successful HTTP response means the authoritative command accepted and recorded the safe result; it does not promise external delivery.

## Rejected alternatives

- Direct operator writes to `outbox_event` or `notification_delivery`: rejected because they bypass business invariants, RLS, leases, and audit transaction boundaries.
- Resetting `status` or `attempts` from the operator service: rejected because it can race a worker and duplicate side effects.
- Sending notification provider requests from the operator service: rejected because provider idempotency and delivery reconciliation belong to the business notification boundary.
- Treating every failed or uncertain delivery as safe to resend: rejected until the authority defines reconciliation and duplicate-delivery controls.

## Approval gates

Business API owners must approve the exact command routes, service authentication, source states, transition semantics, response fields, target-concealment behavior, provider idempotency, and audit action names. Security reviewers must approve permissions, scope, reason handling, rate limits, logging, and replay behavior. Database owners must confirm that no schema change is needed or open a separate migration review. Release requires sequential and concurrent duplicate tests, lease-race tests, provider-uncertainty tests, adapter failure tests, typecheck, lint, tests, build, and `git diff --check`.
