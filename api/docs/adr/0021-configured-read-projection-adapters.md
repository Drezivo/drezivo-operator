# ADR 0021: configured read projection adapters

**Status:** Accepted for implementation

The billing, audit, operations, and operator-directory routes use the same explicit internal-service configuration as the business read adapter. Each adapter retains its own allowlisted versioned path and strict projection schema. The application constructs these adapters only when both `INTERNAL_SERVICE_BASE_URL` and `INTERNAL_SERVICE_AUTH` are present; otherwise each route uses its unavailable port.

This shares transport configuration, not projection authority or schemas. Request IDs, cancellation, response bounds, safe error mapping, and no-store behavior remain enforced at their existing boundaries. No retries, cache, local persistence, or provider payload passthrough is added.

The rollout is reversible by removing configuration or replacing the injected ports. Live enablement still requires service authentication rotation, endpoint and scope approval, and integration tests against each business contract.
