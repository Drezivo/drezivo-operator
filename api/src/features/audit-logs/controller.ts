import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, actorKinds, platformBillingActions, outcomes, token, opaqueKey, auditEventSchema, unavailableAuditPort } from "./contracts.js";
import type { AuditFilters, AuditCursor, AuditPort } from "./contracts.js";
import { encodeAuditCursor, decodeAuditCursor } from './pagination.js';


const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
type AuditRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler; actionCodes?: readonly string[]; entityTypes?: readonly string[] };

function parseQuery(req: Request, options: AuditRouterOptions): { filters: AuditFilters; limit: number; cursor?: string } {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(['tenant_id', 'actor_key', 'actor_kind', 'entity_type', 'action', 'outcome', 'occurred_from', 'occurred_to', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some((value) => Array.isArray(value))) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ tenant_id: uuid.optional(), actor_key: opaqueKey.optional(), actor_kind: z.enum(actorKinds).optional(), entity_type: token.optional(), action: token.optional(), outcome: z.enum(outcomes).optional(), occurred_from: isoDate.optional(), occurred_to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const { limit, cursor, ...filters } = parsed.data;
  if ((filters.action && options.actionCodes && !options.actionCodes.includes(filters.action)) || (filters.entity_type && options.entityTypes && !options.entityTypes.includes(filters.entity_type)) || (filters.occurred_from && filters.occurred_to && new Date(filters.occurred_to).getTime() <= new Date(filters.occurred_from).getTime()) || (filters.occurred_from && new Date(filters.occurred_from).getTime() > Date.now()) || (filters.occurred_to && new Date(filters.occurred_to).getTime() > Date.now())) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  return { filters, limit, cursor };
}

function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.', { cause: error })); }


import { createAuditService } from './service.js';

export function createOperatorAuditController(auditPort: AuditPort = unavailableAuditPort, authorize: RequestHandler = (_req, _res, next) => next(), options: AuditRouterOptions = {}) {
  const service = createAuditService(auditPort);
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    listAuditEvents: async (req, res, next) => {
    try {
      const { filters, limit, cursor } = parseQuery(req, options);
      const data = await service.listAuditEvents({ filters, limit, cursor: cursor ? decodeAuditCursor(cursor, filters) : null, requestId: String(res.locals.requestId ?? 'unknown') });
      const parsed = z.object({ items: z.array(auditEventSchema), next_cursor: z.object({ occurredAt: isoDate, eventId: uuid }).strict().nullable() }).strict().parse(data);
      if (parsed.items.some((item) => (item.actor_kind !== 'operator' && !platformBillingActions.has(item.action)) || new Date(item.occurred_at).getTime() > Date.now()) || (parsed.next_cursor && new Date(parsed.next_cursor.occurredAt).getTime() > Date.now())) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.');
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeAuditCursor(parsed.next_cursor, filters) : null }, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  },
  } satisfies Record<string, RequestHandler>;
}
