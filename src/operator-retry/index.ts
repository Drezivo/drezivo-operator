import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const uuid = z.string().uuid();
const token = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeText = z.string().trim().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
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

export const retryPermissions = { job: 'job.retry', notification: 'notification.retry' } as const;
const envelope = (data: RetryResult, requestId: string) => ({ success: true, data, request_id: requestId });
type RouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };

function requestId(res: Response): string { return String(res.locals.requestId ?? 'unknown'); }
function operatorSubject(res: Response): string {
  const subject = res.locals.operatorPrincipal?.clerkUserId;
  if (!subject || !token.safeParse(subject).success) throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  return subject;
}
function key(req: Request): string {
  const value = req.get('Idempotency-Key');
  if (!value || !idempotencyKey.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
  return value.trim();
}
function body(req: Request): RetryRequest {
  const parsed = retryRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The retry request is invalid.');
  return parsed.data;
}
function resourceId(value: string | string[] | undefined): string {
  const id = typeof value === 'string' ? value : '';
  if (!uuid.safeParse(id).success) throw new AppError(400, 'VALIDATION_FAILED', 'The resource identifier is invalid.');
  return id;
}
function result(value: unknown): RetryResult {
  const parsed = retryResultSchema.safeParse(value);
  if (!parsed.success) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service returned an invalid response.');
  return parsed.data;
}
function sendError(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'));
}

/** Route factory for future mounting after the business command contract is approved. */
export function createOperatorRetryRouter(
  commandPort: OperationsRetryCommandPort = unavailableOperationsRetryCommandPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: RouterOptions = {},
): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.post('/jobs/:jobId/retry', permission(retryPermissions.job), async (req, res, next) => {
    try {
      const data = result(await commandPort.retryJob({ ...body(req), jobId: resourceId(req.params.jobId), operatorSubject: operatorSubject(res), idempotencyKey: key(req), requestId: requestId(res) }));
      res.status(202).setHeader('Cache-Control', 'no-store').json(envelope(data, requestId(res)));
    } catch (error) { sendError(next, error); }
  });
  router.post('/notifications/:deliveryId/retry', permission(retryPermissions.notification), async (req, res, next) => {
    try {
      const data = result(await commandPort.retryNotification({ ...body(req), deliveryId: resourceId(req.params.deliveryId), operatorSubject: operatorSubject(res), idempotencyKey: key(req), requestId: requestId(res) }));
      res.status(202).setHeader('Cache-Control', 'no-store').json(envelope(data, requestId(res)));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
