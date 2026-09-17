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

Deployment configuration is supplied by the host and is never committed. The service expects `NODE_ENV`, `PORT`, `CLERK_SECRET_KEY`, and `OPERATOR_CLERK_ORGANIZATION_ID`. Missing Clerk configuration must leave protected routes unavailable rather than granting access.

## Review focus

Reviewers check authority boundaries first, then tenant scope, idempotency, audit behavior, error safety, tests, and operational failure handling. A passing build is not evidence that an authorization or migration design is safe.
