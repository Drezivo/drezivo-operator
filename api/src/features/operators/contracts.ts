import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";

const uuid = z.string().uuid();
export const iso = z.string().datetime({ offset: true });
export const opaque = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
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
  assigned_tenant_count: z.number().int().nonnegative().nullable(),
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
