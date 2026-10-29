export const resources = [
  { id: "overview", label: "Overview", group: "Control center", path: "/" },
  { id: "analytics", label: "Analytics", group: "Performance", path: "/analytics" },
  { id: "clients", label: "Clients", group: "Customers", path: "/clients" },
  { id: "businesses", label: "Businesses", group: "Customers", path: "/businesses" },
  { id: "subscriptions", label: "Subscriptions", group: "Commercial", path: "/subscriptions" },
  { id: "entitlements", label: "Assigned plans", group: "Commercial", path: "/assigned-plans" },
  { id: "operators", label: "Operators", group: "Access and support", path: "/operators" },
  { id: "support", label: "Operator activity", group: "Access and support", path: "/operator-activity" },
  { id: "audit", label: "Audit log", group: "Access and support", path: "/audit-log" },
  { id: "jobs", label: "Background jobs", group: "Delivery and integrations", path: "/background-jobs" },
  { id: "notifications", label: "Notifications", group: "Delivery and integrations", path: "/notifications" },
  { id: "payments", label: "Payments", group: "Customers", path: "/payments" },
  { id: "payment-methods", label: "Payment methods", group: "Commercial", path: "/payment-methods" },
] as const;

export type ResourceId = typeof resources[number]["id"];

/**
 * Views switched on in this build. Each view needs its Operator API routes and their business-side
 * endpoints to be live, so views are enabled version by version with NEXT_PUBLIC_OPERATOR_VIEWS
 * (comma-separated ids, for example "clients,operators"). Unknown ids are ignored.
 */
export const DEFAULT_OPERATOR_VIEWS: readonly ResourceId[] = ["overview", "analytics", "clients", "subscriptions", "entitlements", "operators", "audit", "jobs", "notifications", "payments", "payment-methods"];

export function enabledResourceIds(configured: string | undefined = process.env.NEXT_PUBLIC_OPERATOR_VIEWS): ResourceId[] {
  const known = new Set<string>(resources.map((resource) => resource.id));
  const requested = (configured ?? "").split(",").map((id) => id.trim()).filter((id): id is ResourceId => known.has(id));
  return requested.length > 0 ? [...new Set(requested)] : [...DEFAULT_OPERATOR_VIEWS];
}

export function visibleResources(configured?: string) {
  const enabled = new Set(enabledResourceIds(configured));
  return resources.filter((resource) => enabled.has(resource.id));
}

export const resourceHelp: Record<ResourceId, string> = {
  overview: "Current platform activity from the operator API.",
  analytics: "Monthly platform trends and additions projected from the operator API. List-price run-rate is not cash income.",
  clients: "Every client business with its trial, payment and staff status. Lock or unlock a business, suspend staff, set a trial end or record a payment.",
  businesses: "Tenant records returned by the operator API.",
  subscriptions: "Subscriptions, latest verified payments, responsible reviewers and upcoming due dates.",
  entitlements: "Review the plan definition currently assigned to one business. Effective capability evaluation is not available yet.",
  audit: "System billing events and operator accountability, with responsible actor, target, outcome and request trace.",
  operators: "Review operator organization membership and access information.",
  support: "Operator actions across the platform. Merchant and front-desk activity is excluded.",
  jobs: "Background job status and retry controls.",
  notifications: "Delivery status and retry controls.",
  payments: "Subscription payment proofs sent by business owners. Check the reference against the account, then approve or reject. Reviews are audited and owner notifications are queued.",
  "payment-methods": "Where businesses pay Drezivo: the GCash, Maya or bank accounts and QR codes shown in their Subscribe dialog.",
};

/** Resolve nested business pages to the navigation item that owns them. */
export function resourceForPath(pathname: string) {
  return resources.find((resource) => resource.path === pathname
    || (resource.path !== "/" && pathname.startsWith(resource.path + "/")));
}
export function clientHref(tenantId: string): string { return "/clients/" + encodeURIComponent(tenantId); }
export function businessHref(tenantId: string): string { return "/businesses/" + encodeURIComponent(tenantId); }
