# Operator local implementation context

Updated: 2026-10-15 (Asia/Manila).

- User explicitly required this pass to use no subagents and no staging/production changes.
- Operator baseline: GitHub main `5ba6145412308d0ebc04603ed6a4be736f43b7a4`.
- Business latest main: `4568d90226ba7804eafb0e84f2453d10c54c987d`.
- Business latest staging: `7488a35e7c1e1e10e96d6bcad04e5d78e31064d9`. Isolated business worktree
  `../Drezivo-Operator-Business-Local` uses that baseline.
- Branches are local only: `feat/operator-system-audit` and `feat/operator-local-control-plane`.
- Current operator scope is two individual Superadmins: the founder and Ryanny, identical rights.
  Only `platform_owner` is enabled. Legacy role enum values grant nothing. Do not restore the
  broader spec roles without a new owner instruction.
- No merchant activity query or history UI. `recent_audit` is empty for wire compatibility.
  Legacy support-activity transport is not mounted. Platform audit excludes customer workflows.
- Business migration 0085 supplies fixed projections, guarded commands, request fingerprints and
  session uniqueness. No independent operator database or operator-owned table was added.
- Docker uses generated ignored local credentials and synthetic fixtures. Application and database
  containers have only an internal network. Nginx exposes loopback ports 3010/5080. No provider
  credentials are read. Notification work remains in the durable outbox; no hosted sender runs.
- Session start is server-attributed. Sign-out requests and provider-confirmed endings are distinct.
  The optional signed raw-body Clerk webhook has not been configured against a hosted instance.
- Commands: `powershell -File local/init.ps1`; `docker compose -f compose.local.yaml up -d --build`;
  `docker compose -f compose.local.yaml run --rm checks`;
  `docker compose -f compose.local.yaml --profile integration run --rm integration`;
  `docker compose -f compose.local.yaml exec -T api node local/smoke.mjs`.
- No commit, push, merge, deployment, provider-account edit or hosted database migration is authorized.

## Lessons

- Read latest heads in both repositories. The operator repository can be current while the
  independently released business schema and plan price have changed.
- Recover previous Claude sessions as historical data, not current release authority. Verify GitHub.
- Do not expose all roles from a future-facing spec. This owner explicitly wants only Superadmin now.
- A private Docker network on this Docker Desktop version does not publish application ports.
  A loopback gateway can expose the UI while keeping application containers without external egress.
- Windows bind mounts did not reliably notify Turbopack. Local webpack plus WATCHPACK_POLLING
  prevents browser tests from exercising stale source. Hosted build settings remain unchanged.
- Local identity must render no Clerk organization widgets; they require a hosted Clerk provider.
- Do not leave Overview business links pointing at a view excluded from default navigation.
- Provider error messages can contain secrets or personal data; log safe error classes/codes only.

- Bound frontend test workers to two: parallel jsdom startup timed out when sharing the local Docker
  VM with the webpack dev server. Verify under the shipped worker cap rather than hiding timeouts.

## Final local verification (2026-10-15)

- API unit/contract tests: 213 passed. Frontend: 117 passed. Separate real-PostgreSQL
  integration suite: 26 passed (the normal unit run intentionally skips these opt-in tests).
- Docker smoke: 27 checks passed. Typecheck, API lint, API/web builds and diff whitespace checks passed.
- Browser: both Superadmin identities signed in; explicit local sign-out completed; Ryanny's
  filtered billing event showed amount, payer, verification time and due date. Sidebar scroll
  remained exactly 193 px across a visible link click and browser Back/Forward.
- Session start is recorded at the authenticated server boundary. The browser does not send a
  redundant start report; a timed-out extra report must not leave a stale error after recovery.
- GitHub heads were rechecked at completion and remained the baseline hashes above.
- All changes remain uncommitted. No hosted provider was called or configured. Migration 0082
  was applied only inside disposable Docker databases.


## Workspace support extension (2026-10-15)
- Migration0083 + operator-workspace API + WorkspacePanel in each client detail. Two Superadmins;
  no subagents used. Any tenant can be scoped, independent of subscription/manual locks.
- Self-issued reasoned grants: read/repair, 5-120min, tenant+subject bound, checked every operation.
  Existing support_grant/operator_command/audit ledgers only; no new operator tables.
- 22 safe operational projections; 5 encoding-correction modules; physical clothing graph deletion,
  exact name/ID/acknowledgement, server graph fingerprint, dependency/FK blockers, storefront
  cleanup and existing file cleanup outbox. No personal contact/evidence/raw payload views.
- Do not call this unrestricted owner-app takeover or raw administrative power over all tables.
  Booking/financial state transitions still use existing business workflows; immutable history stays.
- Lesson: lock the grant exclusively before repair/revoke to avoid shared-lock upgrade deadlocks.
  Allow expired own grants to close, and allow exact close replay after revocation; never let the
  active-grant check prevent a duplicate-safe close. All data access still rejects expired grants.
- Latest GitHub re-fetch: operator main5ba6145, business staging5b66ea4/maina8b2ba8 unchanged.
  New open PRs296 Free plan,297 hero short screens,298 typography; not merged into this work.
- No staging/prod/Clerk/Resend/storage actions. Local work uncommitted, isolated Docker only.

- Secret-scan lesson: CI's generic-api-key rule flags numeric-looking idempotency fixtures too.
  Use low-entropy, human-readable local intent labels; never suppress a whole test directory.

- Final validation: 219 API + 122 web + 42 real PostgreSQL integration tests = 383 passed;
  typecheck, lint, both builds, 27 local smoke checks, diff whitespace checks and CI-pinned
  Gitleaks source scan passed. Browser verified read-only denial controls, Ryanny correction
  with linked audit/command, exact destructive confirmation gate, cancellation and revoke.
- Cleanup uses operator-clothing-cleanup:<product>:<file> dedupe, so a previous dead generic
  cleanup job cannot suppress the new detach. Actual deletion tested in disposable PostgreSQL;
  browser fixture retained. All local QA workspace grants were closed and revoked.


## UI/UX follow-through (2026-10-15, in progress)
- Latest GitHub business staging advanced to7488a35 (main4568d90). Isolated local worktree
  fast-forwarded with prior edits preserved; original Rentivo checkout untouched. Operator main5ba6145.
- Upstream now includes perpetual Free + requested paid upgrade plans. Do not interpret a null
  Free period end as expired. Free upgrade approval queues the existing business activation worker;
  it does not fabricate a paid end date or send provider email here. Check server plan price.
- Uncommitted operator migrations moved to0085(console projection)/0086(workspace repair) after
  newly merged upstream0082-84. Older migration references above are historical.
- Support forms share named business selection and readable permission choices. Grant history
  has per-row revoke/open; own current grants resume through an authenticated status read.
- Lesson: passing unit tests does not prove finished UX. Exercise actual permission selection,
  directory errors, row identity, backend retry eligibility, keyboard and narrow layouts.
- Browser QA found duplicate job-row keys and mismatched native control styling; fixed both.
  Retry controls now require server can_retry, not status guesses.
- Keep heavyweight Docker checks serialized while the dev compiler is paused on this8GB VM.
  Concurrent compiler/typecheck/schema setup coincided with an unresponsive WSL engine. Docker
  recovered after terminating only docker-desktop and restarting Desktop; no volumes deleted.

- Current validation:224 API unit/contract +136 frontend +48 real PostgreSQL integration =408
  tests passed. Typecheck, API lint, both builds,34 local HTTP/DB smoke checks, diff whitespace
  checks and CI-pinned Gitleaks source scan passed. Final copy change rechecked:19 client tests.
- Browser this pass: desktop support form, common44px/10pxradius dropdowns, permission layout,
  actual read grant creation/resume, read-only controls and close verified. Browser connection
  then disappeared (Chrome and in-app browser both unavailable). Mobile/dark/keyboard final
  visual QA remains outstanding. User asked how to reconnect; answered Chrome/extension steps.
- Last GitHub re-fetch: local HEAD equals operator origin/main and business origin/staging.
  Business PR306 Free-to-paid upgrades remains open; do not merge an unreviewed PR as a
  substitute for updating to the latest merged base. No push, deploy, hosted migration or provider call.

## Operator GitHub release preparation (2026-10-15)
- User authorized publishing/deploying operator changes, conditioned on confidence in avoiding
  regressions. Main is Vercel's Production frontend source; API release is separate.
- Production blocker: new and existing client/payment paths depend on business0085/0086,
  still unpublished in the isolated business checkout. Do not merge operator code before the
  reviewed business migration/API rollout. See api/docs/OPERATOR-CONSOLE-RELEASE.md.
- No prod migration, live account change or provider test was attempted. Prepare the operator
  feature branch/PR and CI first. Publishing the companion business change requires resolving
  scope with the owner; do not silently push the other repository.
- Lesson: passing local integration does not establish hosted schema or API deployment readiness.
  Vercel success only verifies the frontend build/deployment, not the backend dependency.
