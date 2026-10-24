---
title: Choose the migration sequence
parent: ../../api-mvc-refactor.md
status: closed
assignee: codex
labels:
  - wayfinder:grilling
blocked_by:
  - assign-existing-routes-to-feature-owners.md
  - define-mvc-layer-responsibilities.md
  - define-repository-infrastructure-boundary.md
---

## Question

Choose whether to move the API feature-by-feature with behavior checks after each module, or perform one coordinated source-tree migration and validate the complete API at cutover. Also decide whether temporary compatibility facades are acceptable during the move, given that they must be removed before the refactor is complete.

## Resolution

Move the source tree once with path-aware import rewriting, then split route/controller/service boundaries and domain route ownership in stages. Use typecheck after each stage and run the API behavior suite after route ownership changes. Keep the existing exported router factories where tests and internal callers use them, but remove old source folders and stale compatibility paths. Run lint, tests, build, database integration, and smoke checks at cutover.
