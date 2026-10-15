export const auditActionGroups: ReadonlyArray<{label:string;actions:ReadonlyArray<readonly [string,string]>}> = [
  { label: "Operator sessions", actions: [
    ["operator.session.started", "Signed in"], ["operator.session.sign_out_requested", "Requested sign-out"],
    ["operator.session.ended", "Signed out"], ["operator.session.revoked", "Session revoked"], ["operator.session.removed", "Session removed"],
  ] },
  { label: "Workspace support", actions: [
    ["operator.workspace.open", "Opened workspace access"], ["operator.workspace.close", "Closed workspace access"],
    ["operator.workspace.read", "Viewed workspace records"], ["operator.workspace.correct", "Corrected an encoding mistake"],
    ["operator.workspace.delete_preview", "Checked clothing deletion dependencies"], ["operator.workspace.delete", "Permanently deleted clothing"],
    ["operator.support.grant.created", "Created legacy support access"], ["operator.support.grant.revoked", "Revoked support access"],
  ] },
  { label: "Business administration", actions: [
    ["operator.tenant.lock", "Locked a business"], ["operator.tenant.unlock", "Unlocked a business"],
    ["operator.tenant.profile.update", "Updated business details"], ["operator.membership.suspend", "Suspended staff access"], ["operator.membership.reactivate", "Restored staff access"],
  ] },
  { label: "Subscriptions and payments", actions: [
    ["operator.subscription.payment.approve", "Approved a subscription payment"], ["operator.subscription.payment.reject", "Rejected a subscription payment"],
    ["operator.subscription.activate", "Recorded a paid period"], ["operator.subscription.trial.set_end", "Changed a trial end date"],
    ["subscription.free_started", "Started a Free plan"], ["subscription.free_trial_started", "Started a paid-plan trial from Free"],
    ["subscription.free_upgrade_payment_approved", "Activated an approved Free upgrade"], ["subscription.trial_started", "Started a trial"], ["subscription.converted", "Converted to a paid subscription"], ["subscription.renewed", "Renewed a subscription"],
  ] },
  { label: "Delivery and security", actions: [
    ["operator.job.retry", "Retried a background job"], ["operator.notification.retry", "Retried a notification"],
    ["operator.permission.allowed", "Allowed an operator action"], ["operator.permission.denied", "Denied an operator action"],
  ] },
] as const;
export function auditActionLabel(action: string): string {
  const match = auditActionGroups.flatMap(group => group.actions).find(([code]) => code === action);
  return match?.[1] ?? action.replaceAll("_", " ").replaceAll(".", " / ");
}
