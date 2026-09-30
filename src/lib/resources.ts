export const resources = [
  { id: "overview", label: "Overview", group: "Control center", path: "/" },
  { id: "analytics", label: "Analytics", group: "Performance", path: "/?view=analytics" },
  { id: "clients", label: "Clients", group: "Customers", path: "/?view=clients" },
  { id: "businesses", label: "Businesses", group: "Customers", path: "/?view=businesses" },
  { id: "subscriptions", label: "Subscriptions", group: "Commercial", path: "/?view=subscriptions" },
  { id: "entitlements", label: "Assigned plans", group: "Commercial", path: "/?view=entitlements" },
  { id: "operators", label: "Operator team", group: "Access and support", path: "/?view=operators" },
  { id: "grants", label: "Support access", group: "Access and support", path: "/?view=grants" },
  { id: "support", label: "Support activity", group: "Access and support", path: "/?view=support" },
  { id: "audit", label: "Audit log", group: "Access and support", path: "/?view=audit" },
  { id: "jobs", label: "Background jobs", group: "Delivery and integrations", path: "/?view=jobs" },
  { id: "notifications", label: "Notifications", group: "Delivery and integrations", path: "/?view=notifications" },
  { id: "payments", label: "Payments", group: "Customers", path: "/?view=payments" },
  { id: "payment-methods", label: "Payment methods", group: "Commercial", path: "/?view=payment-methods" },
] as const;

export type ResourceId = typeof resources[number]["id"];

/**
 * Views switched on in this build. Each view needs its Operator API routes and their business-side
 * endpoints to be live, so views are enabled version by version with NEXT_PUBLIC_OPERATOR_VIEWS
 * (comma-separated ids, for example "clients,operators"). Unknown ids are ignored.
 */
export const DEFAULT_OPERATOR_VIEWS: readonly ResourceId[] = ["clients", "payments", "payment-methods"];

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
  subscriptions: "Subscription state reported by the operator API.",
  entitlements: "Review the plan definition currently assigned to one business. Effective capability evaluation is not available yet.",
  audit: "Audit search is not enabled while the source, scope, and redaction rules are under review.",
  operators: "Review operator organization membership and access information.",
  support: "Support activity is blocked until the backend contract is resolved.",
  jobs: "Background job status and retry controls.",
  notifications: "Delivery status and retry controls.",
  grants: "Create or revoke temporary support access. A searchable grant history is not available yet.",
  payments: "Proofs of payment for the ₱300 Standard plan. Check the reference against the account, then approve or reject. The owner is emailed either way.",
  "payment-methods": "Where businesses pay Drezivo: the GCash, Maya or bank accounts and QR codes shown in their Subscribe dialog.",
};
