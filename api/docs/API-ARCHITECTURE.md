# API architecture

`api/src` contains only process and application entry points. `app.ts` assembles the Express application from injected dependencies, `composition.ts` creates configured adapters, `server.ts` starts the normal server, and `local-server.ts` starts the isolated synthetic server.

## Request flow

```text
HTTP request
  -> shared authentication, rate limit, and permission middleware
  -> feature routes: paths and middleware
  -> feature controller: Zod input parsing and HTTP response
  -> feature service: use case and output policy
  -> feature repository: reviewed database projection/command or allowlisted service call
  -> infrastructure: PostgreSQL context or HTTP transport
```

Feature controllers receive typed repositories through their route factories. The normal composition root chooses the local database, internal service, and Clerk adapters from validated configuration. A missing adapter remains fail closed. The feature repositories own SQL and upstream endpoint calls; `infrastructure/` owns only connection, transaction, and transport primitives. `shared/` owns authentication, authorization, middleware, errors, and process lifecycle. `config/` owns runtime validation and CORS origins.

## Feature ownership

| Feature | API paths |
| --- | --- |
| Overview | `/overview` |
| Analytics | `/analytics` |
| Clients | `/businesses*`, `/people`, client profile, lock, membership, and note commands under `/tenants*` |
| Payments | `/subscription-payments`, payment review and proof links under `/tenants*` |
| Subscriptions | `/subscriptions`, trial, activation, and read-only extension commands under `/tenants*` |
| Assigned plans | `/businesses/:tenantId/entitlements` |
| Payment methods | `/platform-payment-methods*` |
| Operators | `/operators` |
| Support access | `/support-grants*`, `/support-activity`, tenant workspace access |
| Audit logs | `/audit-events` |
| Operations | `/jobs*`, `/notifications*` |
| Sessions | `/session*`, `/webhooks/operator-clerk` |

The paths above use `/api/v1` except the Clerk webhook. Health and readiness remain in `app.ts`. Synthetic profile and login routes remain in `local-server.ts`.

Each feature keeps its route registration, controller, service, contracts, and repository implementation together. Some features have additional files for a distinct use case, such as subscription administration or session webhook handling. A thin service is acceptable for a single projection, while command services keep their audited database work in the feature repository. The tenant administration repository shares a bounded transaction context with the console repositories and composes client, subscription, and payment command adapters. It does not own business schema or copy business invariants.

## Adding a feature

1. Add Zod request and response contracts in the feature.
2. Register paths and permission middleware in its `routes.ts`.
3. Translate HTTP requests in its controller and put use case policy in its service.
4. Implement a narrow repository against shared infrastructure, then inject it from `composition.ts` or `app.ts`.
5. Add behavior coverage for authorization, validation, and dependency failures. For mutations, keep audit and idempotency coverage.

Do not add business migrations or direct business database access outside the audited tenant administration adapter described in ADR 0025. Existing wire contracts, status codes, cursor rules, and permissions remain the compatibility boundary.
