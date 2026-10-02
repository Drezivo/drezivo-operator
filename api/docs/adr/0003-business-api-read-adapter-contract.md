# ADR 0003: Business API read adapter contract

**Status:** Superseded by the current Overview bridge contract in `BUSINESS-READ-ADAPTER-DESIGN.md`
**Date:** 2026-09-17  
**Scope:** Read-only operator overview and business summary projections

## Context

The operator API route layer already defines three read surfaces under `/api/v1`:

- `GET /overview`
- `GET /businesses`
- `GET /businesses/:tenantId`

The route layer must consume business facts through one narrow adapter boundary. The
business API and its Neon records remain authoritative, as described in
[`READ-ONLY-OVERVIEW-DESIGN.md`](../READ-ONLY-OVERVIEW-DESIGN.md) and ADR 0002.
This decision specifies the proposed adapter contract so that a future business API
integration cannot widen the operator privacy boundary or silently change failure
semantics.

## Decision

Introduce a business API read adapter behind the existing `ReadPort` interface. The
adapter accepts normalized values produced by the operator route and authorization
layers. It does not accept an Express request, Clerk claims, browser-supplied role,
or raw query string.

The adapter exposes these operations:

```ts
type BusinessApiReadAdapter = {
  overview(input: { principal: SafeOperatorPrincipal; requestId: string }): Promise<OperatorOverview>;
  listBusinesses(input: {
    filters: BusinessListFilters;
    limit: number;
    cursor: { createdAt: string; tenantId: string } | null;
  }): Promise<BusinessListResult>;
  getBusiness(input: { tenantId: string }): Promise<BusinessDetail | null>;
};
```

The returned values must be the approved projection shapes in the overview design.
The adapter must not return owner or member contact details, customer profiles,
reservation rows, payment credentials or evidence, private files, raw Clerk
profiles or identifiers, secrets, arbitrary provider payloads, or unrestricted JSON.

### Upstream endpoint shapes

The business API endpoint and version are configuration, not a route-level decision.
When approved, the adapter maps its operations to an internal business read API with
these logical shapes:

```text
GET {businessReadBaseUrl}/internal/operator/v1/overview
GET {businessReadBaseUrl}/internal/operator/v1/businesses
    ?cursor_created_at={cursorCreatedAt}&cursor_tenant_id={cursorTenantId}
    &limit={limit}&q={q}&status={status}&plan_code={planCode}
    &sort=created_at_desc
GET {businessReadBaseUrl}/internal/operator/v1/businesses/{tenantId}
```

The Overview assertion is signed with `INTERNAL_OPERATOR_ASSERTION_SECRET`, bound to
the verified operator and fixed method/path, and sent as
`X-Drezivo-Operator-Assertion` beside internal service authentication and
`X-Request-ID`. The current endpoint generates its own `as_of`; callers cannot
choose one. Query values are encoded by an HTTP client, never
concatenated into SQL or an untrusted URL. The operator route owns the opaque cursor
and decodes it before calling the adapter. The adapter transport sends the normalized
`cursor_created_at` and `cursor_tenant_id` tuple fields, or omits both fields for the
first page. The list request uses the normalized allowlisted filters. The adapter does
not add offset pagination, arbitrary sort fields, field selection, exports, or bulk
search.

The adapter returns the approved data to the route layer, which owns the existing
success envelope and `request_id`. A missing detail response maps to `null`, allowing
the route to use the safe `NOT_FOUND` result for both absent and hidden tenants.

### Strict response validation

Every upstream response is treated as untrusted, including responses from an internal
business service. Validate the HTTP status, content type, envelope, and complete data
shape at the adapter boundary with the approved strict schemas. Reject unknown keys,
unknown enum values, malformed UUIDs and timestamps, negative counts, invalid currency
codes, invalid cursor tuples, and excluded fields. Do not strip unknown fields and
continue. Do not pass provider JSON through to callers.

Malformed or contradictory projection data becomes a safe typed dependency or
consistency error. The adapter must not infer missing values from Clerk, frontend
state, caches, or support-grant existence.

### Authentication and configuration boundary

Operator authentication, active membership, role, permission, request ID, and branch
or tenant scope checks happen before the adapter is called. The adapter receives only
the validated operator context needed for an approved internal request. A business
application membership does not authorize this adapter.

The adapter reads only server-side configuration for the approved base URL, timeout,
and internal authentication material. Missing, malformed, or unsupported configuration
fails closed during startup or adapter construction. Secrets remain in the runtime
secret manager or environment and are never logged, returned, or placed in query
parameters. The adapter must not accept a base URL, token, role, permission, or scope
from an HTTP request.

No direct Neon connection, SQL query, schema mapping, tenant database copy, operator
table, migration, or replicated record is part of this contract. If a reviewed
read-only query path is later chosen instead of the business endpoint, it must remain
behind the same adapter and receive a separate data-access review.

### Timeout and error mapping

Use one bounded request timeout for each upstream call. Abort timed-out requests and
map timeouts, connection failures, upstream `5xx` responses, and unavailable upstream
services to `503 DEPENDENCY_UNAVAILABLE`. Do not retry in the route handler and do not
turn a read timeout into an empty or partial projection.

Map upstream outcomes as follows:

| Upstream condition | Operator API result |
| --- | --- |
| Valid projection response | Typed success envelope from the route |
| Valid missing detail | `404 NOT_FOUND` through the route |
| Invalid operator input rejected before call | `400 VALIDATION_FAILED` |
| Upstream `401` or `403` | Safe `503 DEPENDENCY_UNAVAILABLE`; emit no upstream details |
| Upstream `404` for list or overview | `503 DEPENDENCY_UNAVAILABLE` |
| Timeout, DNS, connection, or upstream `5xx` | `503 DEPENDENCY_UNAVAILABLE` |
| Malformed, extra-field, or contradictory response | `503 DEPENDENCY_UNAVAILABLE` or a reviewed consistency error |
| Unexpected adapter exception | `503 DEPENDENCY_UNAVAILABLE` |

The public error envelope and stable codes remain those already documented by the
overview design. Error messages must not reveal SQL, driver details, upstream URLs,
tokens, response bodies, or whether an unauthorized tenant exists. Logs may include
request ID, route, result class, and latency only, with operator subject represented
by its approved hash.

## Consequences

- Route handlers remain independent of the business API transport and provider.
- Response validation protects the operator boundary even when the upstream service
  changes unexpectedly.
- Business API availability is a dependency of operator reads.
- A new field, endpoint, permission, source of authority, or consistency rule needs a
  contract and authorization review before implementation.
- This proposal does not claim a production business endpoint, credentials, timeout
  value, or deployment topology exists.

## Approval and implementation gates

Before implementation is accepted:

1. Business API owners approve the internal endpoint shapes, version, response
   schemas, source-of-truth ownership, and missing-record semantics.
2. Security and privacy review approve the field allowlist, operator permissions,
   authentication method, secret handling, logging fields, rate limits, and timeout.
3. API maintainers approve the adapter configuration contract and stable error mapping.
4. Tests prove strict response rejection, excluded-field rejection, timeout and
   upstream failure mapping, safe missing detail behavior, cursor/filter preservation,
   and no direct Neon or migration dependency.
5. The implementation passes the repository typecheck, lint, test, build, and diff
   checks. Deployment or production configuration remains a separate authorization.

Any request to add a database table, migration, replicated tenant record, unrestricted
field, customer search, or operator mutation leaves this proposal and requires a new
decision.
