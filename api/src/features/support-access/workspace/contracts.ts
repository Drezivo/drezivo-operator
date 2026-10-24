import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";

export const workspaceResourceSchema = z.enum(['clothing', 'variants', 'assets', 'categories', 'branches', 'reservations', 'reservation-lines', 'fittings', 'fitting-lines', 'customers', 'memberships', 'payments', 'charges', 'deposits', 'refunds', 'maintenance', 'allocations', 'custody', 'disruptions', 'storefronts', 'files', 'jobs']);
export const uuid = z.string().uuid();
export const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
export const reason = text(500).min(3);
export const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const key = z.string().regex(/^[A-Za-z0-9_.:-]{16,200}$/);
export const scope = z.object({ tenantId: uuid, grantId: uuid });
export const resourceParams = scope.extend({ resource: workspaceResourceSchema });
export const itemParams = resourceParams.extend({ itemId: uuid });
export const workspaceOpenSchema = z.object({ mode: z.enum(['read', 'repair']), reason, minutes: z.number().int().min(5).max(120) }).strict();
export const workspaceDeleteSchema = z.object({ fingerprint, confirm_name: text(200), confirm_id: uuid, acknowledge: z.literal('PERMANENTLY DELETE'), reason }).strict();
export const patches = {
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
export const unavailable: WorkspacePort = { async execute() { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Workspace support is unavailable.'); } };
