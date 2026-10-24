---
title: Keep `api/src` as the TypeScript source root
parent: ../../api-mvc-refactor.md
status: closed
assignee: user
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Should TypeScript entry points move directly into `api/`, or should package files remain there while `api/src` contains entry points and source folders?

## Resolution

The user chose to keep package metadata and docs in `api/`. Keep `app.ts`, `server.ts`, and related entry points at the top of `api/src`, with features, shared code, configuration, and infrastructure in directories below it.
