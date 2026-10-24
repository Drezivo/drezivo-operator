import { createOperatorAnalyticsController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import type { SafeOperatorPrincipal } from "../../shared/auth/operator-auth.js";
import { operatorAnalyticsQuery, operatorAnalyticsResponse, unavailableAnalyticsReadPort } from "./contracts.js";
import type { OperatorAnalyticsQuery, OperatorAnalyticsResponse, AnalyticsReadPort } from "./contracts.js";

export type AnalyticsRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');

export function createOperatorAnalyticsRouter(
  readPort: AnalyticsReadPort = unavailableAnalyticsReadPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: AnalyticsRouterOptions = {},
): Router {
  const controller = createOperatorAnalyticsController(readPort, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(forbidden()));
  router.use(authorize);
  router.get('/analytics', permission('platform.analytics.read'), controller.showAnalytics);
  return router;
}
