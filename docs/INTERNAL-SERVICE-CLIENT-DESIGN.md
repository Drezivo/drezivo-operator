# Internal business service client boundary

**Status:** Implemented transport boundary, not wired to production adapters  
**Scope:** Outbound calls from the operator API to approved business API endpoints

## Purpose

The operator API must call the business platform through a controlled internal transport. This client provides the network boundary without choosing a deployment secret, duplicating business rules, or exposing upstream responses directly to operators.

The caller remains responsible for validating the returned JSON against its route-specific Zod schema.

## Transport rules

The client enforces:

- an HTTPS base URL, with insecure HTTP allowed only when explicitly enabled for local or test use
- no base URL credentials, query, fragment, or missing trailing slash
- relative paths only
- paths under the internal prefix
- GET, POST, PUT, PATCH, and DELETE methods only
- a bounded request ID using the same safe character policy as the HTTP boundary
- a bounded timeout from 250 ms to 30 seconds, defaulting to 5 seconds
- a response body limit of at most 1 MiB
- redirect rejection so service credentials cannot follow a redirect to another host
- JSON accept and conditional content-type headers

The service authentication value is supplied by an injected callback. The callback receives only the request ID and must return a non-empty value without control characters. This leaves the approved service authentication mechanism, rotation, and secret source to deployment configuration without committing credentials or environment files.

## Error behavior

The client never returns raw upstream error bodies. Invalid URLs, unsupported methods, invalid request shapes, timeouts, aborts, non-success responses, oversized responses, malformed JSON, and transport failures map to a generic 503 DEPENDENCY_UNAVAILABLE error.

Missing, malformed, or unsafe service authentication maps to 503 OPERATOR_AUTH_UNAVAILABLE. No token, body, provider response, or URL is logged by this boundary.

## Usage boundary

A typed read or command adapter should:

1. normalize route input before calling the client
2. provide the request ID from the current request context
3. use an approved relative internal path
4. supply the deployment's service authentication callback
5. validate the returned unknown value with the adapter's exact schema
6. map business error codes to the operator API's safe public errors

The client does not perform operator authentication, permission checks, tenant scope checks, idempotency claims, audit writes, or database operations. Those concerns remain in their owning boundaries.

## Database impact

None. No tables, migrations, indexes, caches, Neon connections, or local business-data mirrors are introduced.

## Production gates

Before wiring this client to a live adapter, approve the internal endpoint allowlist, service authentication scheme, certificate or token rotation, timeout and retry policy, network egress restrictions, upstream error mapping, and observability redaction. Retries must be added only by an idempotent adapter policy; this client does not automatically retry requests.

