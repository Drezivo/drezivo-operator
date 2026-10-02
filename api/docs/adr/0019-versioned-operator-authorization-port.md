# ADR 0019: versioned operator authorization port

**Status:** Accepted for implementation as an injected, fail-closed port

## Decision

Clerk supplies only verified identity and organization context. Drezivo authorization is resolved through the typed `AuthorizationPort` contract at version `operator-authorization.v1`. The port owns active membership, role, permission, and tenant-scope decisions. Missing, conflicting, malformed, or unavailable facts deny access or map to the existing safe authorization error.

The application injects this port into route construction. The default implementation denies membership, permissions, and tenant scope. No local authorization table, claim-derived role, client-supplied role, or Neon mirror is introduced.

Stable roles are `platform_owner`, `platform_operator`, `support_operator`, `billing_operator`, and `read_only_operator`. Permission codes are explicit and versioned in source. The resolver remains authoritative for revocation and scope; the role map is a documented baseline, not a bypass around resolver decisions.

## Alternatives rejected

- Trusting Clerk role claims: claims are identity/provider facts, not Drezivo authorization.
- Adding an operator database here: creates competing authority and requires a separate schema review.
- Allowing missing resolver facts: violates fail-closed authorization.

## Impact and replacement

Every protected route now receives the injected permission middleware while retaining the unavailable default. A future business-backed resolver can replace the port without changing route contracts. Integration must add provider-backed membership, permission, tenant-scope, revocation, and audit decision tests before production enablement.
