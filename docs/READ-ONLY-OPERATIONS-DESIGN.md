# Read-only operations design

**Status:** Proposed for review  
**Scope:** Operational job and notification read projections  
**Database impact:** None. This design adds no tables, indexes, migrations, retries, or mutation routes.

## Purpose and authority

This slice gives authorized operators a bounded view of durable background work and notification delivery. The business API and its Neon data model remain authoritative. The operator API consumes an approved internal read projection through a typed adapter. It must not connect directly to Neon, expose arbitrary SQL, mirror operator tables, or infer state from a browser, cache, or Clerk claim.

The source model is `outbox_event`, which records `pending`, `leased`, `succeeded`, or `dead` work, and `notification_delivery`, which records the delivery outcome related to an outbox event. External delivery is at-least-once. This read surface reports recorded facts only. It does not claim that `succeeded` means a notification was delivered.

## Protected routes and permissions

Both routes are protected `GET` routes under `/api/v1`:

| Route | Permission |
| --- | --- |
| `GET /api/v1/jobs` | `job.read` |
| `GET /api/v1/notifications` | `notification.read` |

Each request requires a valid internal identity, active operator membership, known role, the listed server-side permission, and an authorized tenant or account scope where one is supplied. A business-application membership does not grant access. A support grant may narrow an already-authorized tenant scope but cannot grant either permission or global access. Unknown roles, permissions, scope kinds, and filter values fail closed.

## Query and cursor contract

Both routes accept only `cursor` and `limit`, plus the route-specific filters below. `limit` is an integer from 1 through 100 and defaults to 25. `cursor` is opaque, server-issued, bounded in lifetime, and encodes the final ordering tuple and a hash of normalized filters and scope. A malformed, expired, cross-route, cross-scope, or cross-filter cursor returns `400 VALIDATION_FAILED`. Offset pagination, arbitrary sort fields, free-text search, field selection, exports, and unbounded reads are not supported.

### Jobs

Allowed filters are `tenant_id` (UUID), `status` (`pending`, `leased`, `succeeded`, `dead`), `event_type` (an approved event-type token), and `available_from` and `available_to` (RFC 3339 timestamps, inclusive then exclusive, with the end after the start). Filters are applied before pagination. Ordering is `available_at DESC, id DESC` and is deterministic.

The safe job item contains exactly:

```ts
type Job = {
  job_id: string;
  tenant_id: string;
  event_type: string;
  status: "pending" | "leased" | "succeeded" | "dead";
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_until: string | null;
  completed_at: string | null;
  safe_last_error: string | null;
  created_at: string;
};
```

`dedupe_key`, lease tokens, payloads, provider data, and internal worker identity are excluded. `safe_last_error` is bounded redacted text from the authoritative record and never includes credentials, tokens, request bodies, SQL, stack traces, or arbitrary provider JSON.

### Notifications

Allowed filters are `tenant_id` (UUID), `status` (`queued`, `provider_accepted`, `delivered`, `bounced`, `failed`), `channel` (an approved channel token), and `accepted_from` and `accepted_to` (RFC 3339 timestamps, inclusive then exclusive, with the end after the start). Ordering is `accepted_at DESC NULLS LAST, delivery_id DESC` and is deterministic.

The safe notification item contains exactly:

```ts
type Notification = {
  delivery_id: string;
  tenant_id: string;
  outbox_id: string;
  channel: string;
  template_version: string;
  status: "queued" | "provider_accepted" | "delivered" | "bounced" | "failed";
  provider_message_id: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
};
```

Recipient addresses, message content, provider payloads, bearer credentials, webhook bodies, and private business records are excluded. `queued` means recorded for delivery, `provider_accepted` means the provider acknowledged it, and `delivered` means the provider reported delivery. The API must not collapse these states to “sent.”

## Envelope, strict validation, and failures

Responses use the shared envelope with `data: { items, next_cursor }` and the request ID. The adapter must strictly validate the approved projection, reject unknown fields, malformed values, contradictory timestamps, unsafe text, and missing required identifiers. It must not strip unexpected fields and continue.

| Condition | Result |
| --- | --- |
| Invalid query, UUID, timestamp, enum, range, or cursor | `400 VALIDATION_FAILED` |
| Missing identity or inactive membership | `401 UNAUTHENTICATED` |
| Missing permission or scope | `403 FORBIDDEN` |
| Timeout, connection failure, upstream 5xx, unexpected upstream 401/403/404 | `503 DEPENDENCY_UNAVAILABLE` |
| Malformed, extra-field, privacy-unsafe, or contradictory projection | `503 DEPENDENCY_UNAVAILABLE` |
| Unexpected adapter exception | `503 DEPENDENCY_UNAVAILABLE` |

Dependency failure never becomes an empty page, partial page, guessed status, or local retry. Messages do not disclose tenant existence, SQL, URLs, credentials, provider bodies, or stack traces. Tenant-scoped responses set `Cache-Control: no-store`.

## Privacy, retention, and observability

The projection excludes recipient PII, customer profiles, message bodies, private files, secrets, tokens, raw payloads, IP addresses, headers, cookies, and arbitrary JSON. Retention, deletion, and legal treatment remain governed by the business data model and approved retention schedule. This API does not copy, rewrite, export, or shorten source retention.

Structured logs contain only request ID, route, result class, latency, and an approved operator subject hash. Metrics may include authorization denials, page latency, dependency failures, job age by canonical status, and notification counts by canonical status and channel. Alerts contain no raw personal data or provider payloads.

## Explicit non-goals and approval gates

This slice adds no retry command, job claim, cancellation, notification resend, mutation, outbox write, direct Neon query, operator table, migration, export, or background side effect. Any such behavior requires a new contract with idempotency and audit review.

Before implementation, business API owners must approve the source adapter, event-type and channel allowlists, statuses, ordering and cursor tuples, scope behavior, and retention authority. Security and privacy reviewers must approve permissions, tenant isolation, field exclusions, rate limits, no-store behavior, and logging. API maintainers must approve strict schemas, timeouts, and failure mapping. Tests must cover authorization denial, unknown-value rejection, cursor binding, deterministic pagination, excluded-field rejection, and dependency failures. Release requires typecheck, lint, tests, build, and `git diff --check`.
