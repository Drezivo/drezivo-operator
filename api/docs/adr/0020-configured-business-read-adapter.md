# ADR 0020: fail-closed configuration for the business read adapter

**Status:** Accepted for implementation

## Decision

When both `INTERNAL_SERVICE_BASE_URL` and `INTERNAL_SERVICE_AUTH` are present, the application constructs the existing typed business read adapter. When either value is absent, the application keeps the unavailable read port. The adapter owns exact internal paths, request-ID propagation, strict response validation, bounded transport, and safe error mapping.

The service authentication value is read only from host configuration and is passed through the injected client callback. It is never logged, returned, accepted from a request, or included in an error. Production must provide secret rotation outside this repository.

## Alternatives and impact

Trusting browser credentials, calling arbitrary URLs, or silently enabling an incomplete adapter were rejected. The route flow is request validation and authorization, configured adapter, strict Zod projection validation, safe envelope, or generic dependency failure. Missing configuration remains safe to deploy and fails closed.

No database, cache, retry worker, or migration is introduced. A later adapter factory can add separately approved projections without changing route contracts.
