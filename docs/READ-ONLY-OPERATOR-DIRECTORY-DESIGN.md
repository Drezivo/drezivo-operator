# Read-only operator directory design

**Status:** Proposed for review
**Scope:** Safe, cursor-paginated Admin Team directory
**Database impact:** None. This design adds no operator table, migration, index, cache, or replicated identity record.

## Purpose and authority

The Admin Team screen needs a bounded directory of people who may operate the Drezivo control plane. It is an internal operator projection, not a Clerk profile browser and not a tenant membership list. The identity provider supplies verified identity and organization membership. Drezivo remains authoritative for the operator role, lifecycle status, assignment summary, and audit decisions.

The route is `GET /api/v1/operators` and requires `operator.directory.read`. It uses an approved typed provider or business read adapter. The operator API must not connect directly to Neon, copy Clerk users, or infer authorization from a browser role or a client-selected organization.

## Authorization and scope

The request first verifies the internal Clerk identity and active internal membership, then checks the Drezivo directory permission. The directory is limited to internal operators in the configured operations organization. A business membership or support grant does not grant access to this directory. Unknown roles, statuses, claims, and scope values fail closed.

Each request receives a request ID and uses `Cache-Control: no-store`. Directory reads are attributable in the approved audit path without recording raw tokens or profile payloads.

## Query contract

Only these query parameters are accepted:

| Field | Rule |
| --- | --- |
| `cursor` | Opaque server-issued cursor bound to the normalized filters and the final `(last_activity_at, operator_id)` tuple. Malformed, future, or cross-filter cursors are rejected. |
| `limit` | Integer, default `25`, minimum `1`, maximum `100`. |
| `role` | Optional single value: `platform_owner`, `platform_operator`, `support_operator`, `billing_operator`, or `read_only_operator`. |
| `status` | Optional single value: `active`, `suspended`, `revoked`, or `pending`. |

Results use the provider's approved last-activity ordering and the operator identifier as a stable tie-breaker. Null activity timestamps follow the provider contract. Offset pagination, arbitrary sort fields, search, exports, profile-field selection, and unbounded queries are out of scope.

## Safe response projection

The current boundary contains only the fields required for the Admin Team summary:

```ts
type OperatorDirectoryItem = {
  operator_id: string;           // bounded opaque Drezivo identifier
  display_name: string;          // bounded safe display label
  role: "platform_owner" | "platform_operator" | "support_operator" | "billing_operator" | "read_only_operator";
  status: "active" | "suspended" | "revoked" | "pending";
  last_activity_at: string | null;
  assigned_tenant_count: number; // nonnegative summary, not a tenant list
};
```

The provider identity key, role and status source, tenant-count derivation, and timestamp semantics require approval before production integration. Email, phone, address, avatar URL, Clerk metadata, membership IDs, token claims, sessions, IP and device data, recovery data, private notes, and raw provider payloads are excluded by default. A later field requires a separate privacy review and a documented purpose.

The adapter validates the approved opaque-ID format, timestamp format, nonnegative count bound, enum values, string lengths, and unknown-key absence. Malformed, contradictory, privacy-unsafe, or extra-field responses fail closed instead of being silently stripped.

## Ownership and adapter boundary

The route owns authentication, authorization, query validation, filter normalization, cursor encoding, response envelopes, request IDs, and no-store headers. A typed adapter receives normalized filters and server-resolved scope only. It receives no Express request, raw query string, browser role, bearer token, arbitrary URL, SQL fragment, or provider payload.

Clerk is an identity and organization-membership provider. Drezivo owns the operator role and status decision. If the authoritative operator record cannot be read or reconciled with the verified provider identity, the request fails closed.

## Failure mapping

| Condition | Operator result |
| --- | --- |
| Invalid query, enum, length, or cursor | `400 VALIDATION_FAILED` |
| Missing, expired, or inactive identity | `401 UNAUTHENTICATED` |
| Missing `operator.directory.read` or scope | `403 FORBIDDEN` |
| Timeout, connection failure, upstream failure, or unreconciled identity | `503 DEPENDENCY_UNAVAILABLE` |
| Malformed, extra-field, future, or privacy-unsafe response | `503 DEPENDENCY_UNAVAILABLE` |

A dependency failure must never become an empty or partial page. Errors must not disclose protected operator existence, provider details, SQL, credentials, or raw response data.

## Database and privacy impact

There is no database change. The operator API creates no directory mirror, cache, materialized view, or migration. Existing business `membership` rows describe merchant users and are not the operator directory. Any operator-only persistence requires a separate ownership decision, least-privilege role, retention policy, migration review, and rollback or forward-fix plan.

## Contract questions before production integration

1. What is the authoritative operator record and read endpoint?
2. What stable identifier, role, and status values does that source guarantee?
3. Is `display_name` sufficient, or is a reviewed email field required?
4. How is `assigned_tenant_count` computed without exposing tenant membership details?
5. What timestamp does `last_activity_at` represent, and what is the approved null ordering?
6. What cursor tuple and tie-breaker are guaranteed by the source?

The route factory remains unmounted until these questions and the typed source contract are approved.

## Approval gates

Business owners approve source authority, identity reconciliation, fields, roles, statuses, ordering, cursor tuple, and retention. Security and privacy reviewers approve field minimization, search behavior, logging, rate limits, and no-store behavior. API maintainers approve adapter configuration, timeout behavior, strict validation, and failure mapping. Tests must prove authorization denial, unknown-value rejection, cursor binding, deterministic pagination, malformed provider response rejection, and absence of direct Neon or migration dependency.
