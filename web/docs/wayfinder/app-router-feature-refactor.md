---
title: Refactor the web console into App Router feature modules
status: closed
labels:
  - wayfinder:map
---

# Refactor the web console into App Router feature modules

## Destination

Complete the web console refactor with real Next.js page routes, one persistent authenticated layout, and feature-owned data, actions, UI, contracts, and tests.

## Notes

- Execution is included in this effort, as explicitly requested by the user.
- Use the local Markdown tracker format established by the API map. The API map keeps its API-only scope.
- Consult `web/AGENTS.md`, the installed Next.js documentation, and `web/docs/WEB-ARCHITECTURE.md`.
- Preserve API endpoints, permissions, auditing, idempotency, Clerk and local auth, session-scoped caching, and sidebar scroll.

## Decisions so far

- [Adopt App Router paths and feature ownership](tickets/closed/adopt-app-router-paths-and-feature-ownership.md): Use navigation slugs, nested client details, a persistent layout, and feature modules.

## Not yet specified

- No architecture decisions or implementation work remain. Route and module changes passed typecheck, the web suite, production build, and the browser checks in [Routing QA](../ROUTING-QA.md).

## Out of scope

- Backend endpoint, permission, business-rule, and database changes.
- Legacy `?view=` redirects or compatibility.
- A visual redesign or new Settings functionality.
