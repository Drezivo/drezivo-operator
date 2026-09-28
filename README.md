# Drezivo Operator API

Internal REST API for Drezivo founders, support, billing, and platform operations.

This service is a control plane for the internal operator web application. The business API remains the source of truth for tenant, membership, subscription, entitlement, support-grant, and operational invariants. This repository does not provide a universal customer-data browser.

## Current foundation

- Express and TypeScript service
- `GET /health` liveness endpoint for the running process
- `GET /ready` process readiness endpoint, returning `ready` with HTTP 200 during normal service and `draining` with HTTP 503 during shutdown; dependency readiness is tracked separately
- request IDs and stable JSON error responses
- closed-by-default operator route seam
- security headers and bounded JSON parsing
- CI checks for typecheck, lint, test, and build

The business system's database is Supabase PostgreSQL (business ADR 0009). This service owns no tables and ships no migrations. Most operator features call the business API; the MVP business-administration routes (`/api/v1/tenants*`) read and write the business database directly under its row-level security until the business API exposes equivalent operator commands (ADR 0025, `docs/OPERATOR-TENANT-ADMIN-MVP.md`).

## Local setup

Use Node.js 22 or newer within the supported LTS range, then run:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Environment variable names and deployment requirements are documented in `CONTRIBUTING.md` and the TRD. Never commit an environment file.

For a local-only listener, set `OPERATOR_API_HOST=127.0.0.1` in the process environment before running the service. The default `0.0.0.0` preserves the deployed bind behavior.

## Documentation

- `AGENTS.md` is the repository operating contract for people and automated contributors.
- `CONTRIBUTING.md` defines branches, commits, pull requests, and release checks.
- `docs/OPERATOR-SYSTEM-PRD.md` defines the product scope.
- `docs/OPERATOR-BACKEND-TRD.md` defines backend boundaries and phased delivery.
- `docs/OPERATOR-PERMISSION-BOUNDARY-DESIGN.md` defines the shared fail-closed permission seam.
- `docs/OPERATOR-SCOPE-BOUNDARY-DESIGN.md` defines the separate tenant-scope seam.
- `docs/INTERNAL-SERVICE-CLIENT-DESIGN.md` defines the bounded business-service transport seam.
- `docs/BUSINESS-READ-ADAPTER-DESIGN.md` defines the request-correlated read adapter boundary.
- `docs/READ-ONLY-BILLING-DESIGN.md` and `docs/adr/0016-billing-read-adapter-transport.md` define the subscription and entitlement read adapter.
- `docs/READ-ONLY-AUDIT-DESIGN.md` and `docs/adr/0017-audit-read-adapter-transport.md` define the audit-event read adapter.
- `docs/READ-ONLY-OPERATOR-DIRECTORY-DESIGN.md` and `docs/adr/0018-operator-directory-read-adapter-transport.md` define the Admin Team directory read adapter.
- `docs/READ-ONLY-SUPPORT-ACTIVITY-DESIGN.md` defines the request-correlated support activity route and its blocked transport contract.
- `docs/BUSINESS-CONTRACT-GAP-REGISTER.md` records unresolved business data and wire-contract decisions blocking support activity integration.
- `docs/READ-ONLY-OPERATIONS-DESIGN.md` and `docs/adr/0015-operations-read-adapter-transport.md` define the jobs and notifications read adapter.
- `docs/adr/0001-operator-control-plane-boundary.md` records the authority decision.
- `docs/OPERATOR-GO-LIVE-CHECKLIST.md` is the one-time checklist to switch the operator MVP on for the first client businesses.
- `docs/OPERATOR-TENANT-ADMIN-MVP.md` and `docs/adr/0025-operator-mvp-direct-tenant-admin.md` define the MVP business list, lock/unlock, staff suspension, trial and activation routes.
