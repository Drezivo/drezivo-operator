# ADR 0002: Read-only projection port for operator views

**Status:** Accepted for the first overview wave  
**Date:** 2026-09-17  
**Decision owners:** Drezivo platform maintainers

## Context

The internal operator API needs safe business and tenant summaries for dashboards,
business search, and tenant detail views. Those views must not create a second
source of truth or turn the operator system into an unrestricted customer-data
browser.

The business API and its Neon records already own tenant, branch, membership,
subscription, plan, and entitlement state. The operator API has a different
authorization boundary and must therefore consume a deliberately limited read
surface.

This decision aligns with
[`READ-ONLY-OVERVIEW-DESIGN.md`](../READ-ONLY-OVERVIEW-DESIGN.md), which defines
the first routes, response fields, failure codes, privacy exclusions, and test
requirements.

## Decision

The operator API will expose a typed read-only projection port. Its adapter may
call an approved internal business read endpoint or a reviewed read-only query
path. The port owns the operator-facing contract and maps provider responses to
the safe response shapes defined by the overview design.

The business API and Neon remain authoritative. The operator API will not create
a second tenant database, copy tenant records, or maintain denormalized operator
tables for this wave. It will not infer business state from Clerk claims,
frontend data, caches, or support-grant existence.

The boundary is:

```text
operator web
    -> operator API route and operator authorization
        -> read-only projection port
            -> approved business read endpoint or reviewed read-only query
                -> authoritative business records in Neon
```

The adapter must provide only the fields required by the approved contract:

- tenant identity and operational status
- currency, timezone, and timestamps
- safe branch summaries and counts
- membership status counts
- subscription summary
- entitlement capability counts
- bounded aggregate attention counts and recent signups where authorized

The adapter must exclude owner and member contact details, customer profiles,
reservation rows, payment credentials and evidence, private files, raw Clerk
profiles or identifiers, secrets, arbitrary provider payloads, and unrestricted
JSON. A future screen that needs an excluded field requires a separate contract
and authorization review.

## Authorization and concealment

Operator authentication and permission checks happen before the projection port
is called. The port receives a validated operator context and normalized query,
not raw HTTP input. Unknown roles, permissions, tenant states, filters, and
provider fields fail closed.

An absent tenant and a tenant hidden by authorization use the same safe
`NOT_FOUND` result. Provider errors, malformed projections, timeouts, and
contradictory source values become typed internal errors. They must not expose
SQL, driver details, provider payloads, or whether a hidden tenant exists.

Tenant-specific responses use `Cache-Control: no-store`. Logs may contain the
request ID, route, operator subject hash, result class, and latency. They must
not contain response bodies, personal search values, secrets, or raw provider
identifiers.

## Consistency and failure behavior

Dashboard aggregates are point-in-time views and do not promise a transactionally
consistent snapshot across every source. Each authoritative field must still be
read from its owning source. If the approved read sources disagree, the adapter
returns a safe consistency or dependency error and emits only a redacted
diagnostic tied to the request ID. It must not silently choose one value.

Downstream timeouts and unavailable reads map to `DEPENDENCY_UNAVAILABLE`.
Malformed input maps to `VALIDATION_FAILED`; authentication and permission
failures use the stable authentication and authorization codes. Search, overview,
and detail reads remain authenticated and rate limited.

## Consequences

### Benefits

- There is one authoritative tenant and billing state.
- Operator views have a narrow, reviewable privacy boundary.
- Business domain invariants stay in the business API.
- Provider replacement or endpoint changes are isolated behind one adapter.
- The first wave requires no Neon migration or data synchronization job.

### Costs

- Operator reads depend on business API availability or an approved database
  read path.
- New operator fields require contract and authorization review.
- Aggregate screens may show values from different point-in-time reads.
- A future high-volume operator view may need a separately reviewed projection,
  cache, or reporting store.

## Rejected alternatives

### Replicating all tenant data into an operator database

Rejected for the first wave. It creates synchronization, deletion, privacy,
access-control, and consistency obligations without being necessary for the
initial read-only views.

### Direct unrestricted queries from operator routes

Rejected. It couples HTTP handlers to the schema, makes field concealment easy to
break, and permits accidental customer-data exposure.

### Treating Clerk as the business source of truth

Rejected. Clerk provides identity and organization context. Tenant, membership,
subscription, entitlement, and operational state remain owned by the business
domain.

## Future schema and database review trigger

No database change is required for this decision. A future schema change must be
reviewed before implementation if it does any of the following:

1. Adds a new operator-visible field or a new source of authoritative state.
2. Requires copying, denormalizing, caching, or retaining tenant records.
3. Adds support-grant, operator-membership, audit, job, or notification tables.
4. Changes deletion, retention, tenant isolation, or personal-data handling.
5. Adds direct operator write access to business-owned records.
6. Changes indexes, roles, permissions, or query limits for operator reads.

The review must update the relevant contract, threat and privacy analysis,
authorization rules, migration plan, rollback plan, and tests. It must state why
an existing business read endpoint or reviewed read-only path cannot satisfy the
requirement.

## Verification required before implementation acceptance

The implementation must satisfy the tests listed in
[`READ-ONLY-OVERVIEW-DESIGN.md`](../READ-ONLY-OVERVIEW-DESIGN.md), including
authorization rejection, schema validation, cursor stability, excluded-field
checks, safe downstream failures, rate limiting, and no-store headers.

