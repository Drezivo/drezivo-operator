# Drezivo Internal Operator System PRD

**Status:** Draft for backend foundation review  
**Audience:** Drezivo founders, operators, support, billing, and engineering teams

## 1. Purpose

The internal operator system gives Drezivo staff a controlled way to understand platform health, assist businesses, and manage platform configuration. It is a separate surface from the merchant application and public website. It must make operator actions traceable, limited in scope, and reversible where practical.

This system is for platform operations. It is not a second merchant application and it is not a universal customer browser.

## 2. Product surfaces

- **Public website:** marketing and public storefront experiences.
- **Business application:** rental owners and front desk staff manage branches, inventory, reservations, customers, payments, and calendars.
- **Operator system:** founders, support, billing, and platform operators manage tenant lifecycle, entitlements, support grants, jobs, notifications, and platform health.

The operator system must not reproduce merchant navigation such as Reservations, Clothing, Customers, Calendar, or Payments. A support operator reaches a tenant only through an approved, time-bound support grant and the smallest permitted view.

## 3. Users and roles

The operator identity is authenticated separately from a business membership. Clerk may provide identity and organization membership, while Drezivo owns authorization and audit decisions.

Initial internal roles:

- `platform_owner`: all approved platform operations, including operator administration.
- `platform_operator`: tenant and operational administration within assigned permissions.
- `support_operator`: support grants, safe tenant projections, and support activity.
- `billing_operator`: plans, subscriptions, entitlements, and billing investigations.
- `read_only_operator`: approved read-only projections and audit access.

Role checks occur on every route. A UI restriction is never an authorization control. Sensitive actions require an explicit reason, idempotency, and an audit event.

## 4. Navigation and modules

### DREZIVO ADMIN

- Overview
- Businesses
  - All Businesses
- Subscriptions
- Entitlements
- Support
  - Access Grants
  - Support Activity
- Admin Team
- Audit Log
- Operations
  - Jobs
  - Notifications
- Settings

### Overview

Show tenant totals and statuses, recent signups, attention alerts, failed jobs or notifications, and recent support actions. Values are safe summaries. Do not expose raw secrets, payment credentials, private evidence, or unrestricted customer records.

### Businesses

Search and list businesses by safe identifiers, status, plan, and timestamps. A tenant detail view contains tabs for Overview, Subscription, Entitlements, Members, Support Access, and Audit History. Each tab returns the least data required for its task.

### Subscriptions and plans

Show immutable plan versions, current subscription state, billing period, trial or grace state, and subscription history. Price values are stored as integer minor units with currency. The current business plans are PHP 300, PHP 499, and PHP 1,299 monthly, represented as 30000, 49900, and 129900 minor units. A plan version is never silently repriced.

### Entitlements

Show effective capability flags and limits after plan, account, and approved override evaluation. Operators may not grant capabilities by editing a client payload. Changes use a controlled command with authorization, reason, effective time, and audit record.

### Support access

A support grant is tenant-scoped, permission-scoped, time-bound, and revocable. Creating one requires the target tenant, permission codes, reason, start time, expiration, and idempotency key. The grant must be visible in support activity and audit history. Private documents require a separate capability. There is no permanent universal bypass role.

### Admin team

List internal operators with safe identity fields, roles, status, last activity summary, and assignment information. Membership changes require owner-level authorization and audit history. Do not mirror unnecessary Clerk profile data.

### Audit log

Provide append-only, filterable metadata: actor, action, entity type and identifier, support grant, request ID, timestamp, outcome, and redacted summary. Never store full request bodies, bearer tokens, raw webhook secrets, or sensitive before-and-after payloads.

### Jobs and notifications

Show queued, leased, succeeded, and dead jobs; retry counts; safe failure summaries; and notification delivery state. Operators can retry only through an authorized, duplicate-safe command. Workers use leases and bounded retries. No fire-and-forget side effects.

### Platform operations

Show service health, webhook processing health, storage status, and configuration checks. Operational endpoints return safe diagnostics and do not reveal environment values or infrastructure secrets.

## 5. Data ownership and database decision

The operator API is a separate control plane, not a second tenant database. Neon remains the system of record for tenant, membership, subscription, entitlement, support-grant, audit, outbox, and notification facts.

The first implementation must not clone tenant data into an operator database. Read projections should come from controlled business API endpoints or reviewed read-only queries. Mutations must use controlled internal business commands so tenant invariants, row-level security, transactions, idempotency, and audit behavior remain in one place.

If operator-only records are needed later, they must be explicitly classified and added through a reviewed migration. A least-privilege database role, schema boundary, retention policy, and rollback plan are required before direct operator persistence is introduced.

## 6. Integration choices

- **Backend:** Express and TypeScript, REST API, versioned under `/api/v1`.
- **Frontend:** Next.js and TypeScript in the separate operator web repository.
- **Authentication:** Clerk for internal identity and organization membership. The API validates the Clerk token, then evaluates Drezivo operator role and permission records.
- **Database:** Neon PostgreSQL, shared source of truth with the business platform. Use the existing reviewed query and migration conventions.
- **Files:** private S3 objects only when an approved operator evidence workflow needs them. Use short-lived signed URLs, content-type and size limits, quarantine, and access audit.
- **Contracts:** Zod at every HTTP boundary and an OpenAPI 3.1 compatibility record. Responses use the Drezivo response envelope.
- **Durable work:** Postgres outbox and job records with leases and bounded retries. Add a separate queue only after measured load or operational need.

## 7. Security and privacy constraints

- Fail closed on unknown roles, permissions, states, and routes.
- Authorize every request on the server, including reads.
- Require a reason and idempotency key for mutating operator commands.
- Use request IDs and redacted structured logs. Never log secrets, tokens, raw webhook bodies, or unnecessary personal data.
- Apply rate limits to authentication, search, exports, grants, and retry operations.
- Enforce support-grant expiry on every request, not only at creation time.
- Apply least privilege and separation of duties for billing, support, and operator administration.
- Use generic error responses for authorization failures and do not disclose whether protected records exist.
- Export and download operations are durable jobs, scope-bound, expiring, and audited.
- Retain audit records according to the approved legal and operational retention schedule. Privacy requests must be handled without weakening immutable security history.

## 8. API principles

Use resource-oriented routes under `/api/v1`. Separate queries from commands. Commands validate input, authorize scope, claim idempotency before side effects, execute the owning business command, and write an audit event in the same durable operation where possible. Return safe projections only.

Mutations are duplicate-safe for sequential and concurrent retries. Pagination is cursor-based for changing collections. Filters and sort fields are allowlisted. Error codes are stable and documented. Provider failures are mapped to safe typed errors.

## 9. Delivery phases

1. **Foundation:** repository rules, health endpoint, request context, Clerk verification boundary, operator role model, response and error conventions, CI, and documentation.
2. **Read-only control plane:** overview, business list, safe tenant detail, subscriptions, entitlements, audit search, jobs, and notifications.
3. **Owner and support commands:** time-bound support grants, revoke and expire flows, operator team administration, and fully audited mutations.
4. **Operations:** job retry, notification retry, exports, platform health, and incident workflows.
5. **Hardening:** real Neon integration tests, threat review, rate-limit tuning, retention review, load tests, accessibility, and production runbooks.

Each phase ships behind explicit acceptance criteria. A passing build does not certify production readiness.

## 10. Success measures

- Every operator action has an attributable, searchable audit event.
- No route permits access outside the operator's role and active support grant.
- Repeated commands do not duplicate grants, retries, or billing changes.
- Operators can diagnose common tenant and job issues without unrestricted customer browsing.
- Failed jobs and notifications have safe, actionable status and bounded retry behavior.
- Business data remains owned by the business platform and consistent across both surfaces.
