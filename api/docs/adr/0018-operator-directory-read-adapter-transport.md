# ADR 0018: Operator directory read adapter transport

**Status:** Proposed for review
**Date:** 2026-09-17

## Decision

The Admin Team directory projection will use a typed adapter backed by the shared `InternalServiceClient`. The adapter validates the business or approved directory-service envelope and complete safe projection before returning data to the route. The route remains mounted to the fail-closed unavailable port until an approved live base URL, service-auth provider, source contract, and deployment configuration are available.

The adapter may call only:

- `GET /internal/operator/v1/operators`

It forwards the validated request ID as `X-Request-ID` and obtains the internal service credential from the injected service-auth callback for `Authorization`. Browser cookies, arbitrary incoming headers, raw Clerk tokens, client URLs, SQL fragments, and provider payloads are never forwarded. HTTPS is required by default; insecure HTTP is limited to explicit local-test configuration. Timeout, response-size, JSON content, and redirect checks are enforced by the shared client.

## Contract handling

The route validates identity, internal membership, `operator.directory.read`, scope, filters, and cursor binding before invoking the adapter. The adapter receives only normalized filters, the decoded `(last_activity_at, operator_id)` cursor tuple, the limit, and the request ID. It sends only allowlisted role, status, limit, and cursor parameters. When the decoded activity timestamp is null, it preserves that local cursor state by omitting `cursor_last_activity_at` upstream and sending `cursor_operator_id`; it does not invent a date or send an ambiguous empty parameter.

A successful response must be a JSON Drezivo envelope with `success: true`. The adapter strictly validates the exact directory item fields, nullable activity timestamp, cursor shape, bounded opaque identifiers, approved role and status values, count bounds, and excluded-field absence. It does not coerce or strip unknown fields. Email, phone, avatar URLs, provider metadata, membership IDs, sessions, IP and device data, and raw provider payloads remain excluded.

## Error mapping

| Transport or response condition | Adapter result |
| --- | --- |
| Service-auth callback fails or returns an invalid credential | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Timeout, connection failure, unexpected status, invalid URL, unreconciled identity, or unavailable service | `503 DEPENDENCY_UNAVAILABLE` |
| Successful response is non-JSON, malformed JSON, envelope, projection, cursor, or privacy unsafe | `503 DEPENDENCY_INVALID_RESPONSE` |

The route retains `400 VALIDATION_FAILED`, `401 UNAUTHENTICATED`, and `403 FORBIDDEN` for local input and authorization failures. Upstream errors never become an empty or partial directory, guessed identity, or leaked provider response. Logs and errors contain no credentials, tokens, SQL, raw bodies, private notes, or stack traces.

## Database impact

None. The adapter does not connect to Neon, create tables, add indexes, write operator records, copy Clerk users, cache directory facts, or alter retention. Drezivo's approved operator authority and verified identity source remain authoritative.

## Consequences and gates

This boundary keeps transport security and strict field minimization in one reusable client while preserving fail-closed behavior without live configuration. Business owners must approve the exact internal path, identity reconciliation, role and status source, ordering and cursor semantics, and missing-record behavior. Security and privacy reviewers must approve `operator.directory.read`, field exclusions, service authentication, rate limits, no-store behavior, and logging. Integration tests must verify exact path and headers, cursor mapping including null activity, malformed and non-JSON responses, non-accepted statuses, unsafe projection rejection, and safe error mapping. No migration is required.
