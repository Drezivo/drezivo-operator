# Operator API repository rules

Read `AGENTS.md`, `CONTRIBUTING.md`, and the relevant PRD or TRD before editing.

- Keep the business API authoritative for tenant and business invariants.
- Require server-side operator authorization, explicit scope, idempotency for mutations, and audit records.
- Parse all untrusted input at the boundary and fail closed on unknown values.
- Never log secrets, tokens, raw request bodies, or unnecessary personal data.
- Do not commit environment files.
- Run typecheck, lint, tests, build, and `git diff --check` before opening a pull request.
- Use clear human wording without filler or em dashes.
