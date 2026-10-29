# Operator web architecture

The Next.js App Router selects each page. The console route layout stays mounted while its children change, preserving navigation, session controls, theme, and sidebar state.

## Source boundaries

| Directory | Responsibility |
| --- | --- |
| `src/app/` | Root providers, route layouts, thin page entries, loading and error boundaries |
| `src/features/` | Feature composition, endpoints, contracts, validation, commands, UI, and tests |
| `src/shared/api/` | Transport, request state, memory cache, pagination, and mutation idempotency |
| `src/shared/auth/` | Existing Clerk/local auth bridge and token retrieval |
| `src/shared/shell/` | Persistent shell, page availability, headings, refresh registration, and sidebar scroll |
| `src/shared/navigation/` | Navigation metadata and URL builders |
| `src/shared/ui/` and `src/shared/lib/` | Reusable UI and formatting |

Route pages import feature entry components directly. The shell does not select feature components or own business data. Shared code does not import feature modules. Features may consume another feature's named capability, such as payment review inside client details.

## Routes

| URL | Feature |
| --- | --- |
| `/` | Overview |
| `/analytics` | Analytics |
| `/clients`, `/clients/[tenantId]` | Client lists, people, and business administration |
| `/businesses`, `/businesses/[tenantId]` | Optional read-only business projections |
| `/subscriptions` | Subscriptions |
| `/assigned-plans` | Entitlements |
| `/payments` | Payment review |
| `/payment-methods` | Platform payment methods |
| `/operators` | Operator directory |
| `/support-access` | Temporary grants and workspace entry |
| `/operator-activity` | Operator-only audit activity |
| `/audit-log` | Audit records |
| `/background-jobs`, `/notifications` | Operations projections and controlled retries |

The `(console)` route group adds no URL segment. Sign-in remains outside the console shell. `NEXT_PUBLIC_OPERATOR_VIEWS` controls both navigation and direct access; disabled pages do not mount data-fetching children. Configuration resource IDs remain stable.

`?view=` no longer selects pages and has no redirects. Existing query-view bookmarks open Overview at `/`. Client `tab` and `filter`, analytics `months`, and audit `actor` remain query state. Client and read-only business IDs are path segments.

## Data and session flow

1. The root layout installs the existing Clerk or local operator provider.
2. The console layout checks sign-in setup; the shell requires a signed-in operator organization.
3. A feature obtains a short-lived token through the shared auth bridge and calls the Operator API.
4. The API enforces permissions, scopes, auditing, idempotency, and database boundaries.
5. The feature validates and renders the response through the existing loading, error, and empty states.

Each API resource owns its state and request path. Older or aborted requests cannot replace the current route. Subscription and analytics parsers live at their feature boundaries. The memory cache retains request deduplication, background refresh, and command-write protection; changing a dynamic route cannot expose the previous business. Session identity changes clear cached data before feature children mount.

## Adding a feature

Add its module and thin route page, register navigation metadata and its availability ID, and compose the shared page/request primitives. Keep feature columns, links, endpoints, validation, and commands in that module. Check direct loads, navigation, Back/Forward, and sidebar scroll before publication.
