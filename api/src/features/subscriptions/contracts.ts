import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import type { SafeOperatorPrincipal } from "../../shared/auth/operator-auth.js";

export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const planCodeSchema = z.enum(['free', 'starter', 'standard', 'professional', 'business']);
export const lifecycleStatusSchema = z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']);

export const subscriptionSummarySchema = z.object({
  tenant_id: uuid, business_name: z.string().min(1), plan_code: planCodeSchema,
  status: lifecycleStatusSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  trial_ends_at: isoDate.nullable().optional(), grace_ends_at: isoDate.nullable().optional(),
  amount_minor: z.string().regex(/^[0-9]+$/).optional(), paid_at: isoDate.nullable().optional(),
  reviewed_by: z.string().max(200).nullable().optional(), payer_key: z.string().max(200).nullable().optional(),
  paid_amount_minor: z.string().regex(/^[0-9]+$/).nullable().optional(), payment_status: z.enum(['pending','verified','failed']).nullable().optional(),
  current_period_start: isoDate, current_period_end: isoDate.nullable(), cancel_at_period_end: z.boolean(),
}).strict();
export const subscriptionPageSchema = z.object({
  items: z.array(subscriptionSummarySchema),
  next_cursor: z.string().min(1).max(2048).nullable(),
}).strict();
export const entitlementItemSchema = z.object({ capability: z.string().min(1), enabled: z.boolean(), limit_value: z.number().int().nonnegative().nullable() }).strict();
export const entitlementDetailSchema = z.object({
  tenant_id: uuid, plan_code: planCodeSchema, capability_count: z.number().int().nonnegative(),
  overridden_capability_count: z.number().int().nonnegative(), capabilities: z.array(entitlementItemSchema),
}).strict().superRefine(({ capabilities }, ctx) => {
  const seen = new Set<string>();
  capabilities.forEach((item, index) => {
    if (seen.has(item.capability)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities', index, 'capability'], message: 'Capability names must be unique.' });
    }
    seen.add(item.capability);
  });
});
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;
export type SubscriptionPage = z.infer<typeof subscriptionPageSchema>;
export type EntitlementDetail = z.infer<typeof entitlementDetailSchema>;
export type SubscriptionFilters = { plan_code?: z.infer<typeof planCodeSchema>; status?: z.infer<typeof lifecycleStatusSchema> };
export type BillingReadPort = {
  listSubscriptions(input: { principal: SafeOperatorPrincipal; filters: SubscriptionFilters; limit: number; cursor: { currentPeriodEnd: string | null; tenantId: string } | null; requestId: string }): Promise<{ items: SubscriptionSummary[]; next_cursor: { currentPeriodEnd: string | null; tenantId: string } | null }>;
  getEntitlements(input: { principal: SafeOperatorPrincipal; tenantId: string; requestId: string }): Promise<EntitlementDetail | null>;
};
export const unavailableBillingReadPort: BillingReadPort = {
  listSubscriptions: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); },
  getEntitlements: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); },
};
