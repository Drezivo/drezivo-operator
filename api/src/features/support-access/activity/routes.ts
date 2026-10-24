import { createOperatorSupportActivityController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, actorKinds, outcomes, token, supportActivitySchema, unavailableSupportActivityPort } from "./contracts.js";
import type { SupportActivityFilters, SupportActivityCursor, SupportActivityPort } from "./contracts.js";
export { encodeSupportActivityCursor } from './pagination.js';

export const supportActivityPermission = 'support.activity.read';
type RouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler; actionCodes?: readonly string[]; entityTypes?: readonly string[] };
export function createOperatorSupportActivityRouter(port: SupportActivityPort = unavailableSupportActivityPort, authorize: RequestHandler = (_req, _res, next) => next(), options: RouterOptions = {}): Router {
  const controller = createOperatorSupportActivityController(port, authorize, options);
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/support-activity', permissionMiddleware(supportActivityPermission), controller.listActivity);
  return router;
}
