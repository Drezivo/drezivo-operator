import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { emptyBusinessUserDirectory, type BusinessUserDirectory } from "../repository/clerk-directory.js";
import { tenantAdminPermissions } from "../../../shared/auth/operator-permission-codes.js";
import { uuid, idempotencyKey, reason, profileInputSchema, reasonInputSchema, trialInputSchema, activateInputSchema, readOnlyExtensionInputSchema, noteInputSchema, paymentQueueQuerySchema, unavailable, unavailableTenantAdminPort } from "./contracts.js";
import type { TenantDetail, CommandContext, CommandResult, TenantAdminPort, ProofLinkSigner } from "./contracts.js";

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

import { createClientAdministrationService } from './service.js';

export function createClientAdministrationController(
  port: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
) {
  const service = createClientAdministrationService(port);
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
    listPeople: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const people = await service.listPeople();
      const profiles = await directory.lookup(people.map((person) => person.clerk_user_id));
      send(res, 200, { items: people.map((person) => ({ ...person, profile: profiles.get(person.clerk_user_id) ?? null })) });
    } catch (error) { forward(next, error); }
  },
    listTenants: async (_req: Request, res: Response, next: NextFunction) => {
    try { send(res, 200, { items: await service.listTenants() }); } catch (error) { forward(next, error); }
  },
    getTenant: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenant = await service.getTenant(tenantIdParam(req));
      if (!tenant) throw new AppError(404, 'NOT_FOUND', 'The business was not found.');
      send(res, 200, await withProfiles(tenant));
    } catch (error) { forward(next, error); }
  },
    updateProfile: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(profileInputSchema, req.body, 'Provide a valid name or IANA time zone and a reason.');
      const { reason: text, ...change } = input;
      send(res, 200, await command(await service.updateProfile(tenantId, change, context(req, res, text))));
    } catch (error) { forward(next, error); }
  },
    setTenantLocked: (locked: boolean): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = tenantIdParam(req);
        const input = parse(reasonInputSchema, req.body, 'A reason of 3 to 500 characters is required.');
        send(res, 200, await command(await service.setTenantLocked(tenantId, locked, context(req, res, input.reason))));
      } catch (error) { forward(next, error); }
    },
    setMemberSuspended: (suspended: boolean): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = tenantIdParam(req);
        const membershipId = typeof req.params.membershipId === 'string' ? req.params.membershipId : '';
        if (!uuid.safeParse(membershipId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The member identifier is invalid.');
        const input = parse(reasonInputSchema, req.body, 'A reason of 3 to 500 characters is required.');
        send(res, 200, await command(await service.setMemberSuspended(tenantId, membershipId, suspended, context(req, res, input.reason))));
      } catch (error) { forward(next, error); }
    },
    addNote: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(noteInputSchema, req.body, 'A note of 1 to 2000 characters is required.');
      const ctx = context(req, res, 'Operator note');
      const principal = res.locals.operatorPrincipal as { email?: unknown; clerkUserId: string } | undefined;
      const author = typeof principal?.email === 'string' && principal.email ? principal.email : ctx.operatorSubject;
      send(res, 200, await command(await service.addNote(tenantId, input.body, author.slice(0, 120), ctx)));
    } catch (error) { forward(next, error); }
  }
  };
}
