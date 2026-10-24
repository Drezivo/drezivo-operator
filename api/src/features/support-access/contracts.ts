import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";

export type GrantListPort = {
  list(input: { tenantId?: string; limit: number; cursor: { at: string; id: string } | null }): Promise<{
    items: unknown[];
    next_cursor: { at: string; id: string } | null;
  }>;
};

export const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
export const permissionCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
export const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeText = z.string().trim().min(1).max(1000).regex(/^[^\u0000-\u001f\u007f]*$/);

export const supportGrantCreateInputSchema = z.object({
  tenant_id: uuid,
  permission_codes: z.array(permissionCode).min(1).max(50),
  reason: safeText,
  starts_at: isoDate,
  expires_at: isoDate,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.permission_codes).size !== value.permission_codes.length) {
    ctx.addIssue({ code: 'custom', path: ['permission_codes'], message: 'Permission codes must be unique.' });
  }
  if (new Date(value.expires_at).getTime() <= new Date(value.starts_at).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['expires_at'], message: 'The expiry must be after the start.' });
  }
});

export const supportGrantProjectionSchema = z.object({
  grant_id: uuid,
  tenant_id: uuid,
  operator_subject: permissionCode,
  permission_codes: z.array(permissionCode).min(1).max(50),
  starts_at: isoDate,
  expires_at: isoDate,
  revoked_at: isoDate.nullable(),
  created_at: isoDate,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.permission_codes).size !== value.permission_codes.length) {
    ctx.addIssue({ code: 'custom', path: ['permission_codes'], message: 'Permission codes must be unique.' });
  }
});
export type SupportGrantCreateInput = z.infer<typeof supportGrantCreateInputSchema>;
export type SupportGrantProjection = z.infer<typeof supportGrantProjectionSchema>;

export type SupportGrantCommandPort = {
  createSupportGrant(input: SupportGrantCreateInput & { operatorSubject: string; idempotencyKey: string; requestId: string }): Promise<SupportGrantProjection>;
  revokeSupportGrant(input: { grantId: string; operatorSubject: string; idempotencyKey: string; requestId: string }): Promise<SupportGrantProjection>;
};

export const unavailableSupportGrantCommandPort: SupportGrantCommandPort = {
  createSupportGrant: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); },
  revokeSupportGrant: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); },
};
