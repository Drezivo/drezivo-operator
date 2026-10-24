import { createOperatorOperationsController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, iso, token, jobStatuses, notificationStatuses, jobSchema, notificationSchema, unavailableOperationsPort } from "./contracts.js";
import type { Job, Notification, OperationsFilters, OperationsPort } from "./contracts.js";
export { encodeOperationsCursor } from './pagination.js';

export type OperationsRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
export function createOperatorOperationsRouter(port: OperationsPort = unavailableOperationsPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperationsRouterOptions = {}): Router {
  const controller = createOperatorOperationsController(port, authorize, options);
  const router = express.Router(); const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'))); router.use(authorize);
  router.get('/jobs', permission('job.read'), controller.listJobs);
  router.get('/notifications', permission('notification.read'), controller.listNotifications);
  return router;
}
