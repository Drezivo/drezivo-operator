# ADR 0007: Support grant command boundary

**Status:** Proposed for review
**Date:** 2026-09-17

## Context

The operator service needs controlled support access for one tenant. The business API already defines `support_grant` as a tenant-scoped, time-bounded, reason-coded and revocable permission record. It also owns append-only audit events, idempotency records, tenant invariants, and Neon persistence. A second write path in the operator service would create competing authority and weaken tenant isolation.

## Decision

Support-grant creation and revocation will be exposed as typed operator commands delegated to an approved business API adapter:

- `POST /api/v1/support-grants`, authorized by `support.grant.create`.
- `POST /api/v1/support-grants/:grantId/revoke`, authorized by `support.grant.revoke`.

The operator service performs authentication, fresh internal membership verification, server-side authorization, strict boundary validation, idempotency coordination, safe error mapping, and response validation. The business API performs the authoritative transaction and owns all `support_grant`, audit, outbox, and related persistence. The operator service has no local support-grant table and adds no migration under this ADR.

The operator API validates and forwards the idempotency key only after authentication, authorization, and input validation. The authoritative business command claims and finalizes idempotency atomically with the grant and audit outcome, scoped to operator, operation, target, and key. The operator API owns no second idempotency record. Canonical request-hash mismatch is a conflict. Sequential and concurrent replays must produce one authoritative grant transition and one corresponding command outcome.

## Consequences

The design preserves one source of truth and makes the operator API safe to deploy before the business command endpoint is available. Until the adapter endpoint, shared contracts, permission allowlist, grant duration policy, service authentication, and audit action names are approved, the command routes remain unavailable or unimplemented and must fail closed.

The command implementation will require route and adapter tests for authorization ordering, duplicate requests, replay conflicts, expiry, revocation, cross-tenant concealment, malformed dependency responses, and safe logging. It will also require a separate review if business persistence needs a schema or constraint change.

## Rejected alternatives

- **Direct operator writes to shared Neon:** rejected because it duplicates business authority and can bypass business transaction invariants.
- **A local operator support-grant mirror:** rejected because stale authorization could outlive expiry or revocation and create a second tenant security model.
- **Clerk organization membership as the grant record:** rejected because Clerk identity and organization membership do not represent Drezivo's tenant-scoped permission, reason, expiry, or audit requirements.
- **Implicit universal support access:** rejected because private evidence and other sensitive capabilities require explicit grants.

## Approval gates

Business API owners approve the command endpoint, exact schemas, transaction behavior, tenant lookup, state transitions, and persistence. Security reviewers approve permission scope, recent authentication, idempotency ordering, rate limits, audit coverage, and logging exclusions. API maintainers approve adapter authentication, timeout, response validation, and stable error mapping. No implementation or migration is production-ready until these decisions and the required sequential/concurrent duplicate tests are complete.
