import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { SafeOperatorPrincipal } from '../operator-auth.js';

const statuses = ['active', 'restricted', 'cancelled'] as const;
const statusSchema = z.enum(statuses);
const isoDate = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const overviewCount = z.number().int().nonnegative().safe();
const overviewText = (max: number) => z.string().trim().min(1).max(max);

export const operatorOverviewSchema = z.object({
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

const subscriptionSummarySchema = z.object({ plan_code: z.string().min(1), status: z.string().min(1), current_period_end: isoDate, cancel_at_period_end: z.boolean() }).strict();
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
  subscription: z.object({ plan_code: z.string().min(1), status: z.string().min(1), current_period_start: isoDate, current_period_end: isoDate, trial_ends_at: isoDate.nullable(), grace_ends_at: isoDate.nullable(), cancel_at_period_end: z.boolean() }).strict().nullable(),
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

type CursorPayload = { v: 1; created_at: string; tenant_id: string; filter_hash: string };
const cursorSecret = 'drezivo-operator-read-cursor-v1';
function filterHash(filters: BusinessListFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({ q: filters.q ?? null, status: [...filters.status], plan_code: filters.plan_code ?? null, sort: filters.sort })).digest('hex');
}
export function encodeBusinessCursor(cursor: { createdAt: string; tenantId: string }, filters: BusinessListFilters): string {
  const payload: CursorPayload = { v: 1, created_at: cursor.createdAt, tenant_id: cursor.tenantId, filter_hash: filterHash(filters) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
function decodeBusinessCursor(value: string, filters: BusinessListFilters): { createdAt: string; tenantId: string } {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.created_at).success || !uuid.safeParse(payload.tenant_id).success) throw new Error('invalid');
    return { createdAt: payload.created_at, tenantId: payload.tenant_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
const permission = 'operator.overview.read';
export type ReadRouterOptions = { planCodes?: readonly string[]; recentSignupLimit?: number; permissionMiddleware?: (permission: string) => RequestHandler };

function parseQuery(req: Request, options: ReadRouterOptions, route: 'overview' | 'list') {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(route === 'overview' ? [] : ['cursor', 'limit', 'q', 'plan_code', 'sort', 'status']);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const rawStatuses = query.status === undefined ? [] : Array.isArray(query.status) ? query.status : [query.status];
  const planCodes = options.planCodes ?? ['starter', 'professional', 'business'];
  const result = z.object({
    cursor: z.string().min(1).max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(80).optional(), plan_code: z.string().refine((value) => planCodes.includes(value), 'Unknown plan code').optional(), sort: z.literal('created_at_desc').default('created_at_desc'),
  }).safeParse({ cursor: query.cursor, limit: query.limit, q: query.q, plan_code: query.plan_code, sort: query.sort });
  if (!result.success || rawStatuses.some((value) => !statusSchema.safeParse(value).success)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const filters: BusinessListFilters = { q: result.data.q, plan_code: result.data.plan_code, sort: 'created_at_desc', status: rawStatuses as BusinessListFilters['status'] };
  return { result: result.data, filters };
}

function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.', { cause: error })); }
export function createOperatorReadRouter(readPort: ReadPort = unavailableReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: ReadRouterOptions = {}): Router {
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/overview', permissionMiddleware('operator.overview.read'), async (req, res, next) => {
    try {
      const { result } = parseQuery(req, options, 'overview');
      const principal = res.locals.operatorPrincipal;
      const requestId = String(res.locals.requestId ?? 'unknown');
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const data = operatorOverviewSchema.parse(await readPort.overview({ principal, requestId }));
      const cap = Math.max(1, Math.min(options.recentSignupLimit ?? 50, 100));
      data.recent_businesses = data.recent_businesses.slice(0, cap);
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope(data, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  router.get('/businesses', permissionMiddleware('business.summary.read'), async (req, res, next) => {
    try {
      const { result, filters } = parseQuery(req, options, 'list');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const data = await readPort.listBusinesses({ principal, filters, limit: result.limit, cursor: result.cursor ? decodeBusinessCursor(result.cursor, filters) : null, requestId: String(res.locals.requestId ?? 'unknown') });
      const parsed = z.object({ items: z.array(businessSummarySchema), next_cursor: z.object({ createdAt: isoDate, tenantId: uuid }).strict().nullable() }).strict().parse(data);
      const now = Date.now();
      if (parsed.items.some((item) => new Date(item.created_at).getTime() > now || new Date(item.updated_at).getTime() > now)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      if (parsed.next_cursor && new Date(parsed.next_cursor.createdAt).getTime() > now) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      const response = { items: parsed.items, next_cursor: parsed.next_cursor ? encodeBusinessCursor(parsed.next_cursor, filters) : null };
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope(response, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  router.get('/businesses/:tenantId', permissionMiddleware('business.summary.read'), async (req, res, next) => {
    try {
      const tenantId = typeof req.params.tenantId === 'string' ? req.params.tenantId : '';
      if (!uuid.safeParse(tenantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The tenant identifier is invalid.');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const data = await readPort.getBusiness({ principal, tenantId, requestId: String(res.locals.requestId ?? 'unknown') });
      if (data === null) throw new AppError(404, 'NOT_FOUND', 'The business was not found.');
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope(businessDetailSchema.parse(data), String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  return router;
}

export { permission };
