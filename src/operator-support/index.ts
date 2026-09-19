import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const permissionCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
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
}).strict();
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

export const supportGrantPermissions = {
  create: 'support.grant.create',
  revoke: 'support.grant.revoke',
} as const;
const envelope = (data: SupportGrantProjection, requestId: string) => ({ success: true, data, request_id: requestId });

type SupportGrantRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
function headerValue(req: Request, name: string): string {
  const value = req.get(name);
  if (!value || !idempotencyKey.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
  return value.trim();
}
function body(req: Request): SupportGrantCreateInput {
  const parsed = supportGrantCreateInputSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The support grant request is invalid.');
  return parsed.data;
}
function projection(value: unknown): SupportGrantProjection {
  const parsed = supportGrantProjectionSchema.safeParse(value);
  if (!parsed.success) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service returned an invalid response.');
  return parsed.data;
}
function operatorSubject(res: Response): string {
  const subject = res.locals.operatorPrincipal?.clerkUserId;
  if (!subject || !permissionCode.safeParse(subject).success) {
    throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  }
  return subject;
}
async function commandCall<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); }
}
function sendError(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'));
}

export function createOperatorSupportGrantRouter(
  commandPort: SupportGrantCommandPort = unavailableSupportGrantCommandPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: SupportGrantRouterOptions = {},
): Router {
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.post('/support-grants', permissionMiddleware(supportGrantPermissions.create), async (req, res, next) => {
    try {
      const input = { ...body(req), operatorSubject: operatorSubject(res), idempotencyKey: headerValue(req, 'Idempotency-Key'), requestId: String(res.locals.requestId ?? 'unknown') };
      const result = projection(await commandCall(() => commandPort.createSupportGrant(input)));
      res.status(201).setHeader('Cache-Control', 'no-store').json(envelope(result, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  router.post('/support-grants/:grantId/revoke', permissionMiddleware(supportGrantPermissions.revoke), async (req, res, next) => {
    try {
      const grantId = typeof req.params.grantId === 'string' ? req.params.grantId : '';
      if (!uuid.safeParse(grantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The support grant identifier is invalid.');
      const input = { grantId, operatorSubject: operatorSubject(res), idempotencyKey: headerValue(req, 'Idempotency-Key'), requestId: String(res.locals.requestId ?? 'unknown') };
      const result = projection(await commandCall(() => commandPort.revokeSupportGrant(input)));
      res.setHeader('Cache-Control', 'no-store').json(envelope(result, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
