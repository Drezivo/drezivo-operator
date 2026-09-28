# Contributing to the Drezivo Operator API

## Branches

Use a short-lived branch from `main`:

```text
feat/operator-overview
fix/operator-auth-denial
docs/operator-boundary
chore/operator-dependency-refresh
```

Do not commit directly to `main` or force-push it. Rebase your own branch onto the current `main`; do not merge `main` repeatedly into the feature branch.

## Commits and pull requests

Use Conventional Commits. The subject is imperative, lowercase, and no longer than 72 characters.

```text
feat(auth): verify internal operator membership
fix(grants): reject expired support access
docs(operator): clarify control-plane boundary
```

One pull request should have one purpose. Explain the behavior, reference the PRD or TRD section, list validation, and call out data or authorization changes. The author opens the pull request and the designated reviewer merges it. Use squash merge after required checks and approval are complete.

## Required checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Run integration tests against a disposable Neon-compatible database before any database or authorization change is accepted as production-ready.

## Environment names

Deployment configuration is supplied by the host and is never committed. The root `.env.example` contains safe local defaults and blank secret placeholders. Copy it to `.env` for local work and fill in credentials through an approved source; never commit `.env`.

The operator API requires a Clerk secret key, publishable key, and the exact operator organization ID. Both Clerk keys must come from the same Drezivo-internal Development instance. The Operator Web is configured separately and must use that instance's publishable key too. See [Clerk operator setup](docs/CLERK-OPERATOR-SETUP.md) for the Dashboard procedure, role mapping, and supported environment aliases. Missing or incomplete Clerk configuration must leave protected routes unavailable rather than granting access.

The Overview bridge also requires `INTERNAL_OPERATOR_ASSERTION_SECRET`, a shared secret of at least 32 UTF-8 bytes that matches the Business API verifier. Keep it in deployment secret configuration; do not commit its value. Without it, the Overview read fails closed before making an upstream request.

For local development, set `OPERATOR_API_HOST=127.0.0.1` in the process environment to accept connections only through loopback. The validated default is `0.0.0.0`, which preserves the deployed bind behavior.

## Review focus

Reviewers check authority boundaries first, then tenant scope, idempotency, audit behavior, error safety, tests, and operational failure handling. A passing build is not evidence that an authorization or migration design is safe.
