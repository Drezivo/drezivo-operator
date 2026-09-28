# ADR 0024: Platform analytics read adapter transport

**Status:** Accepted  
**Date:** 2026-09-26  
**Scope:** Operator API route and Business API adapter for aggregate platform analytics

## Context

The accepted platform billing analytics decision defines an aggregate-only projection of Drezivo's
own platform data. The Business API is authoritative and owns query semantics. The Operator API must
authorize access without accepting tenant scope or snapshot time from a caller, and must validate
the projection before returning it.

## Decision

Expose `GET /api/v1/analytics` with a strict `months` query (`12`, `24`, `36`, or `48`, default 48).
Require `platform.analytics.read` and grant it only to the existing `platform_owner` and
`billing_operator` roles. Do not grant it through another permission or a support grant. The route
accepts no tenant selector, and it rejects caller-provided `as_of`.

The adapter calls only `GET /internal/operator/v1/analytics`. It signs the exact permission and
route in a short-lived operator assertion. It creates a canonical `months=N` query from the validated
number and uses the exact same query string for the upstream request and the assertion hash. This
binds the signed authorization to the actual query received by the Business API.

Validate the response envelope, request ID, full analytics shape, strict fields, and requested month
window. Monthly business/member series must cover every selected month from the Manila month boundary.
The weekly projection covers exactly 52 completed ISO weeks, from Monday 00:00 Asia/Manila to the
next matching boundary; business/member series contain all 52 consecutive weeks and event buckets
stay within that window. Synthetic weekly data follows the same shape. Forecast lists must contain
horizons `1`, `3`, `6`, and `12` in order, each with either exactly its horizon in consecutive monthly
points or one withheld reason. Point forecasts begin in the `Asia/Manila` month at the selected
period's exclusive `to` boundary, immediately after the final historical month. Reject dependency
failures with safe typed errors; never substitute empty or partial metrics. Return
`Cache-Control: no-store` and no row-level, personal,
payment-provider, or secret fields.

Until a stable shared-package installation that works with the Operator API's Zod version is
established, maintain a strict local Zod mirror of the shared `operatorAnalyticsQuery` and
`operatorAnalyticsResponse` schemas, with parity tests/fixtures and explicit review of future changes.
Do not add a peer-repository path dependency or silently widen the wire DTO.

## Consequences

The Operator API remains a read-only control-plane client and adds no database state. Owner and
billing roles can view only the approved platform-wide projection. Unknown scopes and query fields
fail closed. Package dependency compatibility remains an explicit follow-up before replacing the
local mirror with direct imports.

See [Read-only platform analytics](../READ-ONLY-ANALYTICS-DESIGN.md) for the route contract, fields,
failure mapping, and verification boundary.
