# ADR 0012: Shared operator tenant-scope boundary

**Status:** Accepted for implementation as an unmounted seam

## Decision

Provide requireOperatorTenantScope() for routes that select a tenant. The middleware validates a route-owned tenant identifier, requires a verified operator principal, and asks an injected resolver whether the principal may act within that tenant.

The resolver receives only the verified principal, normalized UUID, and request. The default resolver denies access. Missing or malformed scope input and false decisions return generic 403 FORBIDDEN. Resolver failures return 503 OPERATOR_AUTH_UNAVAILABLE.

## Rationale

Permission and tenant scope are separate decisions. Keeping them separate makes it harder for a permission such as business.summary.read or job.retry to become an accidental global tenant bypass. It also gives support-grant expiry and revocation one explicit integration seam.

## Consequences

- Route factories can require tenant scope without direct database access.
- Scope checks remain closed before the authoritative resolver is configured.
- Business commands still repeat scope and lifecycle checks in their transaction.
- The middleware does not reveal tenant existence, grant state, or provider details.
- No operator database, cache, or migration is introduced.

## Rejected alternatives

- Treat a valid operator permission as global tenant access: rejected because least privilege and support-grant boundaries would be lost.
- Trust a tenant ID or scope claim from the browser or Clerk token: rejected because it is not a Drezivo authorization decision.
- Let the operator API maintain a copied scope table: rejected because stale assignments or grants could survive revocation.
- Perform direct Neon queries from the middleware: rejected because business data authority and transaction rules belong to the business platform.

## Verification

The boundary is covered by tests for valid scope, denial, missing identity, malformed route data, unsafe extractor configuration, asynchronous resolution, and resolver failure. It is intentionally not mounted until the authoritative scope contract is approved.

