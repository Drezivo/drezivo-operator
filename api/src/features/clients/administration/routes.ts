import { createClientAdministrationController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { emptyBusinessUserDirectory, type BusinessUserDirectory } from "../repository/clerk-directory.js";
import { tenantAdminPermissions } from "../../../shared/auth/operator-permission-codes.js";
import { uuid, idempotencyKey, reason, profileInputSchema, reasonInputSchema, trialInputSchema, activateInputSchema, readOnlyExtensionInputSchema, noteInputSchema, paymentQueueQuerySchema, unavailable, unavailableTenantAdminPort } from "./contracts.js";
import type { TenantDetail, CommandContext, CommandResult, TenantAdminPort, ProofLinkSigner } from "./contracts.js";

/** Trial and paid periods are bounded so a typo cannot grant years of free service. */
export const MAX_TRIAL_DAYS_AHEAD = 90;
export const MAX_PERIOD_DAYS_AHEAD = 400;

type Options = {
  permissionMiddleware?: (permission: string) => RequestHandler;
  now?: () => Date;
  directory?: BusinessUserDirectory;
  proofLink?: ProofLinkSigner;
};

export function createOperatorTenantAdminRouter(
  port: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
): Router {
  const controller = createClientAdministrationController(port, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  router.use('/tenants', authorize);
  router.use('/people', authorize);

  router.get('/people', read, controller.listPeople);

  router.get('/tenants', read, controller.listTenants);

  router.get('/tenants/:tenantId', read, controller.getTenant);

  router.post('/tenants/:tenantId/profile', manage, controller.updateProfile);

  for (const [path, locked] of [['lock', true], ['unlock', false]] as const) {
    router.post(`/tenants/:tenantId/${path}`, manage, controller.setTenantLocked(locked));
  }

  for (const [path, suspended] of [['suspend', true], ['reactivate', false]] as const) {
    router.post(`/tenants/:tenantId/members/:membershipId/${path}`, manage, controller.setMemberSuspended(suspended));
  }

  router.post('/tenants/:tenantId/notes', manage, controller.addNote);

  return router;
}
