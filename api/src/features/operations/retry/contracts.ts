import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";

export const uuid = z.string().uuid();
export const token = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeText = z.string().trim().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
export const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const isoDate = z.string().datetime({ offset: true });

export const retryRequestSchema = z.object({ reason: safeText }).strict();
export const retryResultSchema = z.object({
  command_kind: z.enum(['job.retry', 'notification.retry']),
  resource_id: uuid,
  status: z.literal('accepted'),
  request_id: token,
  accepted_at: isoDate,
}).strict();
export type RetryRequest = z.infer<typeof retryRequestSchema>;
export type RetryResult = z.infer<typeof retryResultSchema>;

export type OperationsRetryCommandPort = {
  retryJob(input: RetryRequest & { jobId: string; operatorSubject: string; idempotencyKey: string; requestId: string }): Promise<RetryResult>;
  retryNotification(input: RetryRequest & { deliveryId: string; operatorSubject: string; idempotencyKey: string; requestId: string }): Promise<RetryResult>;
};

export const unavailableOperationsRetryCommandPort: OperationsRetryCommandPort = {
  retryJob: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); },
  retryNotification: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); },
};
