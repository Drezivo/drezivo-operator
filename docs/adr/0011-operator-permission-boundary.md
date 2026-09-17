# ADR 0011: Shared operator permission boundary

**Status:** Accepted for implementation as an unmounted seam

## Decision

Provide a reusable requireOperatorPermission middleware that follows the existing requireOperator middleware. It receives a validated permission identifier and an injected asynchronous resolver. The resolver evaluates the verified operator principal and current request, then returns a boolean decision.

The default resolver denies access. Missing principals, false decisions, malformed permission configuration, and resolver failures fail closed with generic errors. Resolver failures map to 503 OPERATOR_AUTH_UNAVAILABLE; authorization denial maps to 403 FORBIDDEN.

## Rationale

Route factories already expose permission hooks, but each caller would otherwise need to implement its own provider failure mapping and default-deny behavior. A shared boundary keeps authorization semantics consistent and prevents a route from accidentally treating a missing resolver as approval.

Clerk remains an identity signal. Drezivo's approved operator membership and permission source remains authoritative. The middleware does not infer permissions from token claims and does not make tenant-scope decisions by itself.

## Consequences

- Existing routes can adopt one permission middleware without changing their command or projection ports.
- The service stays safe before the authorization source is configured because the default is denial.
- Resolver failures remain visible as a dependency error without leaking provider details.
- No operator table or migration is introduced.
- A mounted integration still needs explicit tenant or support-grant scope checks where the route touches tenant data.

## Rejected alternatives

- Allow by default when no resolver is configured: rejected because a missing authorization dependency would become an access grant.
- Read permissions directly from Clerk claims: rejected because provider claims are not Drezivo's complete role, scope, or revocation model.
- Add a local permission cache or mirror now: rejected because stale authorization could survive revocation and would require a separate data-ownership and freshness design.
- Put permission checks inside every handler: rejected because it duplicates failure mapping and makes omissions likely.

## Verification

The boundary is covered by tests for approval, denial, absent principal, malformed configuration, async resolution, and resolver failure. It is intentionally not mounted until the authoritative authorization contract is approved.

