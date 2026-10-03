import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { SafeOperatorPrincipal } from '../operator-auth.js';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const token = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const safeError = z.string().max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const jobStatuses = ['pending', 'leased', 'succeeded', 'dead'] as const;
const notificationStatuses = ['queued', 'provider_accepted', 'delivered', 'bounced', 'failed'] as const;

export const jobSchema = z.object({ job_id: uuid, tenant_id: uuid, event_type: token, status: z.enum(jobStatuses), attempts: z.number().int().nonnegative(), max_attempts: z.number().int().positive(), available_at: iso, lease_until: iso.nullable(), completed_at: iso.nullable(), safe_last_error: safeError.nullable(), created_at: iso }).strict();
export const notificationSchema = z.object({ delivery_id: uuid, tenant_id: uuid, outbox_id: uuid, channel: token, template_version: token, status: z.enum(notificationStatuses), provider_message_id: token.nullable(), accepted_at: iso.nullable(), delivered_at: iso.nullable() }).strict();
export type Job = z.infer<typeof jobSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type OperationsFilters = { tenant_id?: string; status?: string; event_type?: string; channel?: string; available_from?: string; available_to?: string; accepted_from?: string; accepted_to?: string };
export type OperationsPort = {
  listJobs(input: { principal: SafeOperatorPrincipal; filters: Omit<OperationsFilters, 'channel' | 'accepted_from' | 'accepted_to'>; limit: number; cursor: { availableAt: string; id: string } | null; requestId: string }): Promise<{ items: Job[]; next_cursor: { availableAt: string; id: string } | null }>;
  listNotifications(input: { principal: SafeOperatorPrincipal; filters: Omit<OperationsFilters, 'event_type' | 'available_from' | 'available_to'>; limit: number; cursor: { acceptedAt: string | null; deliveryId: string } | null; requestId: string }): Promise<{ items: Notification[]; next_cursor: { acceptedAt: string | null; deliveryId: string } | null }>;
};
export const unavailableOperationsPort: OperationsPort = { listJobs: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); }, listNotifications: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); } };

type Cursor = { v: 1; at: string | null; id: string; filter_hash: string };
const hash = (filters: OperationsFilters) => createHash('sha256').update('drezivo-operator-operations-cursor-v1').update(JSON.stringify(filters)).digest('hex');
export function encodeOperationsCursor(cursor: { availableAt: string; id: string } | { acceptedAt: string | null; deliveryId: string }, filters: OperationsFilters): string { const at = 'availableAt' in cursor ? cursor.availableAt : cursor.acceptedAt; const id = 'availableAt' in cursor ? cursor.id : cursor.deliveryId; return Buffer.from(JSON.stringify({ v: 1, at, id, filter_hash: hash(filters) } satisfies Cursor)).toString('base64url'); }
function decodeCursor(value: string, filters: OperationsFilters, notifications = false): { availableAt: string; id: string } | { acceptedAt: string | null; deliveryId: string } { try { const p = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor; if (p.v !== 1 || p.filter_hash !== hash(filters) || !uuid.safeParse(p.id).success || (p.at !== null && (!iso.safeParse(p.at).success || new Date(p.at).getTime() > Date.now()))) throw new Error(); return notifications ? { acceptedAt: p.at, deliveryId: p.id } : p.at === null ? (() => { throw new Error(); })() : { availableAt: p.at, id: p.id }; } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); } }
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
  return items.some((item) => new Date(item.available_at).getTime() > Date.now())
    || Boolean(cursor && new Date(cursor.availableAt).getTime() > Date.now());
}
function futureNotifications(items: Notification[], cursor: { acceptedAt: string | null; deliveryId: string } | null): boolean {
  return items.some((item) => item.accepted_at !== null && new Date(item.accepted_at).getTime() > Date.now())
    || Boolean(cursor?.acceptedAt && new Date(cursor.acceptedAt).getTime() > Date.now());
}
export function createOperatorOperationsRouter(port: OperationsPort = unavailableOperationsPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperationsRouterOptions = {}): Router {
  const router = express.Router(); const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'))); router.use(authorize);
  router.get('/jobs', permission('job.read'), async (req, res, next) => { try { const q = parseQuery(req, 'jobs'); const principal = res.locals.operatorPrincipal; if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'); const data = await port.listJobs({ principal, filters: q.filters, limit: q.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: q.cursor ? decodeCursor(q.cursor, q.filters) as { availableAt: string; id: string } : null }); const parsed = z.object({ items: z.array(jobSchema), next_cursor: z.object({ availableAt: iso, id: uuid }).strict().nullable() }).strict().parse(data); if (futureJobs(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperationsCursor(parsed.next_cursor, q.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } });
  router.get('/notifications', permission('notification.read'), async (req, res, next) => { try { const q = parseQuery(req, 'notifications'); const principal = res.locals.operatorPrincipal; if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'); const data = await port.listNotifications({ principal, filters: q.filters, limit: q.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: q.cursor ? decodeCursor(q.cursor, q.filters, true) as { acceptedAt: string | null; deliveryId: string } : null }); const parsed = z.object({ items: z.array(notificationSchema), next_cursor: z.object({ acceptedAt: iso.nullable(), deliveryId: uuid }).strict().nullable() }).strict().parse(data); if (futureNotifications(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); res.setHeader('Cache-Control', 'no-store'); res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperationsCursor(parsed.next_cursor, q.filters) : null }, String(res.locals.requestId ?? 'unknown'))); } catch (e) { sendError(next, e); } });
  return router;
}
