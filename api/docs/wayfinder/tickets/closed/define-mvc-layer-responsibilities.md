---
title: Define MVC layer responsibilities
parent: ../../api-mvc-refactor.md
status: closed
assignee: codex
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Lock what each feature layer owns so routes, controllers, services, and repositories do not duplicate responsibilities. Decide where Zod request and response schemas and feature contracts live; whether routes only bind paths and middleware; where HTTP parsing and response envelopes are translated; and how permission checks remain attached to the existing route behavior.

## Resolution

Feature `routes.ts` binds paths, authorization, and permission middleware. Controllers parse untrusted HTTP input with Zod, map errors, and write the existing response envelope. Services implement use cases and output policy; thin services delegate a single projection. Feature repositories implement the reviewed SQL projections/commands or allowlisted upstream calls. `contracts.ts` holds typed ports and feature schemas. Shared authentication and HTTP middleware remain under `shared/`, and composition stays at the source root.
