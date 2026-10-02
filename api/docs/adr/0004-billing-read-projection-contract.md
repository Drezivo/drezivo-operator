# ADR 0004: Billing read projection contract

**Status:** Proposed for review  
**Date:** 2026-09-17  
**Scope:** Read-only operator subscription and effective entitlement projections

## Context

The operator system needs billing visibility for diagnosis and account support. Subscription and entitlement facts belong to the business API and Neon, which enforce plan versions, billing state, effective capability evaluation, tenant isolation, and business invariants. A second billing store or direct operator writes would create competing authority and could expose payment or customer data.

The operator API therefore needs a narrow contract for a subscription list and entitlement detail. The contract must remain useful without claiming that an upstream route or integration already exists.

## Decision

Define two read-only operator surfaces behind a typed business read adapter:

- `GET /api/v1/subscriptions`, authorized by `subscription.read`.
- `GET /api/v1/businesses/:tenantId/entitlements`, authorized by `entitlement.read`.

The business API and Neon are authoritative. The adapter may later use an approved internal business endpoint or a separately reviewed read-only query path. The endpoint shape, host, authentication method, and credentials are undecided until the business API owners approve them. No implementation may infer an endpoint from this ADR.

The adapter accepts only normalized, already-authorized inputs:

```ts
type BillingReadAdapter = {
  listSubscriptions(input: {
    filters: SubscriptionFilters;
    limit: number;
    cursor: { currentPeriodEnd: string; tenantId: string } | null;
  }): Promise<SubscriptionListPage>;
  getEntitlements(input: {
    tenantId: string;
  }): Promise<EffectiveEntitlementDetail | null>;
};
```

The route owns authentication, permission checks, UUID and query validation, filter normalization, opaque cursor encoding, response envelopes, and request IDs. The adapter owns transport and strict validation of the approved projection. It must not accept raw query strings, browser roles, permissions, tokens, arbitrary URLs, SQL fragments, or provider payloads.

## Contract constraints

Subscription filters are limited to `plan_code`, `status`, `limit`, and `cursor`. Plan codes are `starter`, `professional`, and `business`; statuses are `trialing`, `active`, `past_due`, `restricted`, and `cancelled`. The page size is 1 to 100, with a default of 25. Cursors encode the deterministic `currentPeriodEnd + tenantId` tuple and a hash of the normalized filters. Offset pagination, arbitrary sorting, field selection, and exports are prohibited.

Subscription responses contain exactly `tenant_id`, `business_name`, `plan_code`, `status`, `currency`, `current_period_start`, `current_period_end`, and `cancel_at_period_end`.

Entitlement responses contain exactly `tenant_id`, `plan_code`, `capability_count`, `overridden_capability_count`, and `capabilities`. Each capability contains exactly `capability`, `enabled`, and `limit_value` (a non-negative integer or null). Empty capability names and extra keys are rejected by the current boundary. A concrete business capability allowlist has not yet been supplied, so this contract does not claim that unknown capability names are currently rejected. Capability allowlist approval is a pre-live gate. Duplicate capability keys and contradictions are rejected.

Neither projection includes payment methods, card data, invoices, provider customer or subscription identifiers, webhook secrets, customer records, member contact data, private files, raw override reasons, raw provider JSON, or arbitrary personal information.

## Strict validation and failure semantics

Every downstream response is untrusted. Validate status, content type, envelope, complete payload, enum values, UUIDs, timestamps, currency, amounts, cursor data, and excluded-field absence. Unknown fields are errors. The adapter does not coerce, silently drop, or partially return malformed data.

Map failures to the operator contract as follows:

| Condition | Operator result |
| --- | --- |
| Invalid route input | `400 VALIDATION_FAILED` |
| Missing or inactive operator identity | `401 UNAUTHENTICATED` |
| Missing permission | `403 FORBIDDEN` |
| Valid entitlement detail miss | `404 NOT_FOUND` |
| Timeout, connection failure, upstream `5xx`, unexpected upstream auth failure or `404`, malformed or contradictory response | `503 DEPENDENCY_UNAVAILABLE` or a separately approved consistency error |

Dependency failure never becomes an empty subscription page or guessed entitlement state. Errors do not disclose upstream URLs, SQL, tokens, response bodies, or protected-record existence. Logs contain request ID, route, result class, latency, and an approved subject hash only.

## Data and migration boundary

This decision creates no operator database, table, migration, cache, replicated billing record, or direct Neon connection. The operator API does not own subscription or entitlement writes. Mutations, if later requested, must use a separately approved business command contract with authorization, idempotency, reason, effective time, and audit behavior.

## Consequences

- Billing visibility has a stable, reviewable privacy boundary.
- Business API and Neon remain the only authoritative billing source.
- Cursor and filter rules prevent accidental broad scans and unstable pagination.
- Strict validation contains upstream contract drift and provider contamination.
- Operator reads depend on business API availability or an approved read-only query path.
- New fields, capabilities, permissions, sources, routes, or persistence require a new review.

## Approval gates

Before implementation:

1. Business API owners approve source ownership, projection schemas, status and capability allowlists, and missing-record semantics.
2. Security and privacy review approve permissions, scope, field exclusions, secret handling, rate limits, and logging.
3. API maintainers approve adapter configuration, timeout and failure mapping, cursor binding, and response validation.
4. Tests cover strict response rejection, excluded-field rejection, filter-bound cursors, malformed and contradictory data, dependency failures, safe `NOT_FOUND`, and no migration or direct Neon dependency. Before live use, the approved capability allowlist must also be enforced and tested; until then, the boundary rejects empty or invalid capability values and extra fields without claiming unknown-capability rejection.
5. Typecheck, lint, tests, build, and diff checks pass before release review. Deployment and production configuration remain separate authorization decisions.
