# Business read adapter integration

**Status:** Implemented adapter boundary, not mounted with live configuration
**Scope:** Operator overview and business read projections

## Purpose

The operator read routes expose safe projections, while the business API remains authoritative for tenant and subscription facts. This adapter connects those projections to approved internal business endpoints through the shared internal service client.

## Request contract

Every ReadPort method receives the current request ID:

- overview
- business list
- business detail

The adapter passes that ID to the service authentication callback and the X-Request-ID header. This preserves correlation from the operator request to the business service without logging or returning credentials.

The adapter accepts only the approved internal paths and uses the service client's HTTPS, timeout, response-size, method, and redirect controls. Service authentication is injected by deployment configuration and is required for a request to proceed.

## Response contract

The adapter validates the upstream success envelope and the exact projection schema with Zod. Unknown fields, missing fields, invalid timestamps, unknown states, and malformed JSON fail closed as DEPENDENCY_INVALID_RESPONSE.

An approved 404 from a business detail endpoint becomes a null adapter result. Overview and list endpoints treat 404 as a dependency failure because their collection contract requires a response. Other upstream statuses fail as DEPENDENCY_UNAVAILABLE. Raw bodies and upstream details never cross the operator boundary.

## Ownership and database impact

The business API and Neon remain the source of truth. This adapter performs no SQL, writes no tenant data, claims no idempotency key, and adds no local cache, table, migration, or mirror.

The operator read router still owns request validation, permission hooks, response envelopes, and cursor binding. The business adapter owns only endpoint translation and response validation.

## Production gates

Before mounting a live adapter, approve the base URL, service authentication rotation, endpoint allowlist, request timeout, upstream status mapping, and integration tests against the business API contract. The application remains fail closed while the adapter is not wired with approved configuration.
