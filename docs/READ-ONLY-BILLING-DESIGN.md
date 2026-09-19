# Read-only billing and entitlement design

**Status:** Typed adapter implemented; routes remain on the fail-closed unavailable port until approved live configuration is mounted
**Scope:** Operator subscription list and effective entitlement detail  
**Database impact:** None. This design adds no operator tables, indexes, migrations, or replicated records.

## Purpose and boundary

Billing operators need a narrow view of subscription state and the capabilities currently effective for a business. The operator API is a control-plane consumer of the business platform. The business API and Neon are authoritative for plans, plan versions, subscriptions, entitlement evaluation, and billing invariants.

This design defines the operator-facing read contract and adapter boundary. It does not assert that a business API endpoint, transport credential, or deployment URL already exists. An approved business read projection or reviewed read-only query path must be available before implementation.

The operator API must not become a billing database, payment console, or unrestricted customer browser. It must not write subscriptions, plans, entitlements, prices, overrides, invoices, payment methods, or provider records.

The typed billing read adapter is implemented and validates the business-service envelope and billing projections. The application currently mounts the fail-closed unavailable port. Live mounting requires an approved business-service base URL, service-auth provider, source contract, and deployment configuration; this design does not claim that production business connectivity is enabled.

## Authorization

Every request requires a valid internal Clerk identity, active operator membership, a known role, and a server-side permission decision. Business-application membership never grants access.

| Surface | Permission |
| --- | --- |
| `GET /api/v1/subscriptions` | `subscription.read` |
| `GET /api/v1/businesses/:tenantId/entitlements` | `entitlement.read` |

The route checks permission before invoking the business read adapter. Support grants do not implicitly grant either permission. A role or permission unknown to the current contract fails closed. Authorization errors use the existing generic envelope and do not reveal whether a tenant or subscription exists.

## Subscription list

The subscription list is cursor-paginated. The adapter cursor tuple is `currentPeriodEnd + tenantId`. The route accepts only these query fields:

| Field | Rule |
| --- | --- |
| `cursor` | Opaque server-issued cursor. It encodes the last `currentPeriodEnd + tenantId` tuple and a hash of normalized filters. Reject malformed or cross-filter cursors. |
| `limit` | Integer, default 25, minimum 1, maximum 100. |
| `status` | Single allowlist value: `trialing`, `active`, `past_due`, `restricted`, or `cancelled`. Unknown values are rejected. |
| `plan_code` | Single allowlist value: `starter`, `professional`, or `business`. Unknown values are rejected. |

Offset pagination, arbitrary sort fields, free-form SQL, field selection, exports, and bulk search are out of scope. Filters are normalized before cursor hashing. The server applies filters before pagination and returns a stable `next_cursor`.

The subscription item is limited to:

```ts
type SubscriptionListItem = {
  tenant_id: string;
  business_name: string;
  plan_code: string;
  status: "trialing" | "active" | "past_due" | "restricted" | "cancelled";
  currency: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
};
```

Currency, plan, and status values are validated against the approved contract. The server does not calculate or revise billing values from browser input.

## Effective entitlement detail

The detail route is `GET /api/v1/businesses/:tenantId/entitlements` and accepts only a UUID tenant identifier. It returns the effective result after plan, account, and approved override evaluation.

```ts
type EffectiveEntitlementDetail = {
  tenant_id: string;
  plan_code: "starter" | "professional" | "business";
  capability_count: number;
  overridden_capability_count: number;
  capabilities: Array<{
    capability: string;
    enabled: boolean;
    limit_value: number | null;
  }>;
};
```

The current boundary requires each capability name to be a nonempty string and each `limit_value` to be a non-negative integer or null. Extra fields are rejected. A concrete business capability allowlist has not yet been supplied, so this boundary does not claim to reject unknown capability names. Capability allowlist approval is a pre-live gate. Duplicate capability keys or contradictory entries fail closed. The response must not contain member names or emails, customer data, payment credentials, card data, invoices, provider customer or subscription identifiers, webhook secrets, raw override reasons, private files, or arbitrary provider JSON.

An absent or hidden tenant returns the safe `NOT_FOUND` result defined by the shared response conventions. The operator API does not infer entitlement state from Clerk claims, frontend state, cached subscription data, or the existence of a support grant.

## Adapter and response validation

Both routes call one typed business read adapter after route validation and authorization. The adapter receives normalized filters, the decoded `currentPeriodEnd + tenantId` cursor tuple, tenant UUID, and validated operator context. It does not receive an Express request, raw query string, browser role, permission, token, or client-provided URL.

Treat every downstream response as untrusted. Validate HTTP status, content type, response envelope, complete payload shape, UUIDs, timestamps, currency, enum values, counts, amounts, cursor data, and excluded-field absence with strict schemas. Reject unknown keys and malformed or contradictory data. Do not strip unexpected fields and continue, and do not pass provider JSON through to callers.

The business API and Neon remain the sole authority. This repository adds no direct Neon connection, operator migration, subscription mirror, entitlement cache, or denormalized billing table. Any reviewed read-only query alternative must remain behind the adapter and receive separate data-access approval.

## Internal transport adapter

The adapter uses the shared `InternalServiceClient`. It forwards the validated request ID as `X-Request-ID` and obtains the internal service credential from the injected service-auth callback for `Authorization`. Browser cookies, arbitrary incoming headers, raw Clerk tokens, and client-supplied URLs are not forwarded. HTTPS, bounded response size, timeout, and redirect rejection are enforced by the shared client; insecure HTTP is permitted only for an explicit local-test configuration.

The exact allowlisted business-service paths are:

- `GET /internal/operator/v1/subscriptions`
- `GET /internal/operator/v1/businesses/:tenantId/entitlements`

Subscription filters and the normalized cursor tuple are encoded as allowlisted query parameters. The entitlement tenant UUID is inserted only after route validation. The adapter accepts the approved `200` projection response and the approved `404` entitlement miss, mapping the latter to the route's safe `NOT_FOUND` result. It strictly validates the response envelope, subscription item, entitlement detail, UUIDs, timestamps, enums, counts, capabilities, and cursor. Unknown fields, excluded billing or provider data, malformed values, and contradictory responses fail closed.

## Failure mapping and privacy

Use the existing response envelope and stable error codes:

| Condition | Result |
| --- | --- |
| Invalid query, UUID, enum, range, or cursor | `400 VALIDATION_FAILED` |
| Missing identity or inactive membership | `401 UNAUTHENTICATED` |
| Missing read permission or scope | `403 FORBIDDEN` |
| Valid entitlement detail miss | `404 NOT_FOUND` |
| Timeout, connection failure, upstream `5xx`, or unavailable dependency | `503 DEPENDENCY_UNAVAILABLE` |
| Upstream `401`, `403`, unexpected `404`, or other non-accepted status | `503 DEPENDENCY_UNAVAILABLE` |
| Successful response is non-JSON, malformed, extra-field, or contradictory | `503 DEPENDENCY_INVALID_RESPONSE` |
| Service-auth callback failure or invalid credential | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Unexpected adapter exception | `503 DEPENDENCY_UNAVAILABLE` |

Do not turn a dependency failure into an empty list, partial entitlement result, or guessed status. Messages must not reveal SQL, upstream URLs, response bodies, credentials, provider details, or whether an unauthorized tenant exists. Logs contain only request ID, route, result class, latency, and an approved operator subject hash. Billing responses use `Cache-Control: no-store`.

## Approval gates

Live mounting and production use require all of the following:

1. Business API owners approve the read source, subscription and entitlement schemas, plan and status allowlists, capability allowlist, authority, consistency behavior, and missing-record semantics. The capability allowlist is a pre-live gate because the current boundary validates nonempty strings but does not yet define unknown-capability rejection.
2. Security and privacy reviewers approve `subscription.read` and `entitlement.read`, tenant scope, field exclusions, response validation, rate limits, logging, and secret handling.
3. API maintainers approve adapter configuration, exact internal paths, service authentication, timeout behavior, cursor encoding, filter normalization, strict response validation, and stable failure mapping.
4. Tests prove strict unknown-field and excluded-field rejection, enum and cursor validation, filter-bound cursors, malformed and contradictory response handling, dependency failure mapping, and absence of direct Neon or migration dependency.
5. The repository passes typecheck, lint, tests, build, and `git diff --check`. Production configuration and deployment require separate authorization.

Any request to add a mutation, payment or provider field, customer data, a new permission, an operator table, or a migration requires a new contract and review.
