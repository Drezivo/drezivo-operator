import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, iso, token, jobStatuses, notificationStatuses, jobSchema, notificationSchema, unavailableOperationsPort } from "./contracts.js";
import type { Job, Notification, OperationsFilters, OperationsPort } from "./contracts.js";
import { encodeOperationsCursor, decodeCursor } from './pagination.js';

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export type OperationsRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
function parseQuery(req: Request, kind: 'jobs' | 'notifications'): { filters: OperationsFilters; limit: number; cursor?: string } {
  const q = req.query as Record<string, string | string[] | undefined>;
  const allowed = kind === 'jobs' ? new Set(['tenant_id', 'status', 'event_type', 'available_from', 'available_to', 'limit', 'cursor']) : new Set(['tenant_id', 'status', 'channel', 'accepted_from', 'accepted_to', 'limit', 'cursor']);
  if (Object.keys(q).some((k) => !allowed.has(k)) || Object.values(q).some(Array.isArray)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const schema = kind === 'jobs' ? z.object({ tenant_id: uuid.optional(), status: z.enum(jobStatuses).optional(), event_type: token.optional(), available_from: iso.optional(), available_to: iso.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict() : z.object({ tenant_id: uuid.optional(), status: z.enum(notificationStatuses).optional(), channel: token.optional(), accepted_from: iso.optional(), accepted_to: iso.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict();
  const parsed = schema.safeParse(q); if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const { limit, cursor, ...filters } = parsed.data; const f = filters as OperationsFilters; const range = kind === 'jobs' ? [f.available_from, f.available_to] : [f.accepted_from, f.accepted_to]; if (range.some((x) => x && new Date(x).getTime() > Date.now()) || (range[0] && range[1] && new Date(range[1]).getTime() <= new Date(range[0]).getTime())) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.'); return { filters: f, limit, cursor };
}
function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.', { cause: error })); }
function futureJobs(items: Job[], cursor: { availableAt: string; id: string } | null): boolean {
  return items.some((item) => new Date(item.created_at).getTime() > Date.now())
    || Boolean(cursor && !iso.safeParse(cursor.availableAt).success);
}
function futureNotifications(items: Notification[], cursor: { acceptedAt: string | null; deliveryId: string } | null): boolean {
  return items.some((item) => item.accepted_at !== null && new Date(item.accepted_at).getTime() > Date.now())
    || Boolean(cursor?.acceptedAt && new Date(cursor.acceptedAt).getTime() > Date.now());
}


import { createOperationsService } from './service.js';

export function createOperatorOperationsController(port: OperationsPort = unavailableOperationsPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperationsRouterOptions = {}) {
  const service = createOperationsService(port);
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    listJobs: async (req, res, next) => { try { const q = parseQuery(req, 'jobs'); const principal = res.locals.operatorPrincipal; if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'); const data = await service.listJobs({ principal, filters: q.filters, limit: q.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: q.cursor ? decodeCursor(q.cursor, q.filters) as { availableAt: string; id: string } : null }); const parsed = z.object({ items: z.array(jobSchema), next_cursor: z.object({ availableAt: iso, id: uuid }).strict().nullable() }).strict().parse(data); if (futureJobs(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperationsCursor(parsed.next_cursor, q.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } },
    listNotifications: async (req, res, next) => { try { const q = parseQuery(req, 'notifications'); const principal = res.locals.operatorPrincipal; if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'); const data = await service.listNotifications({ principal, filters: q.filters, limit: q.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: q.cursor ? decodeCursor(q.cursor, q.filters, true) as { acceptedAt: string | null; deliveryId: string } : null }); const parsed = z.object({ items: z.array(notificationSchema), next_cursor: z.object({ acceptedAt: iso.nullable(), deliveryId: uuid }).strict().nullable() }).strict().parse(data); if (futureNotifications(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperationsCursor(parsed.next_cursor, q.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } },
  } satisfies Record<string, RequestHandler>;
}
