import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { uuid, permissionCode, idempotencyKey, supportGrantCreateInputSchema, supportGrantProjectionSchema, unavailableSupportGrantCommandPort } from "./contracts.js";
import type { SupportGrantCreateInput, SupportGrantProjection, SupportGrantCommandPort } from "./contracts.js";
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
  try { return await call(); } catch (error) {
    if (error instanceof AppError && error.code === 'STATE_CONFLICT') throw new AppError(409, 'STATE_CONFLICT', 'The resource state or intent has changed. Refresh and try again.');
    if (error instanceof AppError && error.code === 'NOT_FOUND') throw new AppError(404, 'NOT_FOUND', 'The resource was not found.');
    if (error instanceof AppError && error.code === 'VALIDATION_FAILED') throw new AppError(400, 'VALIDATION_FAILED', 'The operator command is invalid.');
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.');
  }
}
function sendError(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.', { cause: error }));
}



import { createSupportGrantCommandService } from './service.js';

export function createOperatorSupportGrantController(
  commandPort: SupportGrantCommandPort = unavailableSupportGrantCommandPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: SupportGrantRouterOptions = {},
) {
  const service = createSupportGrantCommandService(commandPort);
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  return {
    createGrant: async (req, res, next) => {
    try {
      const input = { ...body(req), operatorSubject: operatorSubject(res), idempotencyKey: headerValue(req, 'Idempotency-Key'), requestId: String(res.locals.requestId ?? 'unknown') };
      const result = projection(await commandCall(() => service.createSupportGrant(input)));
      res.status(201).setHeader('Cache-Control', 'no-store').json(envelope(result, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  },
    revokeGrant: async (req, res, next) => {
    try {
      const grantId = typeof req.params.grantId === 'string' ? req.params.grantId : '';
      if (!uuid.safeParse(grantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The support grant identifier is invalid.');
      const input = { grantId, operatorSubject: operatorSubject(res), idempotencyKey: headerValue(req, 'Idempotency-Key'), requestId: String(res.locals.requestId ?? 'unknown') };
      const result = projection(await commandCall(() => service.revokeSupportGrant(input)));
      res.setHeader('Cache-Control', 'no-store').json(envelope(result, String(res.locals.requestId ?? 'unknown')));
    } catch (error) { sendError(next, error); }
  },
  } satisfies Record<string, RequestHandler>;
}
