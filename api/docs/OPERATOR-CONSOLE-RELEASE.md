# Coordinated operator console release

> **Historical rollout plan:** This runbook describes the earlier support-workspace rollout. Operator support-grant, support-activity, and workspace administration were retired by [ADR 0028](adr/0028-retire-operator-support-access.md). Do not use the workspace mutation or grant-revocation checks below for current releases. This repository change does not alter business migrations, grant records, or business authorization.

The full operator console requires a business database rollout and an operator API release
before its frontend is promoted. Merging the operator repository alone is insufficient.
The known GitHub Production integration deploys the frontend through Vercel. No operator API
deployment workflow is defined in this repository.

## Required business change

The companion change is currently in the local `Drezivo-Operator-Business-Local` checkout,
based on business staging `7488a35e7c1e1e10e96d6bcad04e5d78e31064d9`. It has not been published
or applied to a hosted database by this implementation pass.

| Business migration | SHA-256 |
| --- | --- |
| `0085_operator_console_projection.sql` | `896c8bec45e6ec6fc6e947a4cfdc841d8bcca66b4d701a4e86424e5ffeed9a89` |
| `0086_operator_workspace_repair.sql` | `c0edd9cfbf1e57467eb35b7c6e774ac4c036179f236e61c2585182360964dbbf` |

The associated business audit schema declaration and architecture documents belong in that
companion review. Publish and release them through the business repository's approved migration
workflow. Apply all prerequisites, including Free-plan migration 0082 and its target plan column.
Do not copy SQL ownership into this repository or use the local Docker bootstrap against a hosted database.

The new API calls the fixed `operator_console_projection`, `operator_console_command` and
`operator_workspace` functions. Session recording requires the new audit uniqueness index.
Existing client and payment reads also use the new metadata projection; this is not limited
to newly enabled console tabs.

## Release order

1. Verify a current database recovery point. Review and release the companion business migrations.
2. Verify the migration ledger, function signatures and grants as the business owner. Verify that
   `drezivo_app` has neither superuser nor BYPASSRLS privileges. Do not print connection secrets.
3. Release the operator API from the reviewed operator commit through its existing host.
   Retain the current verified TLS database connection, CA file, exact CORS origins and Clerk
   organization. No credential rotation or hosted account modification is part of this release.
4. Verify API liveness/readiness and authenticated routes using approved operator permissions.
   Do not alter a real client's trial, billing or inventory to test.
5. Promote the matching operator frontend commit on Vercel. Verify sign-in, business selection,
   subscription dates, and audit filters.
6. Record the exact API/frontend commit and database migration versions. Confirm that legacy
   merchant activity is excluded from operator views while source audit records remain intact.

`/ready` reports process readiness, not database migration readiness. A successful Vercel build
or HTTP 200 from the sign-in page does not prove the coordinated release is ready.

## Provider and local-mode boundaries

`NEXT_PUBLIC_OPERATOR_LOCAL_MODE` is effective only outside production. The synthetic sign-in
server additionally requires development mode and local credentials. Production must continue
to use the existing Clerk authentication boundary. Never run `local-server.ts`, `local/seed.sql`
or `local/bootstrap.mjs` against hosted data.

The optional signed session-ending webhook needs separate host configuration if provider-confirmed
logout/revocation audit is required. Explicit sign-out requests and confirmed endings are distinct.
Subscription approvals queue the existing business worker; no live email or storage action is
needed to publish this code. Free upgrades remain queued until that worker activates them.

## Validation and rollback

Local verification: 224 API tests, 136 frontend tests, 48 real PostgreSQL integration tests,
34 HTTP/database smoke checks, typecheck, API lint, both builds and source secret scanning.
The former support-access UI was exercised in the browser. Final mobile, dark-mode and keyboard
visual checks from that rollout remain historical; they do not validate the current console.

If a release fails, restore the previous API and frontend commits together. Retain the additive
business migrations and audit history while investigating; do not drop shared functions, indexes
or operator audit data as an automatic rollback. Confirm old-version compatibility before any
database reversal. A code rollback cannot undo a successfully approved payment or physical deletion.
