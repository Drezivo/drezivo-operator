import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { emptyBusinessUserDirectory, type BusinessUserDirectory } from "../clients/repository/clerk-directory.js";
import { tenantAdminPermissions } from "../../shared/auth/operator-permission-codes.js";
import { uuid, idempotencyKey, reason, profileInputSchema, reasonInputSchema, trialInputSchema, activateInputSchema, readOnlyExtensionInputSchema, noteInputSchema, paymentQueueQuerySchema, unavailable, unavailableTenantAdminPort } from "../clients/administration/contracts.js";
import type { TenantDetail, CommandContext, CommandResult, TenantAdminPort, ProofLinkSigner } from "../clients/administration/contracts.js";

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
function send(res: Response, status: number, data: unknown): void {
  res.status(status).setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: requestId(res) });
}
function forward(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is temporarily unavailable.', { cause: error }));
}



function paymentIdParam(req: Request): string {
  const value = typeof req.params.paymentId === 'string' ? req.params.paymentId : '';
  if (!uuid.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'The payment identifier is invalid.');
  return value;
}

import { createPaymentAdministrationService } from './administration-service.js';

export function createPaymentAdministrationController(
  port: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
) {
  const service = createPaymentAdministrationService(port);
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
    listPayments: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parse(paymentQueueQuerySchema, req.query, 'status must be pending or recent.');
      send(res, 200, { items: await service.listPayments(query.status) });
    } catch (error) { forward(next, error); }
  },
    reviewPayment: (decision: 'approve' | 'reject'): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = tenantIdParam(req);
        const paymentId = paymentIdParam(req);
        const input = parse(reasonInputSchema, req.body, decision === 'reject'
          ? 'Say why the payment was not approved (3 to 500 characters). The business owner sees this.'
          : 'A reason of 3 to 500 characters is required, for example "Reference matched".');
        send(res, 200, await command(await service.reviewPayment(tenantId, paymentId, decision, context(req, res, input.reason))));
      } catch (error) { forward(next, error); }
    },
    proofLink: (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const paymentId = paymentIdParam(req);
      const link = options.proofLink?.(tenantId, paymentId) ?? null;
      if (!link) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Viewing payment proofs is not configured.');
      send(res, 200, link);
    } catch (error) { forward(next, error); }
  }
  };
}
