# Operator permission boundary

**Status:** Implemented boundary, not mounted in the application  
**Scope:** Shared permission middleware for internal operator routes

## Purpose

Every protected operator route needs a permission decision after Clerk identity and active internal membership have been verified. This module provides one small boundary that route factories can use without reading browser input, duplicating authorization policy, or writing a local authorization table.

The middleware does not authenticate a request. Place requireOperator before it so the request already has a verified SafeOperatorPrincipal.

## Contract

requireOperatorPermission(permission, resolver) accepts a bounded permission identifier and an injected resolver. The resolver receives:

- the verified operator principal
- the normalized permission identifier
- the Express request, for route-aware scope resolution

The resolver returns true only when the operator has the permission for the current request. Any value other than the literal boolean true denies access.

Permission identifiers use the allowlist shape [A-Za-z0-9_.:-]+, are trimmed, and are limited to 100 characters. Invalid configuration cannot authorize a request.

## Request order

A mounted route follows this order:

1. Request ID middleware assigns the request ID.
2. Clerk middleware verifies provider context.
3. requireOperator verifies authentication, the dedicated organization, and active internal membership.
4. requireOperatorPermission asks the approved Drezivo authorization source for the named permission.
5. The route validates its own path, query, body, and command policy.
6. A read adapter or business command runs.

Permission middleware does not claim idempotency, perform a database write, parse the request body, or log principal data. Mutating routes still require their own idempotency and audit boundary.

## Safe outcomes

| Condition | Result |
| --- | --- |
| Valid principal and resolver returns true | Continue to the route |
| Missing principal | 403 FORBIDDEN |
| Resolver returns false | 403 FORBIDDEN |
| Resolver throws or authorization source is unavailable | 503 OPERATOR_AUTH_UNAVAILABLE |
| Malformed permission configuration | 403 FORBIDDEN and resolver is not called |

Messages are generic. Provider details, tokens, roles, scope records, and principal data never appear in the response.

## Authority and scope

The resolver is an integration seam. It must use the approved Drezivo operator membership and permission source, not browser claims or a Clerk profile field. Tenant scope and support-grant scope remain separate checks. A permission alone must not grant access to an arbitrary tenant, and business commands must recheck scope inside their authoritative transaction.

The default resolver denies access. The application must inject a real resolver only after its source, cache rules, freshness policy, failure behavior, and audit requirements have been approved. This change deliberately does not mount a resolver or add direct Neon access.

## Database impact

None. This boundary adds no table, migration, index, cache, connection, or authorization mirror. If the approved resolver later needs an operator membership or permission table, that schema belongs in a separate design review with ownership, least privilege, retention, migration, rollback, and integration-test evidence.

## Verification

The focused tests cover asynchronous approval, missing principal, denial, malformed configuration, resolver failure, and safe error mapping. The application remains closed by default until a real authorization source is wired.

