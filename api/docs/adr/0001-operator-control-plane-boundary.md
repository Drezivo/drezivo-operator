# ADR 0001: Operator control-plane boundary

**Status:** Accepted for foundation design  
**Date:** 2026-09-17

## Context

Drezivo needs an internal system for founders, support, billing, and platform operations. The business API already owns tenant, membership, subscription, entitlement, and operational invariants. Duplicating those writes in a new service would create conflicting authority, inconsistent authorization, and difficult recovery paths.

## Decision

The operator API is a separate control plane. The business API remains the source of truth for business facts and tenant mutations. The operator API may provide operator-specific read projections and may invoke allowlisted internal business commands, but it must not write tenant data through unrestricted direct queries or duplicate domain logic.

All operator mutations require server-side role checks, narrow scope, idempotency, and an audit event. Temporary support access is represented by an expiring, tenant-scoped grant with explicit permission codes. There is no universal support bypass.

The system does not provide unrestricted customer browsing. Operators see safe projections and use an active grant for approved support work. Private evidence and exports require separate capabilities and are audited.

Neon remains the shared durable source of truth. This foundation does not add a second tenant database or replicate tenant records into an operator store.

## Consequences

- Tenant invariants remain in one business boundary.
- Operator actions can be reviewed and revoked.
- The operator API needs stable internal command contracts and safe read projections.
- Some screens may initially show summaries instead of full business records.
- Any future operator-only persistence requires a separate migration and security review.

## Rejected alternatives

- A second replicated tenant database as the initial design, because it introduces freshness and deletion risks.
- A universal operator role that bypasses tenant scope, because it weakens least privilege and auditability.
- Direct writes from operator UI or arbitrary SQL, because they bypass business rules and idempotency.
