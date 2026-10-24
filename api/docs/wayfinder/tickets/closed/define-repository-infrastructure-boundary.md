---
title: Define the repository and infrastructure boundary
parent: ../../api-mvc-refactor.md
status: closed
assignee: codex
labels:
  - wayfinder:grilling
blocked_by:
  - ../closed/keep-repositories-inside-feature-modules.md
---

## Question

Decide the dependency contract between feature-owned repositories and shared infrastructure. Should repositories receive narrow, typed database and external-service clients from the composition root, with infrastructure owning only connection and transport setup, or should infrastructure expose broader reusable adapters that feature repositories compose?

## Resolution

Repositories sit inside feature folders and implement narrow typed ports. The composition root creates the configured adapters and injects them into route/controller factories. Shared infrastructure owns PostgreSQL connection and audited transaction contexts, console projection helpers, and internal HTTP transport. Feature repositories own SQL and endpoint selection. The audited tenant administration context remains shared because commands must use one idempotency and audit transaction; client, subscription, and payment adapters each implement their own methods over it.
