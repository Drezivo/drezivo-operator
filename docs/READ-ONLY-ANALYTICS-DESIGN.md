# Read-only platform analytics

**Status:** Typed aggregate adapter mounted behind internal service configuration and a signed assertion  
**Scope:** `GET /api/v1/analytics`  
**Database impact:** None. The Operator API adds no database connection, table, migration, or local cache.

## Purpose and authority

This route presents Drezivo's operational platform billing analytics. It measures Drezivo subscription
collections and platform operations; it does not measure tenant rental payments or rental GMV and makes
no accounting, recognized-revenue, or general-ledger claim. The Business API owns all source facts and
aggregation. The Operator API forwards only an approved projection and stores no copy.

The projection follows the [platform analytics decision record](../../Rentivo/docs/decisions/0009-platform-billing-analytics.md)
and the shared `operatorAnalyticsQuery` and `operatorAnalyticsResponse` DTOs. The Operator API currently
validates a strict local Zod mirror of those schemas because this peer repository has no established
shared-package installation and the package currently requires Zod 3 while this API uses Zod 4. Keep
the mirror in parity with the shared exports; package consumption requires a separate compatible,
durable dependency setup.

## Authorization and scope

The route requires verified active membership in the dedicated operator organization and the exact
`platform.analytics.read` permission. Only the existing `platform_owner` and `billing_operator` roles
receive that permission. Other roles do not gain access through overview, billing, or support grants.

This is a platform-wide aggregate route. It accepts no tenant, business, currency, or other scope
selector. Strict query parsing rejects unknown keys, including attempts to add a tenant scope. The
route does not return tenant names, row-level records, personal information, payment references,
provider identifiers, secrets, or arbitrary provider payloads.

## Query and timing

The only query field is `months`, an integer window of `12`, `24`, `36`, or `48`; it defaults to 48.
The Business API chooses `as_of`. A caller-supplied `as_of` is rejected. Monthly period boundaries
are complete `Asia/Manila` calendar months, represented as UTC instants with a half-open `[from, to)`
interval. Business and member series contain one zero-filled bucket for every selected month in order;
the returned `period.months` and series must match the validated query and complete window.

The response also includes `weekly_period` and `weekly_series` for 52 completed ISO weeks. The period
starts and ends at Monday 00:00 in `Asia/Manila`, represented in UTC, and covers exactly 52 weeks.
Business and member series contain 52 consecutive ISO week buckets, including zero counts. Event
buckets use the approved event allowlist, stay within the window, and are bounded at 208 entries.
`synthetic.weekly_series` follows the same shape. Invalid week labels, including week 53 in ISO years
that have only 52 weeks, fail closed.

The projection contains total businesses, persisted subscription lifecycle counts, provisioned members,
active-plan monthly list-price run rate separated by currency, monthly and weekly business/member/event
counts, synthetic-data aggregates, and forecasts only where the response explains why forecasts are
available or withheld. Run-rate amounts stay as integer minor-unit strings and currencies are never combined.
Forecast arrays contain horizons `1`, `3`, `6`, and `12` in that order. Each horizon has either exactly
that many consecutive monthly points or one withheld reason. For point forecasts, the first month must
match the `Asia/Manila` month at the selected period's exclusive `to` boundary, immediately after the
last historical bucket.
The projection does not claim cash collection; see ADR 0009 for the required collection-event semantics.

## Internal adapter

The adapter calls exactly `GET /internal/operator/v1/analytics` through the shared internal service
client. It sends the service credential, request ID, and a short-lived operator assertion containing
the verified subject, organization, one role, exact method/path, `platform.analytics.read`, and request
ID. It serializes the normalized month value once as `months=N`; those exact bytes are used both in the
upstream URL and the assertion `query_hash`. The client enforces HTTPS (except explicit loopback test
configuration), timeout, response-size limits, and redirect rejection.

The adapter validates the complete strict response envelope, matching request ID, shared analytics
DTO shape, full month and week windows, forecast horizon order/count/continuity, and matching requested
month window. Unknown fields, malformed values, wrong-window data, unexpected statuses, non-JSON
bodies, and malformed envelopes fail closed. The API sets
`Cache-Control: no-store` and returns the correlated standard request envelope.

## Failure behavior

| Condition | Result |
| --- | --- |
| Unknown, duplicate, malformed, or unsupported query field | `400 VALIDATION_FAILED` |
| Missing identity or inactive operator membership | `401 UNAUTHENTICATED` |
| Wrong role, missing permission, missing verified principal | `403 FORBIDDEN` |
| Missing/invalid assertion configuration | `503 OPERATOR_AUTH_UNAVAILABLE` |
| Timeout, connection failure, or rejected upstream status | `503 DEPENDENCY_UNAVAILABLE` |
| Malformed, extra-field, mismatched-request, or wrong-window response | `503 DEPENDENCY_INVALID_RESPONSE` |

Messages do not include upstream URLs, response bodies, credentials, or provider details. Do not log
the analytics payload or unnecessary operator personal data.

## Verification boundary

Tests cover unauthenticated access, the owner/billing role allowlist, permission denial, rejected scope
and client `as_of`, missing/extra weekly fields, malformed ISO weeks, incomplete weekly windows,
forecast gaps/duplicate horizons/wrong point counts/month gaps, changed month windows, assertion
configuration and claims, canonical query hash binding, upstream timeout/failure, request correlation,
and a successful complete-window aggregate response.
They run without a database and do not establish production configuration or source-data correctness.
