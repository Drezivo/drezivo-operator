import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { emptyBusinessUserDirectory, type BusinessUserDirectory } from "../clients/repository/clerk-directory.js";
import { tenantAdminPermissions } from "../../shared/auth/operator-permission-codes.js";
import { uuid, idempotencyKey, reason, profileInputSchema, reasonInputSchema, trialInputSchema, activateInputSchema, readOnlyExtensionInputSchema, noteInputSchema, paymentQueueQuerySchema, unavailable, unavailableTenantAdminPort } from "../clients/administration/contracts.js";
import type { TenantDetail, CommandContext, CommandResult, TenantAdminPort, ProofLinkSigner } from "../clients/administration/contracts.js";

/** Trial and paid periods are bounded so a typo cannot grant years of free service. */
export const MAX_TRIAL_DAYS_AHEAD = 90;
export const MAX_PERIOD_DAYS_AHEAD = 400;

type Options = {
  permissionMiddleware?: (permission: string) => RequestHandler;
  now?: () => Date;
  directory?: BusinessUserDirectory;
  proofLink?: ProofLinkSigner;
};

function requestId(res: Response): string { return String(res.locals.requestId ?? 'unknown'); }
function tenantIdParam(req: Request): string {
  const value = typeof req.params.tenantId === 'string' ? req.params.tenantId : '';
  if (!uuid.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'The business identifier is invalid.');
  return value;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', message);
  return parsed.data;
}
function context(req: Request, res: Response, reasonText: string): CommandContext {
  const key = req.get('Idempotency-Key');
  if (!key || !idempotencyKey.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
  const subject = res.locals.operatorPrincipal?.clerkUserId;
  if (typeof subject !== 'string' || subject.length === 0) throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  return { operatorSubject: subject, idempotencyKey: key.trim(), requestId: requestId(res), reason: reasonText, requestFingerprint: createHash('sha256').update(JSON.stringify(req.body, Object.keys(req.body as object).sort())).digest('hex') };
}
function futureWithin(value: string, days: number, now: Date, field: string): Date {
  const date = new Date(value);
  const max = new Date(now.getTime() + days * 86_400_000);
  if (date.getTime() <= now.getTime() || date.getTime() > max.getTime()) {
    throw new AppError(400, 'VALIDATION_FAILED', `${field} must be in the future and at most ${days} days ahead.`);
  }
  return date;
}
function send(res: Response, status: number, data: unknown): void {
  res.status(status).setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: requestId(res) });
}
function forward(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is temporarily unavailable.', { cause: error }));
}

import { createSubscriptionAdministrationService } from './administration-service.js';

export function createSubscriptionAdministrationController(
  port: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
) {
  const service = createSubscriptionAdministrationService(port);
  const now = options.now ?? (() => new Date());
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const directory = options.directory ?? emptyBusinessUserDirectory;
  const withProfiles = async (tenant: TenantDetail): Promise<TenantDetail> => {
    const profiles = await directory.lookup(tenant.members.map((member) => member.clerk_user_id));
    return { ...tenant, recent_audit: [], members: tenant.members.map((member) => ({ ...member, profile: profiles.get(member.clerk_user_id) ?? null })) };
  };
  const command = async (result: CommandResult) => ({ ...result, tenant: await withProfiles(result.tenant) });
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  return {
    setTrialEnd: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(trialInputSchema, req.body, 'Provide trial_ends_at as an ISO date-time and a reason.');
      const end = futureWithin(input.trial_ends_at, MAX_TRIAL_DAYS_AHEAD, now(), 'The trial end');
      send(res, 200, await command(await service.setTrialEnd(tenantId, end, context(req, res, input.reason))));
    } catch (error) { forward(next, error); }
  },
    activateSubscription: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(activateInputSchema, req.body, 'Provide current_period_end as an ISO date-time and a reason.');
      const end = futureWithin(input.current_period_end, MAX_PERIOD_DAYS_AHEAD, now(), 'The paid period end');
      send(res, 200, await command(await service.activateSubscription(tenantId, end, context(req, res, input.reason))));
    } catch (error) { forward(next, error); }
  },
    extendReadOnly: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(readOnlyExtensionInputSchema, req.body, 'Provide read_only_until as an ISO date-time and a reason.');
      const until = futureWithin(input.read_only_until, MAX_TRIAL_DAYS_AHEAD, now(), 'The view-only end');
      send(res, 200, await command(await service.extendReadOnly(tenantId, until, context(req, res, input.reason))));
    } catch (error) { forward(next, error); }
  }
  };
}
