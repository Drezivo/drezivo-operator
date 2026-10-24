import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { statusSchema, isoDate, uuid, operatorOverviewSchema, businessSummarySchema, businessDetailSchema, unavailableReadPort } from "./contracts.js";
import type { BusinessListFilters, ReadPort } from "./contracts.js";
import { encodeBusinessCursor, decodeBusinessCursor } from './pagination.js';


const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
const permission = 'operator.overview.read';
export type ReadRouterOptions = { planCodes?: readonly string[]; recentSignupLimit?: number; permissionMiddleware?: (permission: string) => RequestHandler };

function parseQuery(req: Request, options: ReadRouterOptions, route: 'overview' | 'list') {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(route === 'overview' ? [] : ['cursor', 'limit', 'q', 'plan_code', 'sort', 'status']);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const rawStatuses = query.status === undefined ? [] : Array.isArray(query.status) ? query.status : [query.status];
  const planCodes = options.planCodes ?? ['free', 'starter', 'standard', 'professional', 'business'];
  const result = z.object({
    cursor: z.string().min(1).max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(80).optional(), plan_code: z.string().refine((value) => planCodes.includes(value), 'Unknown plan code').optional(), sort: z.literal('created_at_desc').default('created_at_desc'),
  }).safeParse({ cursor: query.cursor, limit: query.limit, q: query.q, plan_code: query.plan_code, sort: query.sort });
  if (!result.success || rawStatuses.some((value) => !statusSchema.safeParse(value).success)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const filters: BusinessListFilters = { q: result.data.q, plan_code: result.data.plan_code, sort: 'created_at_desc', status: rawStatuses as BusinessListFilters['status'] };
  return { result: result.data, filters };
}

function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.', { cause: error })); }


export { permission };

import { createReadService } from './service.js';

export function createOperatorReadController(readPort: ReadPort = unavailableReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: ReadRouterOptions = {}) {
  const service = createReadService(readPort);
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    listBusinesses: async (req, res, next) => {
    try {
      const { result, filters } = parseQuery(req, options, 'list');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const data = await service.listBusinesses({ principal, filters, limit: result.limit, cursor: result.cursor ? decodeBusinessCursor(result.cursor, filters) : null, requestId: String(res.locals.requestId ?? 'unknown') });
      const parsed = z.object({ items: z.array(businessSummarySchema), next_cursor: z.object({ createdAt: isoDate, tenantId: uuid }).strict().nullable() }).strict().parse(data);
      const now = Date.now();
      if (parsed.items.some((item) => new Date(item.created_at).getTime() > now || new Date(item.updated_at).getTime() > now)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      if (parsed.next_cursor && new Date(parsed.next_cursor.createdAt).getTime() > now) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      const response = { items: parsed.items, next_cursor: parsed.next_cursor ? encodeBusinessCursor(parsed.next_cursor, filters) : null };
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope(response, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  },
    getBusiness: async (req, res, next) => {
    try {
      const tenantId = typeof req.params.tenantId === 'string' ? req.params.tenantId : '';
      if (!uuid.safeParse(tenantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The tenant identifier is invalid.');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const data = await service.getBusiness({ principal, tenantId, requestId: String(res.locals.requestId ?? 'unknown') });
      if (data === null) throw new AppError(404, 'NOT_FOUND', 'The business was not found.');
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope(businessDetailSchema.parse(data), String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  }
  } satisfies Record<string, RequestHandler>;
}
