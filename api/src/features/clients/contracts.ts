import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import type { SafeOperatorPrincipal } from "../../shared/auth/operator-auth.js";

const statuses = ['active', 'restricted', 'cancelled'] as const;
export const statusSchema = z.enum(statuses);
export const isoDate = z.string().datetime({ offset: true });
export const uuid = z.string().uuid();
const overviewCount = z.number().int().nonnegative().safe();
const overviewText = (max: number) => z.string().trim().min(1).max(max);

export const operatorOverviewSchema = z.object({
  verified_cash_collections: z.array(z.object({currency:z.string().regex(/^[A-Z]{3}$/),amount_minor:z.string().regex(/^[0-9]+$/),payment_count:overviewCount}).strict()).optional(),
  as_of: isoDate,
  businesses: z.object({ total: overviewCount, by_status: z.array(z.object({ status: statusSchema, count: overviewCount }).strict()).length(3).refine((items) => new Set(items.map((item) => item.status)).size === 3) }).strict(),
  subscriptions: z.object({
    active: overviewCount, trial: overviewCount, grace: overviewCount, past_due: overviewCount,
    restricted: overviewCount, cancelled: overviewCount, missing: overviewCount,
    lifecycle: z.object({
      expired_trials: overviewCount, expired_grace: overviewCount,
      incomplete_trials: overviewCount, incomplete_grace: overviewCount,
    }).strict(),
  }).strict(),
  attention: z.object({ failed_jobs: overviewCount, failed_notifications: overviewCount, active_support_grants: overviewCount }).strict(),
  recent_businesses: z.array(z.object({ id: uuid, name: overviewText(200), slug: overviewText(100), status: statusSchema, created_at: isoDate }).strict()).max(50),
}).strict();

const subscriptionSummarySchema = z.object({ plan_code: z.string().min(1), status: z.string().min(1), current_period_end: isoDate.nullable(), cancel_at_period_end: z.boolean() }).strict();
export const businessSummarySchema = z.object({
  tenant_id: uuid, business_name: z.string().min(1), slug: z.string().min(1), status: statusSchema,
  currency: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1), created_at: isoDate, updated_at: isoDate,
  branch_count: z.number().int().nonnegative(), active_member_count: z.number().int().nonnegative(), subscription: subscriptionSummarySchema.nullable(),
}).strict();
export const businessDetailSchema = z.object({
  tenant_id: uuid, business_name: z.string().min(1), slug: z.string().min(1), status: statusSchema,
  currency: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1), created_at: isoDate, updated_at: isoDate,
  branches: z.array(z.object({ branch_id: uuid, name: z.string().min(1), code: z.string().min(1), status: z.string().min(1), timezone: z.string().min(1) }).strict()),
  membership_summary: z.object({ active_count: z.number().int().nonnegative(), invited_count: z.number().int().nonnegative(), suspended_count: z.number().int().nonnegative() }).strict(),
  subscription: z.object({ plan_code: z.string().min(1), status: z.string().min(1), current_period_start: isoDate, current_period_end: isoDate.nullable(), trial_ends_at: isoDate.nullable(), grace_ends_at: isoDate.nullable(), cancel_at_period_end: z.boolean() }).strict().nullable(),
  entitlement_summary: z.object({ capability_count: z.number().int().nonnegative(), overridden_capability_count: z.number().int().nonnegative() }).strict(),
}).strict();

export type OperatorOverview = z.infer<typeof operatorOverviewSchema>;
export type BusinessSummary = z.infer<typeof businessSummarySchema>;
export type BusinessDetail = z.infer<typeof businessDetailSchema>;
export type BusinessListFilters = { q?: string; status: readonly (typeof statuses[number])[]; plan_code?: string; sort: 'created_at_desc' };
export type BusinessListResult = { items: BusinessSummary[]; next_cursor: { createdAt: string; tenantId: string } | null };

export type ReadPort = {
  overview(input: { principal: SafeOperatorPrincipal; requestId: string }): Promise<OperatorOverview>;
  listBusinesses(input: { principal: SafeOperatorPrincipal; filters: BusinessListFilters; limit: number; cursor: { createdAt: string; tenantId: string } | null; requestId: string }): Promise<BusinessListResult>;
  getBusiness(input: { principal: SafeOperatorPrincipal; tenantId: string; requestId: string }): Promise<BusinessDetail | null>;
};

export const unavailableReadPort: ReadPort = {
  overview: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.'); },
  listBusinesses: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.'); },
  getBusiness: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.'); },
};
