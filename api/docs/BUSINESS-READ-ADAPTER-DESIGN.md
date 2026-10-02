# Business read adapter integration

**Status:** Environment-configured business read adapter mounted; absent configuration remains fail closed
**Scope:** Operator overview and business read projections

## Purpose

The operator read routes expose safe projections, while the business API remains authoritative for tenant and subscription facts. This adapter connects those projections to approved internal business endpoints through the shared internal service client.

## Request contract

Every ReadPort method receives the current request ID. All business read calls also receive the verified operator principal and send a short-lived HS256 assertion alongside service authentication:

- overview
- business list
- business detail

The assertion binds the principal's single verified role and subject, exact GET method and upstream path, permission, request ID, and a tenant UUID for business detail and entitlement reads. The supported permissions are `operator.overview.read`, `operator.business.list.read`, `operator.business.detail.read`, `operator.subscription.list.read`, `operator.entitlements.read`, `job.read`, and `notification.read`. Jobs and notifications also carry the SHA-256 hash of the exact normalized query string sent upstream, as required by the Business API verifier. Unsupported routes, roles, or claim combinations fail closed.

`INTERNAL_OPERATOR_ASSERTION_SECRET` must be configured with at least 32 UTF-8 bytes and must match the business API verifier configuration. Every business projection request fails closed before network access when it is missing or too short. The secret is never logged or returned.

The adapter accepts only the approved internal paths and uses the service client's HTTPS, timeout, response-size, method, and redirect controls. Local development may opt into HTTP only for loopback hosts through `INTERNAL_SERVICE_ALLOW_INSECURE_HTTP=true`; production and non-loopback URLs always require HTTPS. Service authentication is injected by deployment configuration and is required for a request to proceed.

## Response contract

The adapter requires the upstream `request_id` to match the outbound request and validates each success envelope and projection with strict Zod schemas. The business list maps the upstream `id`, `name`, and `active_membership_count` fields into the existing Operator API DTO, and translates the opaque Business API cursor through the route's existing filter-bound cursor. Business detail maps branch and membership field names into the public projection. Subscription and entitlement adapters perform their corresponding strict mappings. Job and notification adapters accept the Business API's narrower redacted fields and map them into the existing public contract. Unknown fields, missing fields, invalid timestamps, unknown states, tenant mismatches, cursor errors, and malformed JSON fail closed as `DEPENDENCY_INVALID_RESPONSE`.

An approved 404 from a business detail endpoint becomes a null adapter result. Overview and list endpoints treat 404 as a dependency failure because their collection contract requires a response. Other upstream statuses fail as DEPENDENCY_UNAVAILABLE. Raw bodies and upstream details never cross the operator boundary.

## Ownership and database impact

The business API and Neon remain the source of truth. This adapter performs no SQL, writes no tenant data, claims no idempotency key, and adds no local cache, table, migration, or mirror.

The operator read router still owns request validation, permission hooks, response envelopes, and cursor binding. The business adapter owns only endpoint translation and response validation.

## Production gates

Before mounting a live adapter, approve the base URL, service authentication rotation, endpoint allowlist, request timeout, upstream status mapping, and integration tests against the business API contract. The application remains fail closed while the adapter is not wired with approved configuration.

The application mounts adapters when both `INTERNAL_SERVICE_BASE_URL` and `INTERNAL_SERVICE_AUTH` are configured. Each request still fails closed if the assertion secret is unavailable. The Operator API does not connect to Neon or alter tenant records.
