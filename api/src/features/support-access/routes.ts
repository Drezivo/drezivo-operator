import { createOperatorSupportGrantController } from './controller.js';
import { createGrantListController } from './grants-controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { uuid, permissionCode, idempotencyKey, supportGrantCreateInputSchema, supportGrantProjectionSchema, unavailableSupportGrantCommandPort } from "./contracts.js";
import type { SupportGrantCreateInput, SupportGrantProjection, SupportGrantCommandPort, GrantListPort } from "./contracts.js";

export const supportGrantPermissions = {
  create: 'support.grant.create',
  revoke: 'support.grant.revoke',
} as const;

type SupportGrantRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };

export function createOperatorSupportGrantRouter(
  commandPort: SupportGrantCommandPort = unavailableSupportGrantCommandPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: SupportGrantRouterOptions & { grantList?: GrantListPort } = {},
): Router {
  const controller = createOperatorSupportGrantController(commandPort, authorize, options);
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/support-grants', permissionMiddleware('support.activity.read'), createGrantListController(options.grantList));
  router.post('/support-grants', permissionMiddleware(supportGrantPermissions.create), controller.createGrant);
  router.post('/support-grants/:grantId/revoke', permissionMiddleware(supportGrantPermissions.revoke), controller.revokeGrant);
  return router;
}
