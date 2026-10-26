# ADR 0028: Retire operator support access

**Status:** Accepted

**Date:** 2026-10-26

## Context

The Operator console exposed support-grant creation and revocation, support activity, and direct
workspace inspection and repair. This allowed an operator to enter a business workspace and make
record-level changes without the business's explicit permission. The product no longer authorizes
that access pattern.

## Decision

- Remove the workspace-administration panel and Support access page from the web application.
- Retire and unmount the Operator API routes for support grants, support activity, and workspace
  access. Remove their repository adapters, permission codes, and active overview count.
- Keep tenant administration commands such as subscription and trial management behind the
  existing `tenant.admin.manage` authorization boundary.
- Keep historical platform audit events readable. They do not create or confer current access.
- Do not change the business repository, business migrations, business-owned grant records, or
  business authorization rules as part of this retirement.

Reintroducing operator access to business workspace records requires a separate product decision
and an explicit business permission model. Historical design documents remain for context and are
marked retired or superseded.

## Consequences

The Operator API no longer exposes grant, support-activity, workspace read, repair, or deletion
endpoints. The console cannot open a business workspace for troubleshooting. Existing tenant
administration actions continue only where their own server-side permissions allow them.
