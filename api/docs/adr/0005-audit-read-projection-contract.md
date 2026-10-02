# ADR 0005: Audit read projection contract

**Status:** Proposed for review  
**Date:** 2026-09-17  
**Scope:** Read-only operator audit-event projection

## Context

Audit history is a business-system security record. The business API and Neon own tenant scope, append-only insertion, event ordering, and retention. The operator API needs searchable history for incident diagnosis and accountability, but a second store or unrestricted query would create competing authority and widen access to personal or secret data.

## Decision

Expose `GET /api/v1/audit-events`, authorized by `audit.read`, behind a typed business read adapter. The adapter may later use an approved internal business endpoint or reviewed read-only query path. This ADR does not imply that either integration exists.

The projection contains exactly `event_id`, `occurred_at`, `actor_kind`, `actor_key`, `action`, `entity_type`, `entity_id`, `support_grant_id`, `outcome`, `redacted_summary`, and `request_id`. `actor_kind` is `staff`, `operator`, or `system`; customer and account actors remain business audit history but are excluded from this operator projection. `support_grant_id` is a nullable UUID for tracing activity under an approved support grant and is never a grant token or permission substitute. `outcome` is `succeeded`, `rejected`, or `failed`. `entity_id`, `support_grant_id`, and `redacted_summary` may be null. Unknown fields, invalid values, contradictory values, and unsafe content are rejected.

The route accepts only `cursor`, `limit`, `tenant_id`, `actor_kind`, `action`, `entity_type`, `outcome`, `occurred_from`, and `occurred_to`. The default page size is 25 and the allowed range is 1 to 100. Results sort by `occurred_at` descending and then event identity descending. The opaque cursor binds the final `occurred_at` and event identity tuple to a hash of normalized filters. Offset pagination, arbitrary sorting, exports, and unrestricted search are prohibited.

## Boundary and failure semantics

Route validation and authorization happen before the adapter. The adapter receives normalized filters and server-resolved scope, never raw HTTP input, credentials, SQL, or a client-selected URL. The business API and Neon remain authoritative. There is no direct Neon connection, operator audit table, migration, cache, or replicated history.

Map failures as follows:

| Condition | Operator result |
| --- | --- |
| Invalid input or cursor | `400 VALIDATION_FAILED` |
| Missing or inactive identity | `401 UNAUTHENTICATED` |
| Missing `audit.read` or scope | `403 FORBIDDEN` |
| Upstream unavailable, unauthorized, missing, malformed, extra-field, or contradictory response | `503 DEPENDENCY_UNAVAILABLE` |

No failure may be represented as an empty page or guessed event. Responses and logs omit PII, raw bodies, tokens, secrets, headers, cookies, provider JSON, SQL, and stack traces. Logs contain request ID, route, result class, latency, and approved subject hash only.

## Consequences

- The business API and Neon stay the single source of truth.
- Operators receive bounded, redacted, attributable history with server-enforced scope.
- Append-only history cannot be changed through this surface, and retention remains a business/legal decision.
- Audit reads depend on the authoritative business read path and fail closed when it is unavailable.
- Any new field, status, filter, permission, export, persistence, or mutation requires a new review.

## Approval gates

1. Business API owners approve source authority, exact fields, allowlists, cursor ordering, scope, and retention.
2. Security and privacy reviewers approve `audit.read`, redaction, tenant/account boundaries, rate limits, logging, and no-store responses.
3. API maintainers approve adapter transport, timeout behavior, strict schemas, and failure mapping.
4. Tests cover authorization, unknown values, cursor binding, pagination, unsafe or extra upstream fields, dependency failures, and no direct database or migration dependency.
5. Typecheck, lint, tests, build, and `git diff --check` pass before release review.
