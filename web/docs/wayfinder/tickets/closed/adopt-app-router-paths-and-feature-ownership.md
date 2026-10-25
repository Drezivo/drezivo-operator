---
title: Adopt App Router paths and feature ownership
parent: ../../app-router-feature-refactor.md
status: closed
assignee: user
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Choose the URL contract and ownership boundary for replacing the shared query-view renderer: route slugs, legacy-link behavior, business-detail paths, and shared state.

## Resolution

The user chose navigation slugs, removed legacy query-view compatibility, and selected `/clients/[tenantId]` for client details. `/` remains Overview, so an old `/?view=analytics` URL opens Overview.

Thin pages in the console route group select feature entry components. The persistent layout owns authentication, organization selection, session controls, navigation, theme, and sidebar scroll. Feature modules own requests, validation, commands, UI, and tests. Reusable transport, cache, auth helpers, and UI stay shared.

Retain client list tabs and filters, analytics range, audit actor, and workspace-grant query state. Keep enabled-view configuration and all API contracts.
