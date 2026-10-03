import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const opaque = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const label = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/);
const roles = ['platform_owner', 'platform_operator', 'support_operator', 'billing_operator', 'read_only_operator'] as const;
const statuses = ['active', 'suspended', 'revoked', 'pending'] as const;

export const operatorRoleSchema = z.enum(roles);
export const operatorStatusSchema = z.enum(statuses);
export const operatorDirectoryItemSchema = z.object({
  operator_id: opaque,
  display_name: label,
  role: operatorRoleSchema,
  status: operatorStatusSchema,
  last_activity_at: iso.nullable(),
  assigned_tenant_count: z.number().int().nonnegative(),
}).strict();
export type OperatorDirectoryItem = z.infer<typeof operatorDirectoryItemSchema>;
export type OperatorDirectoryFilters = { role?: typeof roles[number]; status?: typeof statuses[number] };
export type OperatorDirectoryCursor = { lastActivityAt: string | null; operatorId: string };
export type OperatorDirectoryPort = {
  listOperators(input: { filters: OperatorDirectoryFilters; limit: number; cursor: OperatorDirectoryCursor | null; requestId: string }): Promise<{ items: OperatorDirectoryItem[]; next_cursor: OperatorDirectoryCursor | null }>;
};

export const unavailableOperatorDirectoryPort: OperatorDirectoryPort = {
  listOperators: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator directory service is unavailable.'); },
};

type EncodedCursor = { v: 1; last_activity_at: string | null; operator_id: string; filter_hash: string };
const cursorHash = (filters: OperatorDirectoryFilters) => createHash('sha256').update('drezivo-operator-directory-cursor-v1').update(JSON.stringify({ role: filters.role ?? null, status: filters.status ?? null })).digest('hex');
export function encodeOperatorDirectoryCursor(cursor: OperatorDirectoryCursor, filters: OperatorDirectoryFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, last_activity_at: cursor.lastActivityAt, operator_id: cursor.operatorId, filter_hash: cursorHash(filters) } satisfies EncodedCursor), 'utf8').toString('base64url');
}
function decodeCursor(value: string, filters: OperatorDirectoryFilters): OperatorDirectoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as EncodedCursor;
    if (parsed.v !== 1 || parsed.filter_hash !== cursorHash(filters) || !opaque.safeParse(parsed.operator_id).success || (parsed.last_activity_at !== null && !iso.safeParse(parsed.last_activity_at).success)) throw new Error('invalid');
    if (parsed.last_activity_at && new Date(parsed.last_activity_at).getTime() > Date.now()) throw new Error('future');
    return { lastActivityAt: parsed.last_activity_at, operatorId: parsed.operator_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}

const envelope = (data: unknown, requestId: string) => ({ success: true, data, request_id: requestId });
export const operatorDirectoryPermission = 'operator.directory.read';
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

export function createOperatorDirectoryRouter(port: OperatorDirectoryPort = unavailableOperatorDirectoryPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperatorDirectoryRouterOptions = {}): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/operators', permission(operatorDirectoryPermission), async (req, res, next) => {
    try {
      const query = parseQuery(req);
      const data = await port.listOperators({ filters: query.filters, limit: query.limit, requestId: String(res.locals.requestId ?? 'unknown'), cursor: query.cursor ? decodeCursor(query.cursor, query.filters) : null });
      const parsed = z.object({ items: z.array(operatorDirectoryItemSchema), next_cursor: z.object({ lastActivityAt: iso.nullable(), operatorId: opaque }).strict().nullable() }).strict().parse(data);
      if (hasFutureData(parsed.items, parsed.next_cursor)) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator directory service is unavailable.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(envelope({ items: parsed.items, next_cursor: parsed.next_cursor ? encodeOperatorDirectoryCursor(parsed.next_cursor, query.filters) : null }, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
