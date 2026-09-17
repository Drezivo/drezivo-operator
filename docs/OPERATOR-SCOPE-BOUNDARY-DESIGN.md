# Operator tenant scope boundary

**Status:** Implemented boundary, not mounted in the application  
**Scope:** Shared tenant-scope middleware for internal operator routes

## Purpose

A permission grants an operation. It does not grant access to every tenant. This boundary lets a route require an approved tenant scope after the request has a verified operator principal and permission decision.

The middleware is deliberately an integration seam. It does not query Neon, inspect Clerk claims, read request bodies, or create a local scope mirror.

## Contract

requireOperatorTenantScope(extractTenantId, resolver) accepts:

- a route-owned tenant identifier extractor
- an injected asynchronous resolver

The extractor returns unknown and the middleware validates the result as a UUID. The resolver receives the verified operator principal, normalized tenant ID, and current request. It must return the literal boolean true to allow the route.

tenantIdFromPath() is provided for the common route parameter case. Parameter names are validated when the middleware is configured. An unsafe name produces no tenant ID and therefore cannot authorize a request.

The default resolver denies access.

## Request order

A tenant route should run checks in this order:

1. request ID and Clerk context
2. requireOperator for authentication, organization, and active internal membership
3. requireOperatorPermission for the named operation
4. requireOperatorTenantScope for the selected tenant
5. route input validation
6. approved read projection or business command

The scope middleware does not claim idempotency or perform side effects. Mutating commands still pass their idempotency key to the authoritative business command after these checks.

## Safe outcomes

| Condition | Result |
| --- | --- |
| Verified principal, valid UUID, resolver returns true | Continue to the route |
| Missing principal, missing or malformed tenant ID, or resolver returns false | 403 FORBIDDEN |
| Scope resolver throws or is unavailable | 503 OPERATOR_AUTH_UNAVAILABLE |

Responses are generic and do not reveal whether a tenant exists or why a scope decision failed.

## Authority and support access

The resolver must use the approved Drezivo authorization source. It should evaluate the operator's assigned scope and, where the route permits temporary access, the current support grant, permission, start time, expiry, and revocation state. A support grant can narrow an existing operator permission; it cannot create a global bypass.

Business commands must repeat the scope and lifecycle check inside their authoritative transaction. The operator API middleware is an early boundary, not a substitute for business authorization.

## Database impact

None. This change adds no table, migration, index, cache, connection, or local tenant-scope mirror. Any future operator assignment or support-grant persistence remains owned by the business platform and requires its own schema and security review.

## Verification

Focused tests cover approval, asynchronous resolver context, default denial, missing principal, malformed UUIDs, unsafe path configuration, out-of-scope tenants, and safe resolver failures. The application remains closed by default until an approved scope source is injected.

