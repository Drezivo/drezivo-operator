import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, planCodeSchema, lifecycleStatusSchema, subscriptionSummarySchema, entitlementDetailSchema, unavailableBillingReadPort } from "./contracts.js";
import type { SubscriptionFilters, BillingReadPort } from "./contracts.js";
import { encodeSubscriptionCursor, decodeCursor } from './pagination.js';

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export type BillingRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
function query(req: Request): { filters: SubscriptionFilters; limit: number; cursor?: string } {
  const q = req.query as Record<string, string | string[] | undefined>;
  if (Object.keys(q).some((k) => !new Set(['plan_code', 'status', 'limit', 'cursor']).has(k)) || Object.values(q).some(Array.isArray)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ plan_code: planCodeSchema.optional(), status: lifecycleStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(q);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  return { filters: { plan_code: parsed.data.plan_code, status: parsed.data.status }, limit: parsed.data.limit, cursor: typeof parsed.data.cursor === 'string' ? parsed.data.cursor : undefined };
}
function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.', { cause: error })); }


import { createBillingReadService } from './service.js';

export function createOperatorBillingController(readPort: BillingReadPort = unavailableBillingReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: BillingRouterOptions = {}) {
  const service = createBillingReadService(readPort);
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    listSubscriptions: async (req, res, next) => { try { const p = query(req); const principal = res.locals.operatorPrincipal; if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'); const data = await service.listSubscriptions({ principal, filters: p.filters, limit: p.limit, cursor: p.cursor ? decodeCursor(p.cursor, p.filters) : null, requestId: String(res.locals.requestId ?? 'unknown') }); const parsed = z.object({ items: z.array(subscriptionSummarySchema), next_cursor: z.object({ currentPeriodEnd: isoDate.nullable(), tenantId: uuid }).strict().nullable() }).strict().parse(data); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeSubscriptionCursor(parsed.next_cursor, p.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } }
  } satisfies Record<string, RequestHandler>;
}
