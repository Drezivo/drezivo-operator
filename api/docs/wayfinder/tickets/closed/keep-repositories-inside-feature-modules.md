---
title: Keep repositories inside their feature modules
parent: ../../api-mvc-refactor.md
status: closed
assignee: user
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Should feature repository implementations live inside their feature modules or remain grouped under shared infrastructure adapters?

## Resolution

The user chose feature-owned repository implementations. Shared database connections, HTTP clients, and transport primitives can remain in infrastructure and be injected into the feature repositories.
