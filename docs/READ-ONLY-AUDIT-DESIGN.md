# Read-only operator audit-event design

**Status:** Proposed for review  
**Scope:** Safe, cursor-paginated audit-event search  
**Database impact:** None. This design adds no operator table, migration, index, cache, or replicated record.

## Purpose and authority

The audit history is an append-only business record. The business API and Neon remain authoritative for its creation, ordering, retention, and tenant scope. The operator API exposes a narrowly validated read projection through an approved business API read adapter. It must not connect directly to Neon, create an audit mirror, or let an operator alter, delete, or replay an event.

The exact route is `GET /api/v1/audit-events`. It is a read-only surface and requires the server-side permission `audit.read`. A business-application membership, support grant, or frontend role does not grant this permission.

## Authorization and scope

Before the adapter is called, the route verifies a valid internal identity, active operator membership, known role, `audit.read`, and any tenant or account scope resolved by the server. Unknown roles, permissions, scope kinds, and filter values fail closed. A support grant can narrow an already-authorized request, but cannot widen it or provide universal audit access.

Every request receives a request ID. Authorization is evaluated on every request. Responses use `Cache-Control: no-store`.

## Query contract

The route accepts only these query parameters:

| Field | Rule |
| --- | --- |
| `cursor` | Opaque server-issued cursor. It encodes the last `occurred_at` and event identity tuple plus a hash of normalized filters. Reject malformed, expired, or cross-filter cursors. |
| `limit` | Integer, default `25`, minimum `1`, maximum `100`. |
| `tenant_id` | Optional UUID. It is accepted only when the resolved operator scope permits that tenant. |
| `actor_kind` | Optional single allowlist value: `staff`, `operator`, or `system`. |
| `action` | Optional single allowlisted action code approved by the business API. Unknown actions are rejected. |
| `entity_type` | Optional single allowlisted entity type approved by the business API. Unknown types are rejected. |
| `outcome` | Optional single allowlist value: `succeeded`, `rejected`, or `failed`. |
| `occurred_from` | Optional RFC 3339 timestamp, inclusive. |
| `occurred_to` | Optional RFC 3339 timestamp, exclusive; it must be after `occurred_from`. |

Filters are normalized before cursor hashing and applied before pagination. Ordering is deterministic by `occurred_at` descending, then event identity descending. Offset pagination, arbitrary sort fields, free-form search, field selection, exports, and bulk unbounded reads are out of scope. The response returns `next_cursor`, or `null` when there is no next page.

## Safe response projection

Each item contains exactly these fields:

```ts
type AuditEvent = {
  event_id: string;
  occurred_at: string;
  actor_kind: "staff" | "operator" | "system";
  actor_key: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  support_grant_id: string | null;
  outcome: "succeeded" | "rejected" | "failed";
  redacted_summary: string | null;
  request_id: string;
};
```

The list envelope contains only `items` and `next_cursor`. UUIDs, timestamps, enums, lengths, nullability, and unknown-key absence are validated strictly. The adapter must reject malformed, extra, contradictory, or privacy-unsafe upstream data. It must not strip unexpected fields and continue.

`actor_kind` is limited to `staff`, `operator`, and `system` in this operator projection. Customer and account actors remain in the business audit history but are excluded from this surface. `actor_key` is an approved stable opaque identifier, such as a hashed subject key. It is not an email, display name, Clerk profile, access token, session value, or raw credential. `support_grant_id` is a nullable UUID used only to trace activity performed under an approved support grant; it is not a grant token or permission substitute. `redacted_summary` is bounded, structured-safe text supplied by the business API. It must not contain PII, raw request or response bodies, payment evidence, private file content, secrets, tokens, provider payloads, or arbitrary JSON. The projection does not include IP addresses, browser identification strings, reason text, headers, cookies, SQL, or internal stack details.

## Adapter boundary and failure mapping

The route owns authentication, authorization, query validation, filter normalization, cursor encoding, response envelopes, and request IDs. The typed adapter receives normalized filters and authorized scope only. It receives no Express request, raw query string, browser role, permission, token, arbitrary URL, SQL fragment, or provider payload.

| Condition | Operator result |
| --- | --- |
| Invalid query, UUID, timestamp, enum, range, or cursor | `400 VALIDATION_FAILED` |
| Missing identity or inactive membership | `401 UNAUTHENTICATED` |
| Missing permission or scope | `403 FORBIDDEN` |
| Timeout, connection failure, upstream `5xx`, unexpected upstream `401`, `403`, or `404` | `503 DEPENDENCY_UNAVAILABLE` |
| Malformed, extra-field, privacy-unsafe, or contradictory response | `503 DEPENDENCY_UNAVAILABLE` |
| Unexpected adapter exception | `503 DEPENDENCY_UNAVAILABLE` |

A dependency failure never becomes an empty page, partial page, or guessed event. Error messages do not disclose whether a protected tenant or event exists, upstream URLs, SQL, credentials, response bodies, or stack traces. Logs contain only request ID, route, result class, latency, and an approved operator subject hash.

## Retention and authorization boundary

Audit events are immutable security history. Runtime operator credentials have no update or delete path. Retention and any privacy-request treatment follow the approved business retention schedule and legal review; this read contract does not shorten, rewrite, or export that history. Audit access itself is attributable in the business audit trail without recursively returning raw request data.

The operator API does not infer events from frontend state, caches, Clerk claims, or local copies. If the authoritative source is unavailable or inconsistent, it returns the mapped dependency error. Direct Neon access, a new operator migration, event replication, mutation, export, or a new permission requires a separate design and review.

## Approval gates

Implementation requires all of the following:

1. Business API owners approve the authoritative read source, append-only semantics, event fields, actor-key derivation, action and entity-type allowlists, outcome values, ordering, cursor tuple, retention schedule, and missing-scope behavior.
2. Security and privacy reviewers approve `audit.read`, tenant and account scope, field exclusions, redaction rules, rate limits, no-store behavior, logging, and access to historical events.
3. API maintainers approve adapter configuration, timeouts, cursor binding, strict response validation, and stable failure mapping.
4. Tests prove authorization denial, unknown enum rejection, malformed and cross-filter cursor rejection, deterministic pagination, extra-field and privacy-content rejection, dependency failure mapping, and absence of direct Neon or migration dependency.
5. Typecheck, lint, tests, build, and `git diff --check` pass before release review. Deployment and production configuration require separate authorization.
