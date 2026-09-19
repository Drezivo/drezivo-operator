# Read-only support activity design

**Status:** Request-correlated route boundary implemented; transport adapter blocked pending source and wire-contract approval
**Scope:** Backend read projection for the internal Support Activity view

## Purpose

Support Activity gives an authorized operator a bounded history of actions performed under, or directly related to, a support grant. It is an audit projection, not a customer activity browser and not a second audit store. The business API and shared Neon schema remain authoritative.

The route factory, request-ID correlation, authorization seam, query validation, cursor binding, response projection, and fail-closed route behavior are implemented. No transport adapter is mounted or claimed to be ready. The adapter remains blocked until the business source endpoint, authority, scope model, allowlists, redaction policy, and exact wire contract are approved.

## Route and permission

Reserve `GET /api/v1/support-activity` and protect it with the dedicated `support.activity.read` permission. A caller must have a valid internal identity, active operator membership, the approved permission, and an authorized tenant or support-grant scope. A tenant membership never grants this permission. A support grant may narrow scope, but cannot grant the operator permission by itself.

The route is intentionally separate from the broader `audit.read` projection. This makes support visibility explicit and allows a narrower role, retention policy, and rate limit to be applied later.

## Minimal response projection

The first approved projection should contain only these fields:

| Field | Meaning | Safety rule |
| --- | --- | --- |
| `tenant_id` | Tenant affected by the activity | UUID; returned only inside authorized scope |
| `event_id` | Immutable event identifier | UUID |
| `occurred_at` | Event creation time | RFC 3339 timestamp |
| `actor_kind` | `staff`, `operator`, or `system` | Closed enum; exact source mapping requires approval |
| `actor_key` | Redacted opaque actor identifier | Never a token, email, raw Clerk claim, or secret |
| `action` | Stable action name | Bounded opaque token or approved allowlist |
| `entity_type` | Affected entity category | Bounded opaque token or approved allowlist |
| `entity_id` | Affected entity identifier | UUID or `null` |
| `support_grant_id` | Grant associated with the activity | UUID or `null`; source must define when null is valid |
| `outcome` | `succeeded`, `rejected`, or `failed` | Closed enum matching the canonical audit model |
| `request_id` | Request correlation identifier | Bounded opaque key; never a bearer credential |
| `redacted_summary` | Safe human-readable event context | Nullable, bounded, redacted text or approved structured summary |

The adapter must validate the response strictly and reject unknown fields, missing identifiers, unsafe text, malformed UUIDs, future timestamps, contradictory values, or unsupported enum values. It must not silently strip fields and continue.

## Query filters and pagination

The normalized query accepts only the following filters:

| Filter | Type | Rule |
| --- | --- | --- |
| `tenant_id` | UUID | Optional; must be within resolved operator scope |
| `support_grant_id` | UUID | Optional; must be within resolved tenant and grant scope |
| `actor_kind` | `staff\|operator\|system` | Optional closed enum |
| `action` | bounded token | Optional; exact approved allowlist is unresolved |
| `entity_type` | bounded token | Optional; exact approved allowlist is unresolved |
| `outcome` | `succeeded\|rejected\|failed` | Optional closed enum |
| `occurred_from` | RFC 3339 timestamp | Optional inclusive lower bound |
| `occurred_to` | RFC 3339 timestamp | Optional upper bound; it must be after `occurred_from` |
| `limit` | integer | 1 through 100; default 25 |
| `cursor` | opaque string | Server-issued and filter-bound |

Results sort by `occurred_at DESC, event_id DESC`. The current route factory encodes the final ordering tuple and a hash of normalized filters. The approved mounted adapter must add the resolved operator scope to that cursor binding before production use. The cursor must be opaque, bounded in lifetime, and rejected when malformed, expired, copied to another route, or used with changed filters or scope. Offset pagination, arbitrary sorting, free-text search, field selection, exports, and unrestricted history are out of scope.

## Response and failure behavior

Use the shared response envelope:

```json
{ "data": { "items": [], "next_cursor": null }, "request_id": "..." }
```

Invalid input or cursor returns `400 VALIDATION_FAILED`. Missing identity returns `401 UNAUTHENTICATED`. Missing permission or scope returns `403 FORBIDDEN`. Unavailable, malformed, privacy-unsafe, unreconciled, or extra-field source data returns `503 DEPENDENCY_UNAVAILABLE`. A dependency failure must never look like an empty page or a partial success. Responses are `Cache-Control: no-store`.

Errors and logs must not disclose tenant existence, raw upstream payloads, SQL, credentials, tokens, or private summary content. Logs may contain request ID, route, result class, latency, and an approved operator subject hash.

## Ownership and database impact

This slice adds no local database, table, index, migration, cache, replica, audit write, export job, or direct Neon connection. The business API owns `audit_event` and `global_audit_event`, append-only retention, redaction, tenant isolation, and event semantics. The operator service consumes an approved typed read projection.

## Transport status

The route must remain on its unavailable adapter until the unresolved source questions below are answered. The eventual adapter input contract must explicitly define normalized filters, the decoded cursor, the limit, scope information, and the request ID before implementation. It must use an allowlisted internal path, propagate the request ID and approved service authentication, validate the response envelope and projection strictly, and map malformed or privacy-unsafe successful responses separately from transport failures. It must not connect directly to Neon or forward browser credentials.

## Unresolved source contract questions

Before implementation, the business API and security reviewers must approve:

1. Whether support activity is sourced from `audit_event`, `global_audit_event`, or a reviewed union with a precise reconciliation rule.
2. Whether `support_grant_id` must be non-null for every result or whether related operator actions may legitimately be null.
3. Exact action and entity-type allowlists, including whether tenant-facing staff activity is included.
4. Exact actor-key derivation and redaction policy.
5. Whether `redacted_summary` is text or a bounded structured object, and its maximum size.
6. Scope behavior for one tenant, several assigned tenants, and one support grant.
7. Retention, rate limits, and whether event timestamps are authoritative `created_at` values exposed as `occurred_at`.
8. The internal endpoint, service authentication, response envelope, and error mapping.

No implementation should guess these values. Unknown roles, permissions, event states, scope kinds, and source fields fail closed.

## Review gates

Business API owners approve source authority, exact fields, action and entity allowlists, scope, ordering, cursor tuple, and retention. Security and privacy reviewers approve `support.activity.read`, grant isolation, redaction, rate limits, no-store behavior, and logging exclusions. API maintainers approve the adapter schema, timeout, and stable error mapping. Tests must cover authorization denial, unknown values, cursor binding, deterministic pagination, scope leakage, unsafe or extra upstream fields, and dependency failures. Release requires typecheck, lint, tests, build, and `git diff --check`.
