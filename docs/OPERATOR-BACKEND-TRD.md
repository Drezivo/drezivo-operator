# Drezivo Operator API TRD

**Status:** Foundation design  
**Scope:** Backend repository for the internal operator system

## Architecture

The operator API is an Express and TypeScript REST service. It is a control-plane boundary between the internal operator web app and the business platform. The dependency direction is route validation and authorization, application service, controlled business command or read projection, then data access. HTTP handlers do not contain business rules or direct unrestricted tenant access.

The API is versioned under `/api/v1`. A health endpoint is separate from authenticated operator routes and returns only service readiness information.

## Trust boundaries

1. The browser is untrusted. It may submit stale, duplicated, or manipulated input.
2. Clerk verifies internal identity. Clerk claims are an identity signal, not the complete Drezivo authorization decision.
3. The operator API verifies the token, resolves the internal operator role, checks active status and scope, and records request context.
4. The business API remains authoritative for tenant and business mutations. The operator API calls allowlisted internal commands or read projections.
5. Neon is the durable source of truth. S3 is private object storage and is never exposed through public credentials.

## Authentication and authorization

Use one explicit internal operator boundary. The initial deployment may use a dedicated Clerk organization such as `Drezivo Operations`. Recommended roles are `platform_owner`, `platform_operator`, `support_operator`, `billing_operator`, and `read_only_operator`.

Every protected request must have a valid Clerk token, active internal membership, and a Drezivo permission decision. Tenant-facing memberships do not grant operator access. Support grants add narrowly scoped, expiring tenant permissions and never replace operator authorization.

## Data and migrations

No second tenant database is introduced in this foundation. Neon remains shared with the business system. The operator API must use controlled read models or internal API commands. Any operator-only table requires a separate migration review, ownership decision, least-privilege role, retention rule, and integration tests.

Existing core facts include tenant and branch records, memberships, subscriptions, plan and entitlement versions, support grants, append-only audit events, outbox events, jobs, and notification deliveries. The operator service must respect their constraints and should not mirror Clerk profile fields or sensitive evidence.

## API standards

- Parse JSON and route parameters with Zod at the boundary.
- Use the shared Drezivo response envelope and stable error codes.
- Allowlist filters, sort fields, permission codes, and state transitions.
- Use cursor pagination for operator lists.
- Require `Idempotency-Key` on mutating commands. The key is scoped to operator, operation, and target; the payload hash must match on replay.
- Claim idempotency only after authentication and authorization succeed, before side effects.
- Set request IDs and propagate them to logs, audit records, and downstream calls.
- Map provider and database errors to safe typed responses.

Suggested route families:

- `GET /api/v1/overview`
- `GET /api/v1/businesses`
- `GET /api/v1/businesses/:tenantId`
- `GET /api/v1/subscriptions`
- `GET /api/v1/entitlements`
- `POST /api/v1/support-grants`
- `POST /api/v1/support-grants/:grantId/revoke`
- `GET /api/v1/support-activity`
- `GET /api/v1/operators`
- `GET /api/v1/audit-events`
- `GET /api/v1/jobs`
- `POST /api/v1/jobs/:jobId/retry`
- `GET /api/v1/notifications`

Routes are illustrative until contracts are reviewed. They must not be implemented as unrestricted database browsers.

## Jobs and notifications

Use durable Postgres records or the existing business outbox. A worker claims a lease, performs an idempotent action, records a safe result, and transitions to success or a terminal dead state after bounded retries. Operator retry creates a new auditable intent or safely replays an existing one; it must not bypass deduplication.

## Storage

S3 access is backend-only. Objects are private, namespaced, size and content-type limited, scanned or quarantined where applicable, and served with short-lived signed URLs after authorization. File downloads and evidence access are audited.

## Observability and operations

Use structured redacted logs, request IDs, metrics for authorization failures, grant creation, command latency, job age, retries, and notification outcomes. Health checks distinguish process readiness from dependency readiness. Alerts must not include secrets or raw personal data.

## Testing and release gates

Required behavior tests include invalid and expired operator membership, role denial, support-grant scope and expiry, unknown enum rejection, malformed provider response handling, sequential duplicate commands, concurrent duplicate commands, and audit creation. Integration tests use a real Neon-compatible Postgres environment before production certification.

Every change must pass formatting, lint, typecheck, unit tests, integration tests where applicable, build, and `git diff --check`. Database or authorization changes require a reviewer familiar with the business contracts and a documented rollback or forward-fix plan.

## Phased implementation

Implement the foundation first, then read-only projections, then support and operator commands, then operational controls and hardening. Do not add tenant replication, unrestricted customer search, or direct mutation shortcuts to accelerate an early phase.
