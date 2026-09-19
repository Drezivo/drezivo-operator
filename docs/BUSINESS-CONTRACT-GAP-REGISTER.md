# Business contract gap register

**Status:** Open review register
**Scope:** Evidence and unresolved contracts between the business API data model and the operator support activity projection
**Database impact in this repository:** None

This register records what the local business API documentation currently proves and where the operator API must stop until the business owners approve a contract. It intentionally does not choose a field mapping, invent an endpoint, or claim that the projection is implemented. It contains no environment values, credentials, or secrets.

## Evidence reviewed

The facts below were read from the local canonical business sources:

- `Rentivo/docs/architecture/Drezivo-ERD.dbml`
- `Rentivo/docs/architecture/Drezivo-Data-Model.md`
- `Rentivo/docs/architecture/Drezivo-TRD.md`

The local folder name is historical; the product and architecture documents identify the business system as Drezivo.

## Authoritative business facts

### Tenant audit event: `audit_event`

The tenant-owned append-only record has these fields:

| Field | Evidence in the business schema |
| --- | --- |
| `tenant_id` | Required UUID and tenant ownership key |
| `id` | Required UUID; primary key with `tenant_id` |
| `actor_key` | Required opaque actor identifier |
| `support_grant_id` | Nullable UUID linked to the tenant's support grant |
| `action` | Required bounded action token |
| `entity_type` | Required bounded entity token |
| `entity_id` | Nullable UUID |
| `redacted_summary` | Required JSON document; sensitive before/after payloads are excluded by design |
| `request_id` | Required request correlation value; the migration and Drizzle schema define `text`, while the ERD documents `uuid` |
| `created_at` | Required timestamp and ordering fact |

The documented tenant audit model has no separate `actor_kind` column and no `outcome` column. The data-model narrative says the actor namespace can accommodate staff, operator, and system identities, but the current table records the actor only through `actor_key`.

### Support grant: `support_grant`

The tenant-scoped support access record has:

| Field | Evidence in the business schema |
| --- | --- |
| `tenant_id` | Required UUID; grant is tenant-scoped |
| `id` | Required UUID |
| `operator_subject` | Required operator subject identifier |
| `granted_by` | Required granting actor identifier |
| `permission_codes` | Required JSON array/object of permission codes |
| `reason` | Required text reason |
| `starts_at` | Required timestamp |
| `expires_at` | Required timestamp; the grant is time-bound |
| `revoked_at` | Nullable timestamp; revocation is explicit |
| `created_at` | Required creation timestamp |

The model describes a grant as active only within its time window and before revocation. It is not a permanent universal bypass. Private evidence access requires a separate capability. The operator projection must therefore verify current grant scope, start, expiration, and revocation at request time; a historical event's `support_grant_id` alone is not proof of current access.

### Global audit event: `global_audit_event`

The pre-tenant append-only record has:

| Field | Evidence in the business schema |
| --- | --- |
| `id` | Required UUID |
| `account_id` | Nullable UUID; global account context may be absent |
| `actor_kind` | Required value documented as `account`, `operator`, or `system` |
| `actor_key` | Required opaque actor identifier |
| `action` | Required bounded action token |
| `entity_type` | Required bounded entity token |
| `entity_id` | Nullable UUID |
| `outcome` | Required value documented as `succeeded`, `rejected`, or `failed` |
| `redacted_summary` | Required JSON document |
| `request_id` | Required `text` value with a documented maximum length of 200 in the migration and ERD (`varchar(200)` in the ERD) |
| `created_at` | Required timestamp |

Global audit reads have additional context rules in the data model: account reads are owner-scoped, while operator and system reads require explicit transaction context and an account or entity filter. Runtime update and delete are not allowed.

## Support activity projection gaps

The operator design currently proposes a bounded support activity projection and a route-level filter contract. The following gaps prevent a transport adapter or production projection from being approved.

### 1. Actor-kind mismatch

The operator projection proposes `actor_kind` values `staff | operator | system`. `global_audit_event` defines `account | operator | system`, while `audit_event` has no `actor_kind` column. There is no approved rule for whether `account` maps to `staff`, whether staff activity is represented by tenant audit rows, or whether an actor kind should remain unknown. No mapping is selected here.

### 2. Request ID schema/documentation drift

The tenant `audit_event` migration (`api/src/db/migrations/0006_outbox_jobs.sql`) and Drizzle schema (`api/src/db/schema/audit.ts`) define `request_id` as `text`. The ERD documents the same field as `uuid`. The global audit migration defines `request_id` as `text` with a 1 to 200 character check, while the ERD documents `varchar(200)`. The operator contract must not assume UUID-only request IDs or silently normalize these representations. Business owners must reconcile the migration, schema source, ERD, and wire contract.

### 3. Tenant audit has no outcome

The operator projection proposes `outcome` values `succeeded | rejected | failed`. `global_audit_event` has `outcome`, but `audit_event` does not. The business owners have not approved whether tenant audit outcomes are inferred, omitted, joined from another fact, or excluded from a unified support activity view. The operator API must not invent an outcome.

### 4. Summary type mismatch

The operator design currently describes `redacted_summary` as nullable bounded text or an approved structured summary. Both canonical audit tables define `redacted_summary` as required JSON. No approved wire representation, maximum serialized size, redaction transform, or nullability rule exists. The adapter must not stringify arbitrary JSON or expose it unchanged without approval.

### 5. Source authority is unresolved

It is not approved whether support activity comes from `audit_event`, `global_audit_event`, or a reviewed union with explicit reconciliation and ordering rules. The source choice affects tenant scope, account visibility, support-grant linkage, actor semantics, outcome availability, retention, and duplicate handling.

### 6. Scope and grant semantics are unresolved

The route needs tenant and support-grant scope behavior for one tenant, several assigned tenants, and historical events after a grant expires or is revoked. The source documents do not define whether a revoked or expired grant may be used to read its historical activity, how multiple grants combine, or how a support grant with a null historical link is handled.

### 7. Filters and allowlists are unresolved

Action and entity-type filters are intended to be bounded allowlists, but the authoritative lists are not supplied. The source contract also does not define whether tenant-facing staff actions belong in support activity, which account filters are permitted, or how unknown values are versioned.

### 8. No internal wire contract exists

There is no approved internal endpoint, HTTP method/path contract, service-auth mechanism, request and response envelope version, timeout, pagination encoding, error taxonomy, or request-ID propagation rule for this projection. The operator route must remain fail closed and unmounted from any guessed source endpoint.

## Required approval decisions

Before implementation or live adapter mounting, business, security, and privacy owners must approve:

1. The authoritative source: tenant audit, global audit, or an explicitly defined union.
2. Actor-kind semantics, including treatment of `account`, staff identities, operators, and system actors.
3. Outcome semantics for tenant audit rows that currently lack an outcome.
4. The canonical wire type for JSON summaries, redaction transform, size limit, and nullability.
5. Tenant, account, and support-grant scope rules, including reads after expiry or revocation.
6. Action and entity-type allowlists and their versioning policy.
7. Ordering, duplicate reconciliation, cursor tuple, retention behavior, and timestamp naming.
8. Internal endpoint, service authentication, request-ID propagation, response envelope, error mapping, rate limits, and timeout.
9. Required audit access logging and whether the read itself creates a separate audit event.
10. Sequential, concurrent, scope-leakage, malformed-response, and redaction tests for the approved contract.

## Repository boundary

This register causes **no database change** in `Drezivo-Operator-API`. Do not add a mirror table, cache, migration, direct Neon query, local audit copy, or guessed adapter endpoint to resolve these gaps. Any required schema change belongs to the business system's reviewed migration process and must document ownership, RLS, retention, rollout, and rollback or forward-fix behavior. The operator repository may add a typed adapter only after the decisions above are recorded in an approved contract.
