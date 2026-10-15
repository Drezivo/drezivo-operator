# ADR 0026: Platform accountability and local operator delivery

Status: Implemented locally; release and provider configuration require separate authorization.

The operator console excludes merchant activity. Tenant detail retains an empty `recent_audit`
compatibility field and never queries staff history. System audit uses a bounded projection of
operator actions, platform billing events, platform payment-method changes and operator sessions.
Merchant reservations, inventory, customers and front-desk actions are excluded at the database
projection, including when a client explicitly requests a staff actor or tenant filter.

Business migration 0085 owns the projection and session uniqueness index. No operator-owned table
or shadow tenant database is introduced. Fixed SECURITY DEFINER functions follow migration 0069:
pinned search_path, no dynamic caller SQL, explicit operator context, no tenant context, revoked
PUBLIC execute and drezivo_app only. Runtime still refuses superuser/BYPASSRLS credentials.

Session events derive actor and session from verified authentication. Session identifiers are
hashed into opaque UUIDs; raw tokens and session identifiers are not persisted. A partial unique
index makes start/end reports duplicate-safe, including concurrent calls. Explicit sign-out requests use `operator.session.sign_out_requested`. Provider-confirmed endings,
revocations and removals arrive through the signature-verified raw-body webhook. Only previously
verified operator sessions are accepted. Browser closure is never inferred. The local identity
authority records actual local logout and invalidates the local token. Permission decisions are
audited before access; permission granted is distinct from a completed mutation.
Billing metadata is allowlisted, excludes proof and payment references, and preserves the recorded
actor. Legacy events without actors remain system/unknown rather than attributing a guessed payer.

Docker local entrypoints use synthetic identities and a generated local signing secret, reject
non-development mode and nonlocal databases, and run on an internal network with loopback ports.
They are separate from production entrypoints. No hosted Clerk, Resend, Supabase or storage keys
are loaded. Payment-review mail stays in the existing durable outbox; no hosted worker is started.

Validation: real migrated PostgreSQL with least-privilege runtime role, authorization and privacy
checks, stable pagination, sequential/concurrent duplicate requests, UI guards, browser shell
navigation and sign-out. Deployment, schema rollout and live-provider testing remain separate.


Product scope for this phase: two individual Superadmin operators (the founder and Ryanny), with
identical permissions. Clerk built-in org:admin or legacy org:platform_owner in the dedicated
organization maps to internal platform_owner. Member and specialist roles are denied. Historical
role enum values remain wire-compatible and grant no access. Local fixtures are not a live account
allowlist and create no hosted users or invitations.
