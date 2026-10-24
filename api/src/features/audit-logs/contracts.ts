import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";

export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const actorKinds = ['staff', 'operator', 'system', 'unrecorded'] as const;
export const platformBillingActions = new Set(['subscription.free_started','subscription.free_trial_started','subscription.free_upgrade_payment_approved','subscription.plan_change.rejected','subscription.payment.submitted','subscription.payment.verified','subscription.payment.failed','subscription.trial_started','subscription.trial_expired','subscription.grace_expired','subscription.past_due','subscription.restricted','subscription.plan_changed','subscription.renewed','subscription.converted','subscription.cancelled','billing.subscription.created','billing.subscription.activated','billing.subscription.cancelled']);
export const outcomes = ['succeeded', 'rejected', 'failed'] as const;
export const token = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
export const opaqueKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeString = z.string().max(500).regex(/^[^\u0000-\u001f\u007f]*$/);

export const auditEventSchema = z.object({
  tenant_id: uuid.nullable().optional(),
  business_name: z.string().max(200).nullable().optional(),
  billing: z.object({ amount_minor: z.string().regex(/^[0-9]{1,16}$/).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), due_at: isoDate.nullable(), payer_key: opaqueKey.nullable().optional(), paid_at: isoDate.nullable().optional() }).strict().nullable().optional(),
  event_id: uuid,
  occurred_at: isoDate,
  actor_kind: z.enum(actorKinds),
  actor_key: opaqueKey,
  action: token,
  entity_type: token,
  entity_id: uuid.nullable(),
  support_grant_id: uuid.nullable(),
  outcome: z.enum(outcomes),
  request_id: opaqueKey,
  redacted_summary: safeString.nullable(),
}).strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditFilters = { tenant_id?: string; actor_key?: string; actor_kind?: (typeof actorKinds)[number]; entity_type?: string; action?: string; outcome?: (typeof outcomes)[number]; occurred_from?: string; occurred_to?: string };
export type AuditCursor = { occurredAt: string; eventId: string };
export type AuditPort = {
  listAuditEvents(input: { filters: AuditFilters; limit: number; cursor: AuditCursor | null; requestId: string }): Promise<{ items: AuditEvent[]; next_cursor: AuditCursor | null }>;
};

export const unavailableAuditPort: AuditPort = {
  listAuditEvents: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.'); },
};
