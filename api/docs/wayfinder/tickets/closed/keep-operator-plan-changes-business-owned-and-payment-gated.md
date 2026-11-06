---
title: Keep operator plan changes business-owned and payment-gated
parent: ../../admin-plan-changes-client-details.md
status: closed
assignee: codex
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Where should the operator plan change execute, which plan catalog and authorization boundary should it use, and what billing conditions must hold before it applies?

## Resolution

The user approved a Business API-owned plan-change command using the existing plan catalog and billing rules. The Operator API requires `tenant.admin.manage`, idempotency, and a refreshed tenant detail response. The command must refuse any transition that would bypass a required payment. Plan-change reasons are optional; an omitted reason must not prevent the action or fabricate audit text.

The user also approved optional reasons for the internal client-detail actions, including member suspension/reactivation, while payment rejection remains required because the owner sees that reason.
