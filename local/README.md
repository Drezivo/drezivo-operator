# Local operator console

This stack contains synthetic data and two local Superadmin identities: You and Ryanny.
It never loads hosted Clerk, Resend, Supabase or storage credentials. Application containers
have no external network. PostgreSQL migrations are read from the separate local business
worktree. It does not deploy, push or migrate a hosted database.

From the operator repository root:

```powershell
powershell -NoProfile -File local/init.ps1
docker compose -f compose.local.yaml up -d --build
```

Open <http://localhost:3010> and select either local Superadmin identity. The API gateway is
<http://localhost:5080>. These ports bind only to loopback; neither database is published.
The local sign-in choices are fixtures, not hosted accounts. Changing them changes no Clerk user.

The business checkout must exist at `../Drezivo-Operator-Business-Local` with migrations 0085 and 0086.
Use the same exact directory name or update the two read-only migration mounts in the Compose
file. Initialization records full migration filenames and is repeatable. Credentials live only in
ignored `.local` files and Docker secrets. Do not copy hosted environment files into this stack.

```powershell
docker compose -f compose.local.yaml stop web
docker compose -f compose.local.yaml run --rm checks
docker compose -f compose.local.yaml --profile integration run --rm integration
docker compose -f compose.local.yaml up -d web gateway
docker compose -f compose.local.yaml exec -T api node local/smoke.mjs
```

The integration suite uses a separate temporary PostgreSQL container and a fresh test database.
It applies the real business migrations, uses `drezivo_app` for runtime calls, checks RLS and
rejects superuser credentials. Payment-review tests assert one outbox message; they send no email.
The smoke script changes only the disposable synthetic console records. Run it after the API
is healthy. Local logout invalidates its synthetic token.

The SQL migration must be deployed before the corresponding operator code in any future release.
No hosted release is part of this pass. Real receipt storage and email delivery remain the
existing business system's provider integrations. The optional operator Clerk webhook is
`POST /webhooks/operator-clerk`; its signing secret variable is
`OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET`. It accepts signed session endings, removals and revocations
only for previously verified operator sessions. Provider configuration is a separate task.

To stop the local stack without deleting data:

```powershell
docker compose -f compose.local.yaml --profile integration down
```


Workspace support is available under **Clients -> business -> Workspace administration**.
Choose read-only troubleshooting or repair access and provide a reason. Both local Superadmins
can use either mode in every synthetic workspace. Access expires after the selected duration and
Close workspace access revokes it. Module views include record IDs and operational state without
customer contact details, private proofs or merchant activity logs.

Repair supports encoding corrections for clothing, variants, physical stock, categories and
branches. Clothing has a permanent deletion preview with dependency counts. Operators type the
displayed name and clothing code; the request also binds the exact record ID and graph fingerprint.
Linked operational history blocks deletion. A successful command physically removes
unused inventory rows and queues photo cleanup; it never starts a hosted storage or email worker.
Financial and reservation workflows are not replaced by arbitrary record editing.


Run the heavy checks sequentially with the dev compiler paused, especially on the local8GB Docker
VM. The smoke script respects Retry-After and reuses the same intent when rate limited.

Support access and Assigned plans select businesses by name. Permissions are visible choices;
no permission code or grant UUID must be memorized. Active grants have row-level open/revoke
actions. Opening an existing grant revalidates its operator, workspace and expiry.

Free workspaces have no renewal due. Their upgrade payments show the requested paid plan;
approval verifies the database price and queues the existing business activation workflow.
This local stack does not start the email/activation worker or contact hosted providers.
