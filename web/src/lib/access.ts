export function permissionLabel(permission: string): string {
  const labels: Record<string, string> = {
    "workspace.read": "View workspace records", "workspace.repair": "Correct records and delete unused clothing",
    "business.summary.read": "Business overview", "subscription.read": "Subscription details",
    "entitlement.read": "Assigned plan", "audit.read": "System audit records",
  };
  return labels[permission] ?? "Legacy permission";
}
export function operatorLabel(subject: string, currentOperatorId?: string | null): string {
  if (subject === currentOperatorId) return "You";
  if (subject === "user_local_founder") return "Founder";
  if (subject === "user_local_ryanny") return "Ryanny";
  return subject;
}
