import { createOperatorReadController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { statusSchema, isoDate, uuid, operatorOverviewSchema, businessSummarySchema, businessDetailSchema, unavailableReadPort } from "./contracts.js";
import type { BusinessListFilters, ReadPort } from "./contracts.js";
export { encodeBusinessCursor } from './pagination.js';

const permission = 'operator.overview.read';
export type ReadRouterOptions = { planCodes?: readonly string[]; recentSignupLimit?: number; permissionMiddleware?: (permission: string) => RequestHandler };
export function createOperatorReadRouter(readPort: ReadPort = unavailableReadPort, authorize: RequestHandler = (_req, _res, next) => next(), options: ReadRouterOptions = {}): Router {
  const controller = createOperatorReadController(readPort, authorize, options);
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/businesses', permissionMiddleware('business.summary.read'), controller.listBusinesses);
  router.get('/businesses/:tenantId', permissionMiddleware('business.summary.read'), controller.getBusiness);
  return router;
}

export { permission };
