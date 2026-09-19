# ADR 0015: Operations read adapter transport

**Status:** Proposed for review
**Date:** 2026-09-17

## Decision

The jobs and notifications read projections use the shared typed `InternalServiceClient` through `createOperationsReadAdapter`. The adapter is implemented and tested, but the application remains mounted to its fail-closed unavailable port until an approved live base URL, service-auth provider, and business contract are configured.

The adapter may call only these exact business-service paths:

- `GET /internal/operator/v1/jobs`
- `GET /internal/operator/v1/notifications`

It forwards the validated request ID as `X-Request-ID` and obtains the internal service credential from the injected service-auth callback for the `Authorization` header. Browser cookies, arbitrary incoming headers, raw Clerk tokens, and untrusted request bodies are never forwarded. The client uses JSON-only responses, bounded response size, request timeout, redirect rejection, and HTTPS by default. HTTP is permitted only when an explicit local-test option is enabled.

## Contract handling

The adapter sends normalized allowlisted filters and limit values. Job cursors are transported as `cursor_available_at` and `cursor_id`. Notification cursors are transported as `cursor_delivery_id`, with `cursor_accepted_at` sent only when `acceptedAt` is non-null. A null notification timestamp remains a meaningful ordering value and is not converted to an empty or fabricated date.

Successful responses must be JSON Drezivo envelopes with `success: true`. The adapter strictly validates the exact job and notification projection, including the nullable notification cursor. Unknown fields, malformed envelopes, unsafe values, invalid timestamps or identifiers, future values, contradictory fields, non-JSON responses, unexpected statuses, and oversized payloads are rejected. It does not coerce or strip fields.

## Error mapping

| Transport or response condition | Adapter result |
| --- | --- |
| Service-auth callback fails or returns an invalid credential | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Timeout, connection failure, non-accepted status, invalid URL, or unavailable service | `503 DEPENDENCY_UNAVAILABLE` |
| Successful response is non-JSON, malformed JSON, envelope, projection, or cursor | `503 DEPENDENCY_INVALID_RESPONSE` |

The route layer retains its own `400 VALIDATION_FAILED`, `401 UNAUTHENTICATED`, and `403 FORBIDDEN` results for local request and authorization failures. Upstream errors never become an empty or partial page, guessed state, local retry, or leaked provider response. Logs and errors contain no credential, token, SQL, raw body, or stack trace.

## Database impact

None. The adapter does not connect to Neon, create tables, add indexes, write jobs, mutate notifications, copy projections, or alter retention. The business API and its Neon model remain authoritative for `outbox_event` and `notification_delivery`.

## Consequences and gates

This boundary keeps transport security and schema validation in one reusable client while allowing the operator routes to remain fail closed in environments without approved configuration. Before mounting the adapter, the business API owner must approve the two internal paths, envelope and projection versions, scope behavior, event-type and channel allowlists, and service authentication. Security review must approve credential issuance, request-ID propagation, timeout and response limits, and logging. Integration tests against the business service must verify headers, exact paths, malformed responses, non-JSON responses, transport failures, and nullable notification cursors. No migration is required.
