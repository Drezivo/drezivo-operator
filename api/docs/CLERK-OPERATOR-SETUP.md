# Clerk setup for the operator system

## Current recommendation

Use the dedicated **Drezivo-internal** Clerk application and its **Development** instance for local development. Configure the Operator API and Operator Web against that same instance. Do not use the customer business application's Clerk instance for operator sign-in or organization management.

The API fails closed unless its secret key, publishable key, and `OPERATOR_CLERK_ORGANIZATION_ID` are present. Keep the two API keys paired to one instance. The Operator Web is configured separately: set its `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the Drezivo-internal Development publishable key. The web application does not read the API's environment file.

The API accepts either of these matching pairs:

| API SDK names           | App-facing aliases                  |
| ----------------------- | ----------------------------------- |
| `CLERK_SECRET_KEY`      | `NEXT_CLERK_SECRET_KEY`             |
| `CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |

If both names for one key are set, their values must match or configuration fails. The secret and publishable keys must also belong to the same Clerk instance. Never put a secret key in the Operator Web or in any `NEXT_PUBLIC_` variable.

## Configure the Clerk Development instance

In the Clerk Dashboard, first select the **Drezivo-internal** application and its **Development** instance. Confirm the application and instance selection before creating an organization or copying keys.

Set these recommended controls:

1. Under **User & authentication → Restrictions**, set access mode to **Invite-only**. This internal console has no public sign-up flow.
2. Enable Organizations and set membership to **required**. Every operator needs access to this Clerk application and active membership in the **Internal Operator** organization before using the console.
3. Turn off user-created organizations and automatic first-organization creation. Leave verified domains disabled so membership comes from an explicit invitation.
4. Leave organization slugs disabled. The API authorizes by the exact immutable organization ID, not by a name or slug.
5. Under **Organizations → Roles & Permissions**, create the required custom roles in **All roles**. The platform owner role key must be exactly `org:platform_owner`. Creating a role in **All roles** defines it for the instance; separately add the role to the **Primary Role Set** before assigning it to organization members. Add only the roles needed by this console to that set, use `org:read_only_operator` as the default member role, and restrict `org:platform_owner` to trusted owners. Clerk's current docs say custom roles are free in Development and require its B2B Authentication add-on in Production.

Under **SSO connections**, enable **Google** for sign-up and sign-in if operators will use Google accounts. Clerk's Development instance has shared Google OAuth credentials, so a local development setup normally needs no Google Cloud credentials. For Production, configure a dedicated Google OAuth client in Clerk and complete Google's consent-screen publishing requirements. Keep Clerk's Google email-subaddress blocking enabled.

Organization creation belongs to the Clerk application selected in the Clerk Dashboard or encoded by the Operator Web publishable key. The Operator API's keys do not control browser organization creation. The Operator Web uses Clerk's `OrganizationList` when no organization is active and `OrganizationSwitcher` in the console, and those components can expose organization creation if the instance permits it. For this private operator console, disable user-created organizations and provision **Internal Operator** manually in the Dashboard while **Drezivo-internal → Development** is selected. This keeps operators from creating arbitrary workspaces that the API will reject anyway.

## Create the operator organization and invite operators

With **Drezivo-internal** and **Development** still selected, open **Organizations** in the Clerk Dashboard and create the single operator organization named **Internal Operator**. Treat the name as display text. Store the exact organization ID shown by Clerk only in `OPERATOR_CLERK_ORGANIZATION_ID` in each API's private environment configuration; do not hardcode or copy the ID into source, docs, screenshots, or chat.

Create these Clerk organization roles with the exact role identifiers the API recognizes:

| Clerk role identifier    | Current API access                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `org:read_only_operator` | Operator overview                                                                      |
| `org:platform_operator`  | Operator overview; Clients: view, lock/unlock, staff suspension, trial, mark paid, edit  |
| `org:support_operator`   | Operator overview; Clients: view only                                                  |
| `org:billing_operator`   | Operator overview and subscription reads                                               |
| `org:platform_owner`     | All permissions currently implemented by the API, including operator-wide tenant scope |
| `org:admin` (built-in)   | Same as `org:platform_owner`                                                           |
| `org:member` (built-in)  | Same as `org:read_only_operator`                                                       |

A Production instance without Clerk's B2B add-on cannot create custom roles. Use the built-in `org:admin` for the platform owners and `org:member` for everyone else; the five custom roles stay available once the add-on is enabled.

For each new operator, create an application invitation under Clerk's **User & authentication → Invitations** so Invite-only mode permits their account to sign up. Then add that account to **Internal Operator** from its organization membership screen and assign exactly the least privileged suitable role. Existing accounts in this same Clerk application do not need to be recreated. Use `org:read_only_operator` as the default. Assign `org:platform_owner` only to trusted owners who need its broad access. After any role change, verify the organization membership shows the intended role.

Clerk assigns the creator of a new organization its configured Creator Role, usually `org:admin`, which the API treats as the platform owner. Keep the default role for new members `org:member` (read-only), and give `org:admin` only to trusted owners. Any other role key is denied, so sign-in can succeed while every Operator API request is refused.

Clerk roles establish the operator's recognized membership role; custom Clerk permissions do not grant Drezivo API permissions. The API enforces its own role-to-permission mapping on every protected request. Unknown roles, users outside **Internal Operator**, and users without an active membership are denied.

The API confirms membership with Clerk's Backend API and reuses a confirmed **active** membership for 30 seconds (`MEMBERSHIP_CACHE_MS` in `src/operator-authorization.ts`), so a page does not wait on Clerk for every request. A removed or demoted operator therefore loses access within 30 seconds. Denials and Clerk errors are never cached: they are looked up again on every request and still fail closed.

## Configure local environments

Copy the root `.env.example` to `.env` and fill in the blank Clerk values using the Development keys from the selected Drezivo-internal instance:

- `CLERK_SECRET_KEY`: the server secret key.
- `CLERK_PUBLISHABLE_KEY`: the matching publishable key.
- `OPERATOR_CLERK_ORGANIZATION_ID`: the exact immutable organization ID for **Internal Operator** from that same instance. Keep this value in private environment configuration only; do not include it in code, docs, screenshots, or chat.

Alternatively, use the supported app-facing aliases above, while keeping each pair identical. Do not paste real credentials into `.env.example`, source files, or documentation.

In the separate Operator Web checkout, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to that same Drezivo-internal Development publishable key. The Web key selects the Clerk instance used for sign-in and organization selection; changing only the Operator API environment does not change the Web instance. Keep the Web's Clerk secret key unset.

The root Business API also needs `OPERATOR_CLERK_ORGANIZATION_ID` set to the same **Internal Operator** organization ID so it can validate assertions from the Operator API. Set `INTERNAL_OPERATOR_ASSERTION_SECRET` to the same random secret of at least 32 UTF-8 bytes in both API environments. Keep the Business API's ordinary `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` paired to the customer Business Clerk application; the operator organization ID and assertion secret are separate trust configuration and do not replace the Business app's Clerk keys.

After changing the Web publishable key, restart the Operator Web development server on port `3010`; Next.js embeds `NEXT_PUBLIC_` values into the browser bundle. Then create or manage **Internal Operator** from the Clerk Dashboard with **Drezivo-internal → Development** selected. Users and organizations from the customer Business Clerk application do not transfer between Clerk applications.

If you intentionally want to create additional organizations from the Operator Web UI, the browser key must still point to Drezivo-internal and Clerk's **Allow user-created Organizations** setting must be enabled. This is not recommended for the operator console: the API recognizes only the configured **Internal Operator** organization, so newly created organizations would be denied. Keep that setting off and create the single operator organization in the internal Clerk Dashboard instead.

The example also supplies local defaults for `PORT`, `OPERATOR_CORS_ORIGINS`, and `INTERNAL_SERVICE_BASE_URL`. Replace `INTERNAL_SERVICE_AUTH` with the approved local service credential when running integrations that need the Business API. Never use the example placeholder as a real credential.

## Official Clerk documentation

- [Restrict access to an application](https://clerk.com/docs/guides/secure/restricting-access)
- [Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Configure organization settings](https://clerk.com/docs/guides/organizations/configure)
- [Create and manage organizations](https://clerk.com/docs/guides/organizations/create-and-manage)
- [Configure organization roles and permissions](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)
- [Invite users to the application](https://clerk.com/docs/guides/users/inviting)
- [Invite members to an organization](https://clerk.com/docs/guides/organizations/add-members/invitations)
