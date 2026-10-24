---
title: Assign existing routes to feature owners
parent: ../../api-mvc-refactor.md
status: closed
assignee: codex
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Confirm the final feature owner for every existing route before code moves. In particular, decide whether `/businesses` and business detail reads belong to clients, whether entitlement reads are the assigned-plans feature, and whether session audit and Clerk webhook routes form one sessions feature.

The current route set includes overview, analytics, business and tenant administration, subscriptions and entitlements, subscription payments, platform payment methods, operators, support grants and activity, workspace access, audit events, jobs and notifications, retry commands, session endpoints, and the Clerk webhook. The current proposal is to assign each to the matching navigation feature, with operations and sessions retained as standalone technical features.

## Resolution

The console navigation owns overview, analytics, clients, payments, subscriptions, assigned plans, payment methods, operators, support access, and audit logs. Operations owns jobs, notifications, and retry commands. Sessions owns `/session`, `/session/events`, and the Clerk webhook. Business summary/detail and tenant profile/membership routes belong to clients; entitlements belong to assigned plans; support grants, activity, and workspace belong to support access. Paths and wire responses remain unchanged. The route matrix is documented in `api/docs/API-ARCHITECTURE.md`.
