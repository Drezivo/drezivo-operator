# ADR 0017: Audit read adapter transport

**Status:** Proposed for review
**Date:** 2026-09-17

## Decision

The operator audit projection will use a typed adapter backed by the shared `InternalServiceClient`. The adapter boundary validates the business-service envelope and the complete audit projection before returning data to the route. The application remains mounted to the fail-closed unavailable port until an approved live base URL, service-auth provider, source contract, and deployment configuration are available.

The adapter may call only:

- `GET /internal/operator/v1/audit-events`

It forwards the validated request ID as `X-Request-ID` and obtains the internal service credential from the injected service-auth callback for `Authorization`. It never forwards browser cookies, arbitrary headers, raw Clerk tokens, client URLs, SQL fragments, or provider payloads. HTTPS is required by default; insecure HTTP is limited to explicit local-test configuration. Timeout, response-size, JSON content, and redirect checks are enforced by the shared client.

## Contract handling

The route validates identity, permission, scope, query filters, and cursor binding before invoking the adapter. The adapter receives normalized filters, the decoded cursor tuple, and the request ID. It sends only allowlisted filter parameters and limit values. A successful response must be a JSON Drezivo envelope with `success: true`; the adapter strictly validates the exact audit item fields and nullable cursor shape, including UUIDs, timestamps, actor and outcome enums, bounded opaque actor keys, redacted summaries, and excluded-field absence. It does not coerce or strip unknown fields.

## Error mapping

| Transport or response condition | Adapter result |
| --- | --- |
| Service-auth callback fails or returns an invalid credential | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Timeout, connection failure, unexpected status, invalid URL, or unavailable service | `503 DEPENDENCY_UNAVAILABLE` |
| Successful response is non-JSON, malformed JSON, envelope, projection, cursor, or privacy unsafe | `503 DEPENDENCY_INVALID_RESPONSE` |

The route retains `400 VALIDATION_FAILED`, `401 UNAUTHENTICATED`, and `403 FORBIDDEN` for local input and authorization failures. Upstream errors never become an empty or partial audit page, guessed event, or leaked response. Logs and errors contain no credentials, tokens, SQL, raw bodies, private summaries, or stack traces.

## Database impact

None. The adapter does not connect to Neon, create tables, add indexes, write audit events, copy audit history, alter retention, or introduce an operator audit store. The business API and Neon remain authoritative for append-only audit creation, ordering, scope, and retention.

## Consequences and gates

This boundary keeps transport security and strict audit validation in one reusable client while preserving the operator API's fail-closed behavior without live configuration. Business API owners must approve the exact internal path, envelope and projection version, actor and action allowlists, scope behavior, and retention authority. Security and privacy reviewers must approve `audit.read`, tenant isolation, redaction, service authentication, rate limits, and logging. Integration tests must verify exact path and headers, malformed and non-JSON responses, non-accepted statuses, unsafe projection rejection, cursor binding, and safe error mapping. No migration is required.
