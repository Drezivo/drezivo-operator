---
title: Refactor the Operator API into feature-based MVC
status: closed
labels:
  - wayfinder:map
---

# Refactor the Operator API into feature-based MVC

## Destination

Complete a feature-based MVC refactor of the whole Operator API. The destination is a maintainable `api/src` tree with explicit route, controller, service, and repository layers for each feature, while current API behavior remains compatible.

## Notes

- This effort carries through implementation after its decision tickets are resolved; the user asked for the completed refactor.
- The user chose navigation-based features, with operations and sessions retained as separate modules; feature-owned repositories; `api/src` as the source root; and tenant endpoints split by domain.
- Keep all existing API paths, wire contracts, authorization, auditing, idempotency, and database boundaries unless a later user decision explicitly changes scope.
- Do not move business invariants into this repository, add database migrations, or include the web workspace in this refactor.
- Local Markdown is the tracker fallback because the repository has no Wayfinder tracker operations document. Ticket titles are their identities. `status`, `assignee`, and `blocked_by` are stored in frontmatter; a closed ticket must include a Resolution section.
- Consult `api/AGENTS.md`, `api/docs/API-ARCHITECTURE.md`, relevant ADRs, and the Wayfinder skill during implementation.

## Decisions so far

- [Use navigation features and retain technical domains](tickets/closed/use-navigation-features-and-retain-technical-domains.md): The user selected the console navigation as the feature basis and kept operations and sessions separate where they do not map cleanly.
- [Keep repositories inside their feature modules](tickets/closed/keep-repositories-inside-feature-modules.md): Each feature owns its repository layer; shared connection and transport primitives remain shared infrastructure.
- [Keep `api/src` as the TypeScript source root](tickets/closed/keep-api-src-as-source-root.md): Keep package metadata and documentation in `api/`; keep entry points at the top of `api/src`.
- [Split tenant routes by business domain](tickets/closed/split-tenant-routes-by-business-domain.md): Client and membership operations, subscription lifecycle, and payment workflows belong to their respective feature modules.
- [Assign existing routes to feature owners](tickets/closed/assign-existing-routes-to-feature-owners.md): Each console view owns its matching routes, and operations and sessions own technical endpoints.
- [Define MVC layer responsibilities](tickets/closed/define-mvc-layer-responsibilities.md): Routes bind paths and permissions, controllers translate HTTP, services implement use cases, and repositories implement data access.
- [Define the repository and infrastructure boundary](tickets/closed/define-repository-infrastructure-boundary.md): Feature repositories use shared transaction and transport infrastructure through narrow ports.
- [Choose the migration sequence](tickets/closed/choose-migration-sequence.md): Move the source tree, split feature responsibilities in stages, and verify compatibility at cutover.

## Not yet specified

- No architecture decisions remain. Local browser smoke still requires Docker Desktop and Clerk Development credentials on the host.

## Out of scope

- Web application architecture or UI changes.
- Changes to public API routes or response contracts.
- Permission expansion or changes to operator membership and role requirements.
- Business database schema changes or relocation of business rules into the Operator API.
