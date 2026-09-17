# ADR 0008: Operator directory read projection contract

**Status:** Proposed for review
**Date:** 2026-09-17
**Scope:** Read-only Admin Team operator directory

## Context

The operator web application needs an Admin Team view. Clerk can verify internal identity and organization membership, but its claims and profile data are not Drezivo's complete authorization model. Merchant memberships are separate from internal operators. Copying either provider profiles or merchant memberships into this service would create competing authority and expose unnecessary personal data.

## Decision

Reserve `GET /api/v1/operators`, protected by `operator.directory.read`, as a read-only projection behind an approved typed identity and operator adapter. The operator API will not create an operator table, migration, cache, or replicated directory. The authoritative source, stable identifier, exact role and status allowlists, tenant-count derivation, and cursor tuple must be approved before production integration.

The safe first projection is limited to an opaque operator identifier, approved display name, Drezivo role, lifecycle status, last activity timestamp, and a nonnegative assigned-tenant count. Email, phone, avatar URLs, Clerk metadata, membership IDs, token claims, sessions, IP and device data, private notes, and raw provider payloads are excluded unless a separate field-level review approves them.

The route accepts only bounded `cursor`, `limit`, `status`, and `role` filters. Results are deterministic by the approved last-activity tuple and operator identifier. Cursors bind to filters and server-resolved scope. Unknown values, free-form sort, search, exports, and field selection are rejected or out of scope.

## Boundary and failure semantics

Authentication, active internal membership, Drezivo permission authorization, scope resolution, query validation, cursor binding, envelopes, request IDs, and no-store headers belong to the route. The adapter receives normalized filters and authorized scope, never raw HTTP input, credentials, SQL, or arbitrary URLs. Provider identity is reconciled with the Drezivo operator record before a result is returned.

Invalid input maps to `400 VALIDATION_FAILED`; missing identity maps to `401 UNAUTHENTICATED`; missing permission or scope maps to `403 FORBIDDEN`; unavailable, unreconciled, malformed, extra-field, future, or privacy-unsafe upstream data maps to `503 DEPENDENCY_UNAVAILABLE`. A dependency failure cannot be represented as an empty or partial directory.

## Consequences

- Clerk remains an identity signal, while Drezivo owns operator role, status, permissions, and audit decisions.
- Merchant membership records remain separate and are not treated as internal operator records.
- The Admin Team view is bounded, auditable, and fail-closed.
- No database or migration work is required for this contract.
- The route factory remains unmounted until the source and field questions in `docs/READ-ONLY-OPERATOR-DIRECTORY-DESIGN.md` are answered.

## Approval gates

1. Approve the authoritative source and provider-to-Drezivo identity reconciliation.
2. Approve exact fields, roles, statuses, tenant-count derivation, ordering, cursor tuple, and retention.
3. Approve privacy, rate-limit, logging, and no-store rules.
4. Add adapter and route tests for denial, strict schemas, pagination, provider failure, and no database dependency.
5. Run typecheck, lint, tests, build, and `git diff --check` before a release review.
