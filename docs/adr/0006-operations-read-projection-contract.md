# ADR 0006: Operations read projection contract

**Status:** Proposed for review  
**Date:** 2026-09-17

## Decision

The operator API will expose two protected, read-only projections: `GET /api/v1/jobs` with `job.read`, and `GET /api/v1/notifications` with `notification.read`. Both consume an approved typed business read adapter. The business API and Neon remain authoritative for `outbox_event` and `notification_delivery`.

`outbox_event` statuses are exactly `pending`, `leased`, `succeeded`, and `dead`. Notification statuses are exactly `queued`, `provider_accepted`, `delivered`, `bounced`, and `failed`. These are source facts, not commands or inferred health states. No route in this ADR claims delivery from outbox success.

## Contract boundary

Authentication, active membership, role validation, permission checks, scope resolution, query validation, filter normalization, cursor binding, envelopes, request IDs, and no-store headers belong to the route. The adapter receives normalized filters and authorized scope only. It receives no raw query string, browser role, token, arbitrary URL, SQL fragment, or provider payload.

Jobs permit UUID `tenant_id`, approved `event_type`, the four job statuses, and bounded RFC 3339 `available_from` and `available_to`. Its cursor is bound to the `available_at` and identifier ordering tuple. Notifications permit UUID `tenant_id`, approved `channel`, the five notification statuses, and bounded RFC 3339 `accepted_from` and `accepted_to`. Its cursor is bound to the nullable `accepted_at` and `delivery_id` ordering tuple. Both use limit 1 to 100, default 25, opaque cursors bound to normalized filters, scope, and route.

The job projection is limited to `job_id`, `tenant_id`, `event_type`, `status`, attempt counters, availability, lease and completion timestamps, bounded `safe_last_error`, and creation time. It excludes dedupe keys, lease tokens, payloads, provider data, and worker identity. The notification projection is limited to `delivery_id`, `tenant_id`, `outbox_id`, `channel`, `template_version`, `status`, `provider_message_id`, accepted timestamp, and delivered timestamp. It excludes recipient data, message content, provider payloads, and credentials. Unknown fields and unsafe content are rejected.

## Failure and privacy rules

Malformed input maps to `400 VALIDATION_FAILED`; missing identity maps to `401 UNAUTHENTICATED`; missing permission or scope maps to `403 FORBIDDEN`; unavailable or malformed upstream data maps to `503 DEPENDENCY_UNAVAILABLE`. A dependency error cannot be represented as an empty or partial page. Errors and logs must not reveal tenant existence, SQL, credentials, raw payloads, or stack traces. Logs contain request ID, route, result class, latency, and an approved operator subject hash.

Retention follows the business data model and legal schedule. The operator API does not create a mirror, mutate source records, retry work, or alter retention. Direct Neon access, operator tables, and migrations are explicitly out of scope.

## Consequences

Operators get deterministic, bounded operational visibility while the business system retains authority and delivery semantics. Implementers must maintain two strict allowlists and distinguish provider acceptance from delivery. New statuses, fields, filters, permissions, sources, persistence, retries, or mutations require a new ADR or an update approved through the gates below.

## Approval gates

Business API owners approve source authority, allowlists, statuses, scope, ordering, cursor tuples, and retention. Security and privacy reviewers approve permissions, isolation, exclusions, rate limits, no-store behavior, and logging. API maintainers approve adapter configuration, strict response validation, timeout behavior, and stable error mapping. Tests must prove denial, fail-closed validation, cursor binding, deterministic pagination, privacy exclusions, and dependency mapping. Release requires typecheck, lint, tests, build, and `git diff --check`.
