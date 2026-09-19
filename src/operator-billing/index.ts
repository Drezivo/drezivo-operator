import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
export const planCodeSchema = z.enum(['starter', 'professional', 'business']);
export const lifecycleStatusSchema = z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']);

export const subscriptionSummarySchema = z.object({
  tenant_id: uuid, business_name: z.string().min(1), plan_code: planCodeSchema,
  status: lifecycleStatusSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  current_period_start: isoDate, current_period_end: isoDate, cancel_at_period_end: z.boolean(),
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
  listSubscriptions(input: { filters: SubscriptionFilters; limit: number; cursor: { currentPeriodEnd: string; tenantId: string } | null; requestId: string }): Promise<{ items: SubscriptionSummary[]; next_cursor: { currentPeriodEnd: string; tenantId: string } | null }>;
  getEntitlements(input: { tenantId: string; requestId: string }): Promise<EntitlementDetail | null>;
};
export const unavailableBillingReadPort: BillingReadPort = {
  listSubscriptions: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); },
  getEntitlements: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); },
};

type Cursor = { v: 1; current_period_end: string; tenant_id: string; filter_hash: string };
const cursorHash = (filters: SubscriptionFilters) => createHash('sha256').update('drezivo-operator-billing-cursor-v1').update(JSON.stringify(filters)).digest('hex');
export function encodeSubscriptionCursor(cursor: { currentPeriodEnd: string; tenantId: string }, filters: SubscriptionFilters): string {
  const payload: Cursor = { v: 1, current_period_end: cursor.currentPeriodEnd, tenant_id: cursor.tenantId, filter_hash: cursorHash(filters) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
function decodeCursor(value: string, filters: SubscriptionFilters): { currentPeriodEnd: string; tenantId: string } {
  try {
    const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (p.v !== 1 || p.filter_hash !== cursorHash(filters) || !isoDate.safeParse(p.current_period_end).success || !uuid.safeParse(p.tenant_id).success) throw new Error();
    return { currentPeriodEnd: p.current_period_end, tenantId: p.tenant_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export type BillingRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
function query(req: Request): { filters: SubscriptionFilters; limit: number; cursor?: string } {
  const q = req.query as Record<string, string | string[] | undefined>;
  if (Object.keys(q).some((k) => !new Set(['plan_code', 'status', 'limit', 'cursor']).has(k)) || Object.values(q).some(Array.isArray)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ plan_code: planCodeSchema.optional(), status: lifecycleStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(q);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  return { filters: { plan_code: parsed.data.plan_code, status: parsed.data.status }, limit: parsed.data.limit, cursor: typeof parsed.data.cursor === 'string' ? parsed.data.cursor : undefined };
}
function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.')); }
export function createOperatorBillingRouter(readPort: BillingReadPort = unavailableBillingReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: BillingRouterOptions = {}): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/subscriptions', permission('subscription.read'), async (req, res, next) => { try { const p = query(req); const data = await readPort.listSubscriptions({ filters: p.filters, limit: p.limit, cursor: p.cursor ? decodeCursor(p.cursor, p.filters) : null, requestId: String(res.locals.requestId ?? 'unknown') }); const parsed = z.object({ items: z.array(subscriptionSummarySchema), next_cursor: z.object({ currentPeriodEnd: isoDate, tenantId: uuid }).strict().nullable() }).strict().parse(data); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeSubscriptionCursor(parsed.next_cursor, p.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } });
  router.get('/businesses/:tenantId/entitlements', permission('entitlement.read'), async (req, res, next) => { try { const tenantId = typeof req.params.tenantId === 'string' ? req.params.tenantId : ''; if (!uuid.safeParse(tenantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The tenant identifier is invalid.'); const data = await readPort.getEntitlements({ tenantId, requestId: String(res.locals.requestId ?? 'unknown') }); if (data === null) throw new AppError(404, 'NOT_FOUND', 'The business entitlements were not found.'); res.setHeader('Cache-Control', 'no-store'); res.json(envelope(entitlementDetailSchema.parse(data), String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } });
  return router;
}
