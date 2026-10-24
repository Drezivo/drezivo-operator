---
title: Split tenant routes by business domain
parent: ../../api-mvc-refactor.md
status: closed
assignee: user
labels:
  - wayfinder:grilling
blocked_by: []
---

## Question

Should all tenant administration routes stay together, or should routes move to their corresponding client, subscription, and payment features?

## Resolution

The user chose to split the routes by domain: client and membership operations go to clients, subscription lifecycle operations go to subscriptions, and payment review and proof-link operations go to payments. Existing paths remain unchanged.
