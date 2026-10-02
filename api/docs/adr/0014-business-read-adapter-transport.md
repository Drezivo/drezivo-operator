# ADR 0014: Use the controlled transport for business reads

**Status:** Accepted for implementation as an unmounted adapter

## Decision

The business read adapter uses InternalServiceClient for all overview, business-list, and business-detail calls. ReadPort methods require the current request ID, which is forwarded to service authentication and the upstream request header.

The adapter validates the upstream envelope and projection schemas after transport validation. It accepts 200 responses for all reads and 404 only for business detail, where 404 becomes null. The operator API continues to expose its own stable errors.

## Rationale

The previous adapter had its own fetch, timeout, URL, and authentication handling. Centralizing those controls prevents drift and preserves one reviewable outbound boundary. Passing the request ID keeps traces connected across services.

## Consequences

- Read adapters share HTTPS, path, method, timeout, size, content-type, and redirect controls.
- Missing service authentication fails closed.
- Malformed successful data is distinguished from transport failure.
- A business detail not-found result is explicit, while collection not-found results fail closed.
- No database, cache, or route mounting is introduced.

## Rejected alternatives

- Keep direct fetch logic in each adapter: rejected because security and error behavior would drift.
- Accept any upstream status as an empty projection: rejected because dependency failures must not become false success.
- Generate a new request ID inside the adapter: rejected because it would break end-to-end correlation.
- Mirror business read data in the operator service: rejected because Neon and the business API remain authoritative.

## Verification

Tests cover request ID and auth propagation, approved query mapping, 200 and 404 behavior, malformed envelopes and projections, non-JSON responses, timeout, transport failure, and safe error mapping.
