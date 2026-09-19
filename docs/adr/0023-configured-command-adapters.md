# ADR 0023: configured command adapters and durable ownership

**Status:** Accepted for implementation

Support-grant and operations-retry routes now use typed command adapters when internal-service configuration is present. Commands send only normalized route input, the verified operator subject, request ID, and one idempotency key per user intent. The business service owns idempotency records, conditional state transitions, audit outcomes, outbox creation, provider uncertainty, leases, and retries.

The operator service accepts only strict success envelopes and safe result projections. Missing configuration, malformed responses, transport failures, and unknown provider states fail closed. The business repository handoff must define exact endpoint versions, eligible retry states, target-concealment mapping, duplicate replay response, audit action names, and the outbox transaction boundary before production enablement.

No local command ledger, Neon table, outbox, worker, or fire-and-forget side effect is introduced.
