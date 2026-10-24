import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import type { SafeOperatorPrincipal } from "../../shared/auth/operator-auth.js";

export const uuid = z.string().uuid();
export const iso = z.string().datetime({ offset: true });
export const token = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const safeError = z.string().max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
export const jobStatuses = ['pending', 'leased', 'succeeded', 'dead'] as const;
export const notificationStatuses = ['queued', 'provider_accepted', 'delivered', 'bounced', 'failed'] as const;

export const jobSchema = z.object({ job_id: uuid, tenant_id: uuid, event_type: token, status: z.enum(jobStatuses), attempts: z.number().int().nonnegative(), max_attempts: z.number().int().positive(), available_at: iso, lease_until: iso.nullable(), completed_at: iso.nullable(), safe_last_error: safeError.nullable(), can_retry: z.boolean().optional(), created_at: iso }).strict();
export const notificationSchema = z.object({ delivery_id: uuid, tenant_id: uuid, outbox_id: uuid, channel: token, template_version: token, status: z.enum(notificationStatuses), provider_message_id: token.nullable(), can_retry: z.boolean().optional(), accepted_at: iso.nullable(), delivered_at: iso.nullable() }).strict();
export type Job = z.infer<typeof jobSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type OperationsFilters = { tenant_id?: string; status?: string; event_type?: string; channel?: string; available_from?: string; available_to?: string; accepted_from?: string; accepted_to?: string };
export type OperationsPort = {
  listJobs(input: { principal: SafeOperatorPrincipal; filters: Omit<OperationsFilters, 'channel' | 'accepted_from' | 'accepted_to'>; limit: number; cursor: { availableAt: string; id: string } | null; requestId: string }): Promise<{ items: Job[]; next_cursor: { availableAt: string; id: string } | null }>;
  listNotifications(input: { principal: SafeOperatorPrincipal; filters: Omit<OperationsFilters, 'event_type' | 'available_from' | 'available_to'>; limit: number; cursor: { acceptedAt: string | null; deliveryId: string } | null; requestId: string }): Promise<{ items: Notification[]; next_cursor: { acceptedAt: string | null; deliveryId: string } | null }>;
};
export const unavailableOperationsPort: OperationsPort = { listJobs: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); }, listNotifications: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations read service is unavailable.'); } };
