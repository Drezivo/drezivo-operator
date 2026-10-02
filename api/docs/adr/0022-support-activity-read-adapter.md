# ADR 0022: support activity read adapter

**Status:** Accepted for implementation

The business support-activity service is authoritative for the redacted projection. The operator API calls only `/internal/operator/v1/support-activity` through the shared internal service client when explicit service configuration is present. The adapter forwards allowlisted filters and the `(occurred_at, event_id)` cursor, validates the complete envelope and projection, and maps all unsafe or unavailable responses to a generic dependency error.

The route remains responsible for operator permission, tenant/support-grant scope, bounded query validation, cursor binding, future-value rejection, no-store responses, and safe error envelopes. The adapter never trusts browser scope, exposes provider payloads, logs credentials, or writes persistence. Missing configuration keeps the unavailable port.
