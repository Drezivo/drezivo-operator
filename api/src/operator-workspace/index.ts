import express, { type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

export const workspaceResourceSchema = z.enum(['clothing', 'variants', 'assets', 'categories', 'branches', 'reservations', 'reservation-lines', 'fittings', 'fitting-lines', 'customers', 'memberships', 'payments', 'charges', 'deposits', 'refunds', 'maintenance', 'allocations', 'custody', 'disruptions', 'storefronts', 'files', 'jobs']);
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
const reason = text(500).min(3);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9_.:-]{16,200}$/);
const scope = z.object({ tenantId: uuid, grantId: uuid });
const resourceParams = scope.extend({ resource: workspaceResourceSchema });
const itemParams = resourceParams.extend({ itemId: uuid });
export const workspaceOpenSchema = z.object({ mode: z.enum(['read', 'repair']), reason, minutes: z.number().int().min(5).max(120) }).strict();
export const workspaceDeleteSchema = z.object({ fingerprint, confirm_name: text(200), confirm_id: uuid, acknowledge: z.literal('PERMANENTLY DELETE'), reason }).strict();
const patches = {
  clothing: z.object({ name: text(200).optional(), code: text(120).optional(), description: text(5000).nullable().optional(), subcategory: text(120).nullable().optional() }).strict(),
  variants: z.object({ sku: text(120).optional(), size_label: text(40).nullable().optional(), color_label: text(80).nullable().optional() }).strict(),
  assets: z.object({ asset_code: text(120).optional() }).strict(),
  categories: z.object({ name: text(120).optional(), display_order: z.number().int().min(0).max(100000).optional() }).strict(),
  branches: z.object({ name: text(200).optional(), code: text(120).optional() }).strict(),
};
const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const workspaceListSchema = z.object({ resource: workspaceResourceSchema, columns: z.array(z.string()), editable: z.array(z.string()), deletable: z.boolean(), items: z.array(z.record(z.string(), value)).max(25), next_cursor: uuid.nullable() }).strict();
export const workspaceDetailSchema = z.object({ id: uuid, fingerprint, data: z.record(z.string(), value), editable: z.array(z.string()) }).strict();
export const workspacePreviewSchema = z.object({ id: uuid, name: z.string(), code: z.string(), fingerprint, variants: z.number().int().nonnegative(), assets: z.number().int().nonnegative(), images: z.number().int().nonnegative(), blockers: z.record(z.string(), z.number().int().nonnegative()), can_delete: z.boolean() }).strict();
export const workspaceAccessSchema = z.object({ grant_id: uuid, tenant_id: uuid, mode: z.enum(['read', 'repair']), operator_subject: z.string(), expires_at: z.string().datetime({ offset: true }) }).strict();
export type WorkspaceOperation = 'open' | 'close' | 'status' | 'list' | 'detail' | 'delete-preview' | 'correct' | 'delete';
export type WorkspacePort = { execute(input: { operation: WorkspaceOperation; subject: string; tenantId: string; grantId?: string; idempotencyKey?: string; requestId: string; input: Record<string, unknown> }): Promise<unknown> };
const unavailable: WorkspacePort = { async execute() { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Workspace support is unavailable.'); } };
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(400, 'VALIDATION_FAILED', 'The workspace request is invalid.');
  return result.data;
}
function subject(res: Response): string {
  const principal = res.locals.operatorPrincipal;
  if (!principal || principal.roles.length !== 1 || principal.roles[0] !== 'platform_owner') throw new AppError(403, 'FORBIDDEN', 'Superadmin access is required.');
  return principal.clerkUserId as string;
}
export function createWorkspaceRouter(port: WorkspacePort = unavailable, authorize: RequestHandler, permission: (code: string) => RequestHandler) {
  const router = express.Router();
  router.use('/tenants/:tenantId/workspace', authorize, (_req, res, next) => { subject(res); next(); });
  router.post('/tenants/:tenantId/workspace', permission('workspace.access'), async (req, res) => {
    const { tenantId } = parse(z.object({ tenantId: uuid }), req.params);
    const input = parse(workspaceOpenSchema, req.body);
    const data = workspaceAccessSchema.parse(await port.execute({ operation: 'open', subject: subject(res), tenantId, idempotencyKey: parse(key, req.get('Idempotency-Key')), requestId: String(res.locals.requestId), input }));
    res.status(201).json({ success: true, data, request_id: res.locals.requestId });
  });
  router.get('/tenants/:tenantId/workspace/:grantId', permission('workspace.read'), async (req, res) => {
    const params = parse(scope, req.params); parse(z.object({}).strict(), req.query);
    const data = workspaceAccessSchema.parse(await port.execute({ operation: 'status', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: {} }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.post('/tenants/:tenantId/workspace/:grantId/close', permission('workspace.access'), async (req, res) => {
    const params = parse(scope, req.params); parse(z.object({}).strict(), req.body);
    const data = z.object({ grant_id: uuid, closed: z.literal(true) }).strict().parse(await port.execute({ operation: 'close', subject: subject(res), ...params, idempotencyKey: parse(key, req.get('Idempotency-Key')), requestId: String(res.locals.requestId), input: {} }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.get('/tenants/:tenantId/workspace/:grantId/records/:resource', permission('workspace.read'), async (req, res) => {
    const { resource, ...params } = parse(resourceParams, req.params);
    const query = parse(z.object({ after: uuid.optional(), q: text(120).optional() }).strict(), req.query);
    const data = workspaceListSchema.parse(await port.execute({ operation: 'list', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource, ...query } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.get('/tenants/:tenantId/workspace/:grantId/records/:resource/:itemId', permission('workspace.read'), async (req, res) => {
    const { resource, itemId, ...params } = parse(itemParams, req.params); parse(z.object({}).strict(), req.query);
    const data = workspaceDetailSchema.parse(await port.execute({ operation: 'detail', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource, id: itemId } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.get('/tenants/:tenantId/workspace/:grantId/clothing/:itemId/delete-preview', permission('workspace.read'), async (req, res) => {
    const { itemId, ...params } = parse(scope.extend({ itemId: uuid }), req.params); parse(z.object({}).strict(), req.query);
    const data = workspacePreviewSchema.parse(await port.execute({ operation: 'delete-preview', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource: 'clothing', id: itemId } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.post('/tenants/:tenantId/workspace/:grantId/records/:resource/:itemId/correct', permission('workspace.repair'), async (req, res) => {
    const { resource, itemId, ...params } = parse(itemParams, req.params);
    const body = parse(z.object({ fingerprint, reason, changes: z.unknown() }).strict(), req.body);
    const patch = patches[resource as keyof typeof patches];
    if (!patch) throw new AppError(400, 'VALIDATION_FAILED', 'This record must be changed through its business workflow.');
    const parsedChanges = patch.safeParse(body.changes);
    if (!parsedChanges.success) throw new AppError(400, 'VALIDATION_FAILED', 'The correction is invalid.');
    const changes = parsedChanges.data;
    if (!Object.keys(changes).length) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a correction.');
    const data = z.object({ id: uuid, corrected: z.literal(true) }).strict().parse(await port.execute({ operation: 'correct', subject: subject(res), ...params, requestId: String(res.locals.requestId), idempotencyKey: parse(key, req.get('Idempotency-Key')), input: { resource, id: itemId, ...body, changes } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  router.post('/tenants/:tenantId/workspace/:grantId/clothing/:itemId/delete', permission('workspace.repair'), async (req, res) => {
    const { itemId, ...params } = parse(scope.extend({ itemId: uuid }), req.params);
    const body = parse(workspaceDeleteSchema, req.body);
    if (body.confirm_id !== itemId) throw new AppError(400, 'VALIDATION_FAILED', 'The confirmed item must match the selected clothing.');
    const data = z.object({ id: uuid, deleted: z.literal(true), variants: z.number(), assets: z.number(), images: z.number() }).strict().parse(await port.execute({ operation: 'delete', subject: subject(res), ...params, requestId: String(res.locals.requestId), idempotencyKey: parse(key, req.get('Idempotency-Key')), input: { resource: 'clothing', id: itemId, ...body } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  });
  return router;
}
