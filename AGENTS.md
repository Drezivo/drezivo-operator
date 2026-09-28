# Drezivo Operator API repository rules

Read this file, `CONTRIBUTING.md`, and the relevant documents in `docs/` before editing the repository.

## Boundaries

- This repository serves the internal Drezivo operator system only.
- The business API owns tenant and business invariants. Do not duplicate tenant writes here.
- Use allowlisted internal commands or reviewed read projections. Never add arbitrary SQL or unrestricted customer browsing.
- Every privileged action has server-side authorization, an explicit scope, idempotency where it mutates state, and an audit record.
- Support access is temporary, tenant-scoped, permission-scoped, reason-coded, and revocable.
- The business database is Supabase PostgreSQL, shared with the business system. This repository owns no tables; a new operator table or migration requires a separate design review. Direct business-database access is limited to the audited tenant-admin adapter (ADR 0025).
- Never commit any `.env*` file, including examples. Document variables in README or `docs/` instead.

## Implementation rules

- Parse untrusted input at the HTTP boundary with Zod.
- Keep dependency direction as route and authorization, application service, controlled business command or projection, data access.
- Fail closed on missing configuration, unknown roles, unknown states, and missing scope.
- Never log tokens, secrets, raw request bodies, or unnecessary personal data.
- Do not commit `.env` files or secret values.
- Use clear human wording in code, documentation, errors, and pull requests. Avoid filler, invented claims, and em dashes.

## Verification

Before opening a pull request, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check`. Changes to authorization, data access, or mutations need behavior tests, including sequential and concurrent duplicate attempts where applicable.
