# Support grant command boundary

**Status:** Proposed contract, documentation only
**Scope:** Internal operator API commands delegated to the business API

## Purpose

Support grants give an authorized Drezivo operator temporary access to one tenant. They are a narrow authorization mechanism, not impersonation, a tenant membership, or a general administrator bypass. The business API and shared Neon schema remain authoritative for grant state, tenant ownership, and audit persistence.

This document defines the boundary for the future operator commands. It does not authorize a route implementation, a new operator table, or a database migration.

## Planned commands

| Method and path | Permission | Effect |
| --- | --- | --- |
| `POST /api/v1/support-grants` | `support.grant.create` | Request one tenant-scoped, time-bounded grant for a named operator subject. |
| `POST /api/v1/support-grants/:grantId/revoke` | `support.grant.revoke` | Revoke an existing grant; the business service decides whether an already revoked or expired grant is a safe idempotent replay. |

The route authenticates the internal operator, verifies fresh operator membership, checks the command permission, validates the request, and then calls an allowlisted typed business command adapter. The route must never issue arbitrary URLs, SQL, provider payloads, or tenant writes.

## Create request

The eventual shared contract should contain only these fields:

```json
{
  "tenant_id": "uuid",
  "permission_codes": ["tenant.read"],
  "reason": "bounded human-readable reason",
  "starts_at": "RFC 3339 timestamp",
  "expires_at": "RFC 3339 timestamp"
}
```

Rules:

- `tenant_id` is validated as a UUID and resolved by the business service. A browser-supplied identifier is a selector, never proof of authority.
- `operator_subject` is not accepted from the browser. The route derives the current operator subject from the verified Clerk context and passes it to the business command as an opaque, bounded identity key. Delegating a grant to another operator requires a separately approved field, permission, and audit rule.
- `permission_codes` is a nonempty, duplicate-free allowlist. Private evidence access is a separate capability. There is no universal bypass permission.
- `reason` is required, bounded, and retained in the redacted audit record according to the business retention policy. Secrets, tokens, credentials, and unnecessary personal data are rejected.
- `starts_at` and `expires_at` are absolute timestamps. `expires_at` must be later than `starts_at`, and the maximum grant duration must be a reviewed product policy before implementation.
- The business service must recheck tenant lifecycle, target operator eligibility, permission policy, and current time inside its authoritative command transaction.

The operator API must not silently choose a duration, permission, tenant, or target subject. Any default duration or permitted code list must be supplied by an approved shared contract and documented policy.

## Revoke request

The path parameter is the grant UUID. The request body is empty unless the shared contract later approves a bounded revocation reason. The command must verify the grant belongs to the intended tenant scope without revealing cross-tenant existence. Revocation is an append-only audit action and must take effect at request-time authorization checks; expiry must not depend on a cleanup job.

## Safe success projection

The business adapter may return only a safe grant projection:

```json
{
  "grant_id": "uuid",
  "tenant_id": "uuid",
  "operator_subject": "opaque operator subject",
  "permission_codes": ["tenant.read"],
  "starts_at": "RFC 3339 timestamp",
  "expires_at": "RFC 3339 timestamp",
  "revoked_at": null,
  "created_at": "RFC 3339 timestamp"
}
```

`granted_by` may be returned only if the approved operator UI needs a safe opaque actor key. Raw Clerk claims, tokens, provider responses, internal database details, full audit payloads, and unrelated tenant records never cross this boundary. The output is validated strictly; missing, unknown, malformed, or unsafe fields fail closed.

## Authorization and idempotency ordering

The request order is mandatory:

1. Assign a request ID and authenticate the Clerk identity.
2. Resolve and verify the active internal operator membership and fresh authorization state.
3. Validate the route, body, permission, tenant scope, and command-specific policy.
4. Require a valid `Idempotency-Key`.
5. Require a valid `Idempotency-Key` after steps 1 to 3 succeed.
6. Pass the normalized request, server-derived operator subject, request ID, and idempotency key to the allowlisted adapter. The authoritative business command claims and finalizes idempotency atomically with the grant and audit outcome.
7. Safely return or replay the business command outcome; the operator API does not persist a second idempotency record.

Unauthorized requests must not create observable idempotency records. The key is scoped to the authenticated operator, operation, and target. A matching key with a different canonical request hash returns a safe conflict. Concurrent matching requests wait briefly or return an in-progress response with retry guidance. A retry must not create a second grant or second revocation.

The authoritative business command must commit the grant change, audit event, and any required outbox event atomically. The operator API must not claim success before that command confirms the durable outcome.

## Audit requirements

The business service records issuance, use, and revocation in append-only audit storage. Each record includes the tenant, actor key, action, entity type and ID, request ID, support grant ID where applicable, outcome, and a redacted summary. The summary may include approved permission codes and timestamps, but never raw bodies, tokens, secrets, private evidence, or full before/after records.

Grant issuance and revocation require audit records even when the command is rejected after authorization. Grant use must be recorded by the tenant action that relies on it. Audit failure must fail the command closed unless the approved business transaction provides an equivalent durable atomic outcome.

## Error mapping

The route uses the stable response envelope and safe public messages:

| Condition | HTTP | Code family |
| --- | ---: | --- |
| Missing or malformed body, path, timestamp, permission, or idempotency key | 400/422 | `VALIDATION_FAILED` |
| Missing or invalid identity | 401 | `UNAUTHENTICATED` |
| Missing operator permission, stale membership, or out-of-scope tenant | 403, or concealed 404 where object existence would leak | `FORBIDDEN` / `NOT_FOUND` |
| Same key with a different request hash, invalid state transition, or concurrent conflict | 409 | `IDEMPOTENCY_CONFLICT` / `STATE_CONFLICT` |
| Business API unavailable or returns an invalid response | 503 | `DEPENDENCY_UNAVAILABLE` |

Provider errors, SQL, tenant existence details, raw payloads, and stack traces are never returned or logged. A dependency failure is not represented as an empty success projection.

## Ownership and data impact

The command adapter writes through the business API's approved internal command boundary. The operator API owns no `support_grant`, tenant, membership, audit, or idempotency table and must not add a second Neon schema, mirror, cache, migration, or duplicate tenant write. No database change is proposed by this document. If the command boundary requires a new index, constraint, idempotency record, or audit field, that database impact requires a separate design review and migration plan in the business repository.

## Required implementation evidence

Before this contract is accepted for production implementation, the shared contracts workspace must approve the exact wire schemas, error codes, permission allowlist, maximum duration, recent-auth rule, command authentication, and adapter endpoint. Tests must prove denial before idempotency claim, sequential and concurrent duplicate create/revoke attempts, request-hash conflict, expired and revoked grant denial, cross-tenant concealment, malformed adapter responses, audit failure, and no secret or raw-body logging.

## Open specification questions

1. What exact permission codes are allowed in a support grant, including the separate private-evidence capability?
2. What maximum duration and allowed future start window apply to a grant?
3. Is recent reauthentication required for both create and revoke, and what freshness interval is accepted?
4. What internal business API command paths and service-to-service authentication mechanism will be approved?
5. Should a revoke of an already revoked or expired grant replay the current projection or return a state conflict?
6. Is `granted_by` needed in the operator response, or should it remain audit-only?
7. What exact audit action names and outcome values are canonical for issuance, use, rejection, and revocation?
8. Which rate limits apply per operator, tenant, operation, and idempotency key?
