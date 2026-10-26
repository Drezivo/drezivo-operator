# ADR 0027: Superadmin workspace troubleshooting and clothing deletion

Status: Retired by ADR 0028 (2026-10-26). Historical implementation record only. No hosted migration, deployment or provider change was authorized by that implementation.

The founder and Ryanny use individual accounts with the same Superadmin permissions. Either
can open any workspace, including a locked or expired subscription, without becoming a merchant
member or impersonating its owner. Access remains attached to the real operator throughout.

Business migration `0086_operator_workspace_repair.sql` owns this boundary. The operator API
calls one fixed function, `operator_workspace`, using the existing least-privilege runtime
connection. No new table, arbitrary query endpoint, owner session or broad RLS exemption is
introduced. The function has a pinned search path, requires an operator principal with no tenant
context, and grants execute only to `drezivo_app`. Helper functions have no public execute.

## Access and operations

Opening access requires a reason, a read or repair mode, and a duration of 5 to 120 minutes.
An existing `support_grant` records the operator, tenant, permissions and expiry. Every read or
mutation rechecks the grant against the authenticated operator and tenant. Unknown permissions,
future grants, expiry and revocation deny data access. Closing an expired own grant is permitted;
it grants no data access. Grant row locks serialize operations with revocation.

The workspace console exposes 22 operational views: clothing, variants, stock, categories,
branches, reservations and lines, fittings and lines, customer record identifiers, membership
state, payments, charges, deposits, refunds, maintenance, allocations, custody, disruptions,
storefront state, file lifecycle and jobs. Projections exclude personal contact data, evidence,
storage paths, provider identifiers, tokens, raw job payloads and merchant activity logs.

Repair mode currently permits these encoding corrections:

| Resource | Editable fields |
| --- | --- |
| Clothing | Name, code, description, subcategory |
| Variant | SKU, size label, color label |
| Physical stock | Asset code |
| Category | Name, display order |
| Branch | Name, code |

Other record types are inspectable here; their state transitions remain in their business
workflows. Existing operator controls still administer tenant profiles, subscriptions, payments,
staff access, jobs and notifications. This console does not provide unrestricted merchant-app
takeover, raw table editing, or deletion of financial and booking history. Additional administrative
commands must preserve the business workflow invariants rather than bypass them.

## Permanent clothing deletion

A preview names the selected clothing and its ID, counts variants, stock and images, and reports
reservation, fitting, allocation, maintenance, custody, disruption and away-stock blockers.
The operator types the displayed name and clothing code, a reason and an irreversible-deletion
acknowledgement. The request binds the preview's exact record ID as well as its name.
A server-computed fingerprint binds it to the complete clothing, variant, stock and image graph.
Deletion locks the graph, reruns dependency checks, and rejects stale confirmations.

Unused clothing is physically deleted together with its image links, variants and physical stock.
Featured storefront references are removed and storefront versions advance. Existing database
triggers enqueue media-cache invalidation. Each detached photo queues the existing
`file.object_cleanup.requested` outbox event with a stable clothing/file dedupe key. An old terminal cleanup attempt cannot suppress a new detach. The business worker
owns bounded retries, reference checks, shared files, retention and legal holds. No direct storage
provider call occurs in this command, and no worker or provider runs in the isolated local stack.

Referenced clothing returns a conflict without changing any row. There is no cascading deletion
of reservations, snapshots, balances, fitting history or ledger entries.

## Accountability and duplicate protection

The HTTP boundary rejects unknown fields, resources, invalid identifiers and malformed intent
keys. The UI disables in-flight controls, guards handlers synchronously and reuses one intent key
for an unchanged retry. PostgreSQL advisory locks plus the existing global audit intent index
serialize identical requests. The canonical operation, tenant, grant and body hash detects changed
intent reuse. Opening, closing, corrections and deletion return their durable prior result.

Reads, previews, access opening/closing and successful mutations produce operator audit events.
Corrections and deletion also write an existing `operator_command` record containing the support
reason. Audit metadata includes identifiers and changed field names, without copied field values,
raw request bodies or free-text reasons. The authenticated operator, support grant and command
remain linked after a clothing row is deleted.

Verification includes real migrated PostgreSQL under `drezivo_app`, HTTP boundary tests,
read-only and revoked-scope failures, stale confirmation checks, protected booking history,
physical row absence, durable cleanup, and first-arrival sequential/concurrent duplicate tests.
