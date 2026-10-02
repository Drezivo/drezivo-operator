# ADR 0009: Support activity read projection contract

**Status:** Proposed
**Date:** 2026-09-17

## Context

The operator system needs a Support Activity view so authorized staff can investigate actions performed under temporary support access. The business platform owns tenant boundaries, support grants, append-only audit events, redaction, and retention. A second operator-side history would become stale and could weaken revocation and tenant isolation.

## Decision

Reserve `GET /api/v1/support-activity`, protected by the dedicated `support.activity.read` permission, as a strictly bounded read projection. The route will use a typed business API adapter after the source contract is approved. It will expose only the twelve fields documented in `READ-ONLY-SUPPORT-ACTIVITY-DESIGN.md` and accept only the documented tenant, grant, actor, action, entity, outcome, time-range, limit, and opaque cursor filters.

The route owns authentication, active internal membership verification, permission checks, scope resolution, boundary validation, cursor binding, response envelopes, request IDs, no-store headers, and safe error mapping. The adapter receives normalized filters and server-resolved scope only. It receives no raw query string, browser role, credentials, SQL, arbitrary URL, or provider payload.

Results are ordered by `occurred_at DESC, event_id DESC`. The current route factory binds that tuple to normalized filters; the approved mounted adapter must also bind the resolved scope before production use. Unknown states, permissions, actions, entity types, scope kinds, fields, or unsafe values fail closed.

The business API and shared Neon database remain the only source of truth. This ADR adds no operator table, migration, index, cache, replica, direct Neon connection, audit write, export, or mutation.

## Consequences

Support activity has an explicit permission boundary separate from broad audit access. Operators receive bounded investigation context without unrestricted customer browsing or raw audit payloads. Production integration remains intentionally blocked until the source, redaction, scope, and endpoint contracts are approved.

## Rejected alternatives

- **A local support-activity table:** rejected because it duplicates immutable audit authority and can diverge from revocation or retention decisions.
- **A broad audit endpoint filtered only in the browser:** rejected because filtering and authorization must happen server-side.
- **A free-text activity search or export:** rejected because it increases privacy and exfiltration risk and requires a separate reviewed workflow.
- **Implicit support access through an operator role:** rejected because a role does not replace a tenant-scoped, expiring grant.

## Approval and implementation gates

1. Business API owners approve source authority, exact schemas, event relationship, scope, allowlists, ordering, cursor tuple, and retention.
2. Security and privacy reviewers approve the dedicated permission, grant isolation, actor and summary redaction, rate limits, and logging exclusions.
3. API maintainers approve the internal endpoint, service authentication, strict adapter validation, timeout, and stable error mapping.
4. Tests prove authorization denial, scope isolation, unknown-value rejection, cursor binding, deterministic pagination, extra-field rejection, unsafe-summary rejection, malformed responses, and dependency failures.
5. Release requires typecheck, lint, tests, build, and `git diff --check`.
