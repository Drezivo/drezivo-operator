# Operator console go-live checklist (first client businesses)

Use this once, in order, to switch on the operator MVP (Clients: businesses, people, lock/unlock,
staff suspension, trial end, mark paid, edit). Tick each item only after checking it.

## 1. Database access (business Supabase project)

- [ ] The business Supabase project exists, the business migrations are applied, and the Data API is
      disabled (or `anon`/`authenticated` grants on `public` are revoked). See the business repository's
      Supabase go-live checklist.
- [ ] The `drezivo_app` role has a strong login password (the business migration creates it without
      one). Set it once in the SQL editor as the owner: `ALTER ROLE drezivo_app WITH PASSWORD '<generated>';`
      Store it only in the host's secret manager.
- [ ] `OPERATOR_TENANT_ADMIN_DATABASE_URL` uses `drezivo_app` and the **transaction pooler** (port 6543).
      Never `postgres`, `service_role`, or any role with `BYPASSRLS` — the API refuses them.
- [ ] Download the project's SSL CA certificate (Project Settings → Database) and set
      `OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE` to its path on the host. Production refuses to start without it.

## 2. Operator sign-in (Clerk, internal operator instance)

- [ ] Follow `docs/CLERK-OPERATOR-SETUP.md`: Internal Operator organization, the five `org:*` roles, invite-only.
- [ ] Assign `org:platform_owner` to the founders and `org:platform_operator` to whoever runs client
      onboarding. `org:support_operator` can view Clients but not change anything.
- [ ] `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `OPERATOR_CLERK_ORGANIZATION_ID` set on the API host.

## 3. Staff names and emails (optional but recommended)

- [ ] `BUSINESS_CLERK_SECRET_KEY` = the secret key of the **business** Clerk instance (where shop owners
      and staff sign in). Without it, people are listed by Clerk user ID.

## 4. Origins and secrets

- [ ] `OPERATOR_CORS_ORIGINS` = the exact HTTPS origin of the deployed Operator Web (for example
      `https://ops.drezivo.com`). Session tokens minted for any other origin are rejected.
- [ ] `INTERNAL_SERVICE_AUTH` (≥ 32 bytes) and `INTERNAL_OPERATOR_ASSERTION_SECRET` (≥ 32 bytes), if the
      business internal routes are used; generate with `openssl rand -base64 48`.
- [ ] Operator Web: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (operator instance) and
      `NEXT_PUBLIC_DREZIVO_API_BASE_URL` = `https://<operator-api-host>/api/v1`.
- [ ] No `.env*` file is committed in either repository (`git ls-files | grep -i env` returns nothing).

## 5. Smoke test with one real business

- [ ] Sign in to Operator Web as a platform owner → **Clients** lists the business with the right plan
      and trial date; **People** shows the owner (with email if step 3 is done).
- [ ] Set the trial end one day later → the Clients detail shows the new date and its recent activity
      shows `operator.subscription.trial.set_end`. (The staff dashboard home page is still static demo
      data, so do not use it to check dates.)
- [ ] Lock the business → the owner can still sign in but cannot change anything; unlock → changes work again.
- [ ] Suspend a test staff member → their next request is refused; reactivate → access returns.
- [ ] Double-click any action → only one audit entry appears.
- [ ] Record the date, operator and request IDs of this smoke test in the team's operations log.
