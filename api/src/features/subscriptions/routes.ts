import { createOperatorBillingController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, planCodeSchema, lifecycleStatusSchema, subscriptionSummarySchema, entitlementDetailSchema, unavailableBillingReadPort } from "./contracts.js";
import type { SubscriptionFilters, BillingReadPort } from "./contracts.js";
export { encodeSubscriptionCursor } from './pagination.js';

export type BillingRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
export function createOperatorBillingRouter(readPort: BillingReadPort = unavailableBillingReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: BillingRouterOptions = {}): Router {
  const controller = createOperatorBillingController(readPort, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/subscriptions', permission('subscription.read'), controller.listSubscriptions);
  return router;
}
