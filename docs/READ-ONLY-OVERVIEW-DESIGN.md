# Read-only operator overview design

**Status:** Next-wave design for review  
**Scope:** Read-only overview and business summary projections  
**Database impact:** None. This wave adds no tables, indexes, migrations, or replicated tenant records.

## Purpose and boundary

This wave gives authorized Drezivo operators a safe view of platform and tenant status. The operator API is a control-plane consumer of the business platform. The business API and Neon records remain authoritative. The operator API must use an approved internal read projection or a reviewed read-only query path. It must never become an unrestricted customer-data browser.

The projection may include tenant identity and operational summaries. It must exclude reservation rows, customer profiles, payment credentials, payment evidence, private files, raw Clerk profiles, secrets, and arbitrary JSON blobs. A later support workflow may provide narrower tenant access through an active, audited support grant.

## Authentication and authorization

Every route below requires:

1. A valid Clerk token for the internal operator organization.
2. An active Drezivo operator membership.
3. A known role and an allowlisted permission for the requested projection.
4. A request context containing the operator subject and request ID.

Recommended read permissions:

| Route | Required permission |
| --- | --- |
| `GET /api/v1/overview` | `operator.overview.read` |
| `GET /api/v1/businesses` | `business.summary.read` |
| `GET /api/v1/businesses/:tenantId` | `business.summary.read` |

`read_only_operator` may receive the three projections. `support_operator`, `billing_operator`, `platform_operator`, and `platform_owner` receive only the permissions assigned to their internal membership. A business-app membership never grants operator access. Unknown roles, permissions, tenant states, or filter values fail closed.

## Response envelope

Use the existing Drezivo envelope:

```json
{
  "success": true,
  "data": {},
  "request_id": "req_123"
}
```

Expected failures use the existing stable codes, including `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, and `INTERNAL_ERROR`. Messages must not reveal whether an unauthorized tenant exists.

## Route contracts

### `GET /api/v1/overview`

Returns an aggregate snapshot. It is a point-in-time read and does not claim a transactionally consistent dashboard across every source.

This route accepts no query parameters. In particular, callers cannot select `as_of`; the business API supplies the snapshot timestamp.

Response data:

```ts
type OperatorOverview = {
  as_of: string;
  businesses: {
    total: number;
    by_status: Array<{ status: "active" | "restricted" | "cancelled"; count: number }>;
  };
  subscriptions: {
    active: number;
    trial: number;
    grace: number;
    past_due: number;
    restricted: number;
    cancelled: number;
    missing: number;
    expired_trials: number;
    expired_grace: number;
    incomplete_trials: number;
    incomplete_grace: number;
  };
  attention: {
    failed_jobs: number;
    failed_notifications: number;
    active_support_grants: number;
  };
  recent_businesses: Array<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "restricted" | "cancelled";
    created_at: string;
  }>;
};
```

Counts are safe aggregates. `recent_businesses` is capped by the server, uses a fixed newest-first order, and contains no owner email, customer data, payment details, or free-form provider payload.

### `GET /api/v1/businesses`

Returns a cursor-paginated business summary list.

Query parameters:

| Parameter | Type | Rule |
| --- | --- | --- |
| `cursor` | opaque string | Server-issued cursor only; reject malformed or cross-query cursors |
| `limit` | integer | Default 25, minimum 1, maximum 100 |
| `q` | string | Optional, trimmed, maximum 80 characters; search only allowlisted business name or slug fields |
| `status` | enum | Repeatable allowlist: `active`, `restricted`, `cancelled` |
| `plan_code` | enum/string | Allowlisted plan codes from the business contract; reject unknown values |
| `sort` | enum | `created_at_desc` only in this wave |

Response data:

```ts
type BusinessSummary = {
  tenant_id: string;
  business_name: string;
  slug: string;
  status: "active" | "restricted" | "cancelled";
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  branch_count: number;
  active_member_count: number;
  subscription: {
    plan_code: string;
    status: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
  } | null;
};

type BusinessSummaryPage = {
  items: BusinessSummary[];
  next_cursor: string | null;
};
```

The server applies tenant status and plan filters before pagination. Ordering is deterministic by `created_at DESC, tenant_id DESC`. Cursors encode the last ordering tuple and a hash of the normalized filter set. Offset pagination and client-provided SQL fragments are prohibited.

### `GET /api/v1/businesses/:tenantId`

Returns one safe tenant summary. `tenantId` must be a UUID. A missing record and a record hidden by authorization both return the safe `NOT_FOUND` response.

Response data:

```ts
type BusinessDetailSummary = {
  tenant_id: string;
  business_name: string;
  slug: string;
  status: "active" | "restricted" | "cancelled";
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  branches: Array<{
    branch_id: string;
    name: string;
    code: string;
    status: string;
    timezone: string;
  }>;
  membership_summary: {
    active_count: number;
    invited_count: number;
    suspended_count: number;
  };
  subscription: {
    plan_code: string;
    status: string;
    current_period_start: string;
    current_period_end: string;
    trial_ends_at: string | null;
    grace_ends_at: string | null;
    cancel_at_period_end: boolean;
  } | null;
  entitlement_summary: {
    capability_count: number;
    overridden_capability_count: number;
  };
};
```

Branch addresses, member names and emails, Clerk identifiers, reservation counts, customer counts, payment records, evidence files, and raw entitlement payloads are excluded from this first projection. If a future screen needs one of these, it requires a separate contract and authorization review.

## Authority and consistency

The tenant record is authoritative for `tenant_id`, business name, slug, status, currency, timezone, and timestamps. Branch records are authoritative for branch count and safe branch summaries. Membership records are authoritative for status counts. Subscription and plan records are authoritative for the subscription summary. Effective entitlements are authoritative for capability counts.

The operator API must not infer state from Clerk claims, frontend data, stale caches, or the existence of a support grant. If sources disagree, return a safe dependency or consistency error and emit a redacted diagnostic with the request ID. Do not silently combine contradictory values.

The first implementation should call an approved internal business read endpoint or use a reviewed read-only projection owned by the business API. Do not add a second tenant database, denormalized operator tables, or migrations in this wave.

## Failure, privacy, and abuse behavior

- Require `Cache-Control: no-store` for tenant-specific responses.
- Apply authenticated rate limits to search and detail reads. Return `429` with `Retry-After` when exceeded.
- Cap query length, page size, response size, and maximum date lookback.
- Treat malformed IDs, cursors, enums, and timestamps as `VALIDATION_FAILED`.
- Map downstream timeout or unavailable business reads to `DEPENDENCY_UNAVAILABLE`; do not expose driver errors.
- Log request ID, route, operator subject hash, result class, and latency only. Do not log query values containing personal data or response bodies.
- Do not add exports, bulk search, arbitrary field selection, or customer browsing to this wave.

## Required tests before implementation is accepted

1. Unauthenticated, inactive, unknown-role, and missing-permission requests are rejected.
2. A business-app membership cannot access any operator route.
3. Valid overview and list responses conform to the envelope and payload schemas.
4. Unknown status, plan, sort, timestamp, UUID, cursor, and oversized limit values fail closed.
5. Search cannot select arbitrary columns or return excluded fields.
6. Cursor pagination has stable ordering, rejects a cursor from different filters, and does not duplicate or skip rows across pages.
7. Tenant detail returns the same safe result for absent and unauthorized tenant identifiers.
8. Downstream timeout, malformed projection, and contradictory source data produce safe typed errors.
9. Responses contain no raw Clerk identifiers, emails, customer rows, payment data, secrets, or private object keys.
10. Rate limits apply to overview, search, and detail routes, and `Cache-Control: no-store` is set on tenant-specific responses.

## Explicit non-goals

This wave does not create or alter database schema, add support grants, mutate subscriptions or entitlements, retry jobs, expose private files, mirror tenant data, or implement unrestricted customer search. Those features require separate contracts, authorization decisions, idempotency behavior, audit events, and migration review where applicable.
