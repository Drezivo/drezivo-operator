# ADR 0013: Controlled internal service transport

**Status:** Accepted for implementation as an unconnected transport seam

## Decision

Use an injected InternalServiceClient for calls from the operator API to the business API. It accepts only approved relative internal paths, uses HTTPS by default, rejects redirects, applies bounded timeouts and response sizes, and maps transport failures to safe dependency errors.

Service authentication is injected rather than read directly from source code or selected implicitly. The client does not parse or expose upstream response contracts; each adapter validates its own response.

## Rationale

Direct fetch calls scattered across route handlers make SSRF, credential forwarding, timeout, response-size, and error-leak mistakes likely. A single transport boundary makes those controls reviewable and testable.

The operator API remains a control plane. The business API and Neon remain authoritative for tenant records, grants, jobs, notifications, idempotency, and audit facts.

## Consequences

- Read and command adapters share the same outbound safety controls.
- A missing or unsafe service credential fails closed.
- Redirects cannot forward an internal authorization header to another host.
- Upstream response bodies and secrets do not cross the HTTP error boundary.
- No database or environment-file change is included.
- A live adapter still needs explicit contract, authentication, retry, and egress approval.

## Rejected alternatives

- Let handlers call arbitrary URLs: rejected because it creates an SSRF and credential-forwarding risk.
- Follow redirects automatically: rejected because a trusted internal URL could redirect to an untrusted host.
- Return upstream status and body directly: rejected because it leaks internal details and makes public error contracts unstable.
- Add automatic retries in the transport: rejected because a retry can duplicate a command unless the adapter proves idempotency.
- Read a fixed secret from source code: rejected because rotation and deployment ownership belong outside the repository.

## Verification

Tests cover successful JSON, path and URL restrictions, HTTPS policy, request headers, method and request-shape validation, authentication failures, timeout and redirect failures, non-success responses, malformed JSON, and response-size limits.

