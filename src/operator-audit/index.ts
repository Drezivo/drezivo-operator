import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const actorKinds = ['staff', 'operator', 'system'] as const;
const outcomes = ['succeeded', 'rejected', 'failed'] as const;
const token = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const opaqueKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeString = z.string().max(500).regex(/^[^\u0000-\u001f\u007f]*$/);

export const auditEventSchema = z.object({
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
export type AuditFilters = { tenant_id?: string; actor_kind?: (typeof actorKinds)[number]; entity_type?: string; action?: string; outcome?: (typeof outcomes)[number]; occurred_from?: string; occurred_to?: string };
export type AuditCursor = { occurredAt: string; eventId: string };
export type AuditPort = {
  listAuditEvents(input: { filters: AuditFilters; limit: number; cursor: AuditCursor | null }): Promise<{ items: AuditEvent[]; next_cursor: AuditCursor | null }>;
};

export const unavailableAuditPort: AuditPort = {
  listAuditEvents: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.'); },
};

type CursorPayload = { v: 1; occurred_at: string; event_id: string; filter_hash: string };
const cursorSecret = 'drezivo-operator-audit-cursor-v1';
function filterHash(filters: AuditFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({ tenant_id: filters.tenant_id ?? null, actor_kind: filters.actor_kind ?? null, entity_type: filters.entity_type ?? null, action: filters.action ?? null, outcome: filters.outcome ?? null, occurred_from: filters.occurred_from ?? null, occurred_to: filters.occurred_to ?? null })).digest('hex');
}
export function encodeAuditCursor(cursor: AuditCursor, filters: AuditFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, occurred_at: cursor.occurredAt, event_id: cursor.eventId, filter_hash: filterHash(filters) } satisfies CursorPayload), 'utf8').toString('base64url');
}
function decodeAuditCursor(value: string, filters: AuditFilters): AuditCursor {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.occurred_at).success || !uuid.safeParse(payload.event_id).success) throw new Error('invalid');
    return { occurredAt: payload.occurred_at, eventId: payload.event_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export const auditPermission = 'audit.read';
type AuditRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler; actionCodes?: readonly string[]; entityTypes?: readonly string[] };

function parseQuery(req: Request, options: AuditRouterOptions): { filters: AuditFilters; limit: number; cursor?: string } {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(['tenant_id', 'actor_kind', 'entity_type', 'action', 'outcome', 'occurred_from', 'occurred_to', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some((value) => Array.isArray(value))) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ tenant_id: uuid.optional(), actor_kind: z.enum(actorKinds).optional(), entity_type: token.optional(), action: token.optional(), outcome: z.enum(outcomes).optional(), occurred_from: isoDate.optional(), occurred_to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const { limit, cursor, ...filters } = parsed.data;
  if ((filters.action && options.actionCodes && !options.actionCodes.includes(filters.action)) || (filters.entity_type && options.entityTypes && !options.entityTypes.includes(filters.entity_type)) || (filters.occurred_from && filters.occurred_to && new Date(filters.occurred_to).getTime() <= new Date(filters.occurred_from).getTime()) || (filters.occurred_from && new Date(filters.occurred_from).getTime() > Date.now()) || (filters.occurred_to && new Date(filters.occurred_to).getTime() > Date.now())) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  return { filters, limit, cursor };
}

function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.')); }
export function createOperatorAuditRouter(auditPort: AuditPort = unavailableAuditPort, authorize: RequestHandler = (_req, _res, next) => next(), options: AuditRouterOptions = {}): Router {
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/audit-events', permissionMiddleware(auditPermission), async (req, res, next) => {
    try {
      const { filters, limit, cursor } = parseQuery(req, options);
      const data = await auditPort.listAuditEvents({ filters, limit, cursor: cursor ? decodeAuditCursor(cursor, filters) : null });
      const parsed = z.object({ items: z.array(auditEventSchema), next_cursor: z.object({ occurredAt: isoDate, eventId: uuid }).strict().nullable() }).strict().parse(data);
      if (parsed.items.some((item) => new Date(item.occurred_at).getTime() > Date.now()) || (parsed.next_cursor && new Date(parsed.next_cursor.occurredAt).getTime() > Date.now())) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.');
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeAuditCursor(parsed.next_cursor, filters) : null }, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
