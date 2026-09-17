# Operations retry command design

**Status:** Proposed contract for review
**Scope:** Operator initiated retry of an existing job or notification delivery
**Database impact:** None in this repository. The business API remains the only owner of source records, idempotency, outbox writes, leases, and audit persistence.

## Purpose

This contract describes how an authorized operator may ask the business platform to retry one recorded background operation. It is a command boundary, not a second worker and not a direct database action. The operator API must never change `outbox_event` or `notification_delivery` itself.

Retry means a new, auditable processing intent evaluated by the business system. It does not mean forcing a status, clearing a lease, incrementing an attempt counter in the operator service, or sending a notification directly. The business system decides whether the source state, deduplication key, reservation or template version, provider state, and retry policy permit the operation.

## Planned routes and permissions

Both routes are protected `POST` commands under `/api/v1`:

| Route | Permission | Target | Initial proposed eligible states |
| --- | --- | --- | --- |
| `POST /api/v1/jobs/:jobId/retry` | `job.retry` | `outbox_event.id` / job identifier | `dead` only; the authority may also permit an expired `leased` row after reconciliation |
| `POST /api/v1/notifications/:deliveryId/retry` | `notification.retry` | `notification_delivery.id` | `failed` or `bounced` only; `provider_accepted` and `delivered` must not be resent by default |

The route parameter is a UUID. The permission is checked on the server after Clerk identity and active internal membership are verified. A tenant scope, when required by the authority, is resolved from the target record by the business command and is never accepted as an untrusted authorization override from the body. A support grant may narrow the operator's existing scope but cannot create either retry permission or global access.

These state choices are proposed defaults, not an implementation license. The business API owners must confirm whether an expired lease, a provider-uncertain notification, or another terminal state can be retried safely. Unknown states fail closed.

## Request contract

The body contains exactly one required field:

```json
{
  "reason": "The operator-visible reason for requesting this retry"
}
```

`reason` is a bounded, non-empty, human-readable string validated at the boundary. The final length and permitted characters must be aligned with the business command contract. Unknown fields, client supplied status, tenant identifiers, dedupe keys, attempt counts, provider identifiers, payloads, lease values, recipient data, and scheduling controls are rejected. The server derives the acting operator, request ID, target, and authorization scope.

Every request requires an `Idempotency-Key` header. It is scoped by the authenticated operator, operation, and target. The validated request hash includes the target and reason. The operator route validates and forwards the key only after authentication and permission checks succeed. The business command claims and finalizes it atomically with the authoritative retry outcome; the operator API owns no second idempotency record. The same key with the same request replays the recorded safe outcome; the same key with a different request returns `409 IDEMPOTENCY_KEY_REUSED`; a concurrent matching request returns an in-progress `409 STATE_CONFLICT` with retry guidance. A new operator intent uses a new key.

The operator API must follow the business platform's existing idempotency contract: the authority commits the retry intent, resulting outbox/job changes, and audit record atomically where possible. The operator API must not claim success before the authoritative command returns a validated result.

## Safe response contract

The command returns the Drezivo response envelope and only a validated projection of the authoritative result. The current boundary uses one safe result shape for both commands:

```ts
type RetryResult = {
  command_kind: "job.retry" | "notification.retry";
  resource_id: string;
  status: "accepted";
  request_id: string;
  accepted_at: string;
};
```

The command owner must still approve the final response shape and whether `resource_id` is the existing or newly created job or delivery identifier. The response must never include payloads, dedupe keys, lease tokens, worker identity, stack traces, provider bodies, recipient addresses, message content, credentials, or raw error details. The result describes an accepted command, not promised external delivery.

## Authority and durable behavior

The business API owns the command implementation and remains authoritative for:

- eligibility and conditional state transitions;
- the stable deduplication key and attempt limits;
- lease release, reclaim, and worker scheduling;
- creation or reuse of an outbox/job intent;
- provider idempotency and notification reconciliation;
- the audit event and its redacted reason;
- idempotency records and replayed safe responses.

For a job retry, the command must not reset a lease held by a live worker without an authority-defined reconciliation rule. For a notification retry, it must not resend a delivery already accepted or delivered unless the authority has a separately reviewed reconciliation command. External delivery is at-least-once; exactly-once delivery cannot be promised.

The operator command sends only the normalized target, acting operator context, request ID, reason, idempotency key, and approved scope information to an allowlisted internal command adapter. It does not send a browser token, arbitrary URL, raw request body, or direct SQL. The route factory remains unmounted until the command contract and service authentication are approved.

## Audit and outbox behavior

Each accepted, rejected, or failed command must produce the business platform's approved audit outcome. The audit record should identify the acting operator, action (`job.retry` or `notification.retry`), target type and ID, request ID, reason in redacted form, and outcome. A rejected command must not create a retry outbox event. An accepted command must create or reuse the authoritative durable work intent in the same transaction as its idempotency outcome and audit decision where the business schema permits.

The operator API does not enqueue work, publish messages, run a worker, modify `attempts`, or write `notification_delivery`. It only returns the authoritative safe projection. No fire-and-forget side effect is allowed in the operator request path.

## Stable error mapping

The adapter and route use the existing Drezivo envelope and safe error codes:

| Condition | HTTP / code | Rule |
| --- | --- | --- |
| Invalid UUID, body, reason, header, or unknown field | `400 VALIDATION_FAILED` | Reject before the command call. |
| Missing or invalid identity | `401 UNAUTHENTICATED` | Do not disclose target existence. |
| Missing retry permission, inactive membership, or out-of-scope target | `403 FORBIDDEN` | Use a generic authorization response. |
| Same key with a different validated request | `409 IDEMPOTENCY_KEY_REUSED` | Caller must use a new key for a new intent. |
| Matching command still in progress | `409 STATE_CONFLICT` | Retry with the same key after the indicated delay. |
| Target absent, ineligible, already terminal, or unsafe transition | `409 STATE_CONFLICT` or `404` | Final code must follow the business API's concealment policy. |
| Rate limit exceeded | `429 RATE_LIMITED` | Include `Retry-After` when available. |
| Business command timeout, transport failure, or unavailable authority | `503 DEPENDENCY_UNAVAILABLE` | Do not guess whether the retry was accepted; retry with the same key after recovery. |
| Malformed or privacy-unsafe authority response | `503 DEPENDENCY_UNAVAILABLE` | Never coerce, strip, or return an empty success. |

The final target-not-found versus concealed-forbidden mapping must be supplied by the business command owner. Logs contain request ID, operation, result class, latency, and an approved operator subject hash only. They must not contain the reason if it can include unnecessary personal data, tokens, provider payloads, or raw responses.

## Database and migration decision

**No database change is proposed for this repository.** The existing business schema already models `outbox_event`, `notification_delivery`, `idempotency_record`, and audit facts. No operator table, mirror, migration, index, direct Neon query, or alternate retry ledger may be added as part of this command boundary.

If the business owner determines that a new durable command record, retry-attempt identity, provider reconciliation field, or constraint is required, that is a separate database design review. It must document ownership, unique keys, transaction boundaries, RLS, retention, migration sequencing, rollback or forward-fix strategy, and concurrency tests before implementation.

## Open contract questions

Implementation remains blocked behind these explicit answers from the business API owners:

1. What are the exact internal command paths and authentication mechanism for each retry operation?
2. Is a retry a new outbox/job row, a conditional transition of the existing row, or a domain-specific command that may reuse either?
3. Which source states are eligible, including expired leases and provider-uncertain notifications?
4. What are the exact permission codes, role assignments, tenant-scope rules, and support-grant requirements?
5. What is the canonical request and response schema, including maximum reason length and whether `audit_event_id` is returned?
6. Which errors conceal target existence, and which stable error codes apply to ineligible or already processed targets?
7. How are provider idempotency keys and notification reconciliation handled to avoid duplicate delivery?
8. What rate limits, retry-after behavior, and command timeout are approved?
9. Which audit action/entity names and redaction rules are canonical?
10. What sequential and concurrent duplicate tests, worker lease tests, and provider-uncertainty tests are required before release?

## Required implementation gates

After the questions above are approved, implementation must add an injected typed command port, strict Zod input and output schemas, route authorization, idempotency integration, and safe error mapping. Tests must cover authorization denial, invalid body and header, wrong-scope target, ineligible state, malformed authority response, provider timeout with same-key retry, sequential duplicate requests, and concurrent duplicate requests. The operator API must not be considered production-ready until the business adapter is connected to an approved command and the real Neon-backed integration tests pass.
