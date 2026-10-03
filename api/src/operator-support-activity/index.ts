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

export const supportActivitySchema = z.object({
  event_id: uuid,
  tenant_id: uuid,
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
export type SupportActivity = z.infer<typeof supportActivitySchema>;
export type SupportActivityFilters = {
  tenant_id?: string; support_grant_id?: string; actor_kind?: (typeof actorKinds)[number];
  action?: string; entity_type?: string; outcome?: (typeof outcomes)[number];
  occurred_from?: string; occurred_to?: string;
};
export type SupportActivityCursor = { occurredAt: string; eventId: string };
export type SupportActivityPort = {
  listSupportActivity(input: { filters: SupportActivityFilters; limit: number; cursor: SupportActivityCursor | null; requestId: string }): Promise<{ items: SupportActivity[]; next_cursor: SupportActivityCursor | null }>;
};

export const unavailableSupportActivityPort: SupportActivityPort = {
  listSupportActivity: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The support activity read service is unavailable.'); },
};

const cursorSecret = 'drezivo-operator-support-activity-cursor-v1';
type CursorPayload = { v: 1; occurred_at: string; event_id: string; filter_hash: string };
function filterHash(filters: SupportActivityFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({
    tenant_id: filters.tenant_id ?? null, support_grant_id: filters.support_grant_id ?? null,
    actor_kind: filters.actor_kind ?? null, action: filters.action ?? null,
    entity_type: filters.entity_type ?? null, outcome: filters.outcome ?? null,
    occurred_from: filters.occurred_from ?? null, occurred_to: filters.occurred_to ?? null,
  })).digest('hex');
}
export function encodeSupportActivityCursor(cursor: SupportActivityCursor, filters: SupportActivityFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, occurred_at: cursor.occurredAt, event_id: cursor.eventId, filter_hash: filterHash(filters) } satisfies CursorPayload), 'utf8').toString('base64url');
}
function decodeCursor(value: string, filters: SupportActivityFilters): SupportActivityCursor {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.occurred_at).success || new Date(payload.occurred_at).getTime() > Date.now() || !uuid.safeParse(payload.event_id).success) throw new Error('invalid');
    return { occurredAt: payload.occurred_at, eventId: payload.event_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export const supportActivityPermission = 'support.activity.read';
type RouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler; actionCodes?: readonly string[]; entityTypes?: readonly string[] };

function parseQuery(req: Request, options: RouterOptions): { filters: SupportActivityFilters; limit: number; cursor?: string } {
  const query = req.query as Record<string, string | string[] | undefined>;
  const allowed = new Set(['tenant_id', 'support_grant_id', 'actor_kind', 'action', 'entity_type', 'outcome', 'occurred_from', 'occurred_to', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some((value) => Array.isArray(value))) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const parsed = z.object({ tenant_id: uuid.optional(), support_grant_id: uuid.optional(), actor_kind: z.enum(actorKinds).optional(), action: token.optional(), entity_type: token.optional(), outcome: z.enum(outcomes).optional(), occurred_from: isoDate.optional(), occurred_to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional() }).strict().safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  const { limit, cursor, ...filters } = parsed.data;
  if ((filters.action && options.actionCodes && !options.actionCodes.includes(filters.action)) || (filters.entity_type && options.entityTypes && !options.entityTypes.includes(filters.entity_type)) || (filters.occurred_from && filters.occurred_to && new Date(filters.occurred_to).getTime() <= new Date(filters.occurred_from).getTime()) || (filters.occurred_from && new Date(filters.occurred_from).getTime() > Date.now()) || (filters.occurred_to && new Date(filters.occurred_to).getTime() > Date.now())) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
  return { filters, limit, cursor };
}
function sendError(next: NextFunction, error: unknown): void { next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The support activity read service is unavailable.', { cause: error })); }
export function createOperatorSupportActivityRouter(port: SupportActivityPort = unavailableSupportActivityPort, authorize: RequestHandler = (_req, _res, next) => next(), options: RouterOptions = {}): Router {
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/support-activity', permissionMiddleware(supportActivityPermission), async (req, res, next) => {
    try {
      const { filters, limit, cursor } = parseQuery(req, options);
      const data = await port.listSupportActivity({ filters, limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: cursor ? decodeCursor(cursor, filters) : null });
      const parsed = z.object({ items: z.array(supportActivitySchema), next_cursor: z.object({ occurredAt: isoDate, eventId: uuid }).strict().nullable() }).strict().parse(data);
      if (parsed.items.some((item) => new Date(item.occurred_at).getTime() > Date.now()) || (parsed.next_cursor && new Date(parsed.next_cursor.occurredAt).getTime() > Date.now())) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The support activity read service is unavailable.');
      res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeSupportActivityCursor(parsed.next_cursor, filters) : null }, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
