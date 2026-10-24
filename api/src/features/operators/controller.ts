import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { iso, opaque, operatorRoleSchema, operatorStatusSchema, operatorDirectoryItemSchema, unavailableOperatorDirectoryPort } from "./contracts.js";
import type { OperatorDirectoryItem, OperatorDirectoryFilters, OperatorDirectoryCursor, OperatorDirectoryPort } from "./contracts.js";

import { encodeOperatorDirectoryCursor, decodeCursor } from './pagination.js';


const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export type OperatorDirectoryRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };

function parseQuery(req: Request): { filters: OperatorDirectoryFilters; limit: number; cursor?: string } {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(['role', 'status', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some(Array.isArray)) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ role: operatorRoleSchema.optional(), status: operatorStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const { limit, cursor, ...filters } = parsed.data;
  return { filters, limit, cursor };
}
function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator directory service is unavailable.', { cause: error })); }
function hasFutureData(items: OperatorDirectoryItem[], cursor: OperatorDirectoryCursor | null): boolean {
  return items.some((item) => item.last_activity_at !== null && new Date(item.last_activity_at).getTime() > Date.now()) || Boolean(cursor?.lastActivityAt && new Date(cursor.lastActivityAt).getTime() > Date.now());
}



import { createOperatorDirectoryService } from './service.js';

export function createOperatorDirectoryController(port: OperatorDirectoryPort = unavailableOperatorDirectoryPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperatorDirectoryRouterOptions = {}) {
  const service = createOperatorDirectoryService(port);
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    listOperators: async (req, res, next) => {
    try {
      const query = parseQuery(req);
      const data = await service.listOperators({ filters: query.filters, limit: query.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: query.cursor ? decodeCursor(query.cursor, query.filters) : null });
      const parsed = z.object({ items: z.array(operatorDirectoryItemSchema), next_cursor: z.object({ lastActivityAt: iso.nullable(), operatorId: opaque }).strict().nullable() }).strict().parse(data);
      if (hasFutureData(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator directory service is unavailable.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperatorDirectoryCursor(parsed.next_cursor, query.filters) : null }, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  },
  } satisfies Record<string, RequestHandler>;
}
