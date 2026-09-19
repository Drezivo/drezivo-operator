# ADR 0016: Billing read adapter transport

**Status:** Proposed for review
**Date:** 2026-09-17

## Decision

The subscription and entitlement projections use a typed billing read adapter backed by the shared `InternalServiceClient`. The adapter is implemented and tested at its boundary, but the application remains mounted to the fail-closed unavailable port until an approved live base URL, service-auth provider, billing contract, and deployment configuration are available.

The adapter may call only these exact business-service paths:

- `GET /internal/operator/v1/subscriptions`
- `GET /internal/operator/v1/businesses/:tenantId/entitlements`

It forwards the validated request ID as `X-Request-ID` and obtains the internal service credential from the injected service-auth callback for `Authorization`. It never forwards browser cookies, arbitrary headers, raw Clerk tokens, client URLs, or untrusted request bodies. The shared client enforces HTTPS by default, bounded response size, timeout, JSON content handling, and redirect rejection. HTTP is allowed only through explicit local-test configuration.

## Contract handling

Subscription filters, limit, and the normalized `currentPeriodEnd + tenantId` cursor are encoded as allowlisted query parameters. The entitlement path contains only the route-validated tenant UUID. A successful response must be a JSON Drezivo envelope with `success: true`; the adapter strictly validates the complete subscription page, entitlement detail, cursor, timestamps, currency, plan and lifecycle values, counts, capability entries, and excluded-field absence. It does not coerce or strip unknown fields.

An approved `404` from the entitlement endpoint is represented as an absent detail and becomes the route's safe `404 NOT_FOUND`. An unexpected `404`, an upstream `401` or `403`, or any other non-accepted status is a dependency failure. The adapter does not infer billing state from Clerk claims, browser data, cache values, or support grants.

## Error mapping

| Transport or response condition | Adapter result |
| --- | --- |
| Service-auth callback fails or returns an invalid credential | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Timeout, connection failure, unexpected status, invalid URL, or unavailable service | `503 DEPENDENCY_UNAVAILABLE` |
| Successful response is non-JSON, malformed JSON, envelope, projection, cursor, or excluded-field unsafe | `503 DEPENDENCY_INVALID_RESPONSE` |

The route layer retains `400 VALIDATION_FAILED`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, and the approved entitlement `404 NOT_FOUND` results for local validation and authorization. Upstream errors never become an empty subscription list, partial entitlement result, guessed status, or leaked provider response. Logs and errors contain no credential, token, SQL, raw body, provider identifiers, or stack trace.

## Database impact

None. The adapter does not connect to Neon, create tables, add indexes, write subscriptions, mutate entitlements, copy projections, cache billing facts, or alter retention. The business API and Neon remain authoritative for plans, subscriptions, entitlement evaluation, and billing invariants.

## Consequences and gates

This boundary keeps transport security and strict billing validation in one reusable client while allowing the routes to remain fail closed in environments without approved configuration. Before mounting the adapter, business API owners must approve the two internal paths, envelope and projection versions, plan/status and capability allowlists, scope behavior, and missing-record semantics. Security and privacy reviewers must approve service authentication, tenant isolation, field exclusions, timeout and response limits, and logging. Integration tests must verify exact paths, request ID and authorization propagation, accepted entitlement `404`, malformed and non-JSON responses, non-accepted statuses, and strict field validation. No migration is required.
