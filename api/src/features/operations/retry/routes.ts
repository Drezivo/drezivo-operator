import { createOperatorRetryController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { uuid, token, idempotencyKey, retryRequestSchema, retryResultSchema, unavailableOperationsRetryCommandPort } from "./contracts.js";
import type { RetryRequest, RetryResult, OperationsRetryCommandPort } from "./contracts.js";

export const retryPermissions = { job: 'job.retry', notification: 'notification.retry' } as const;
type RouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };

/** Route factory for future mounting after the business command contract is approved. */
export function createOperatorRetryRouter(
  commandPort: OperationsRetryCommandPort = unavailableOperationsRetryCommandPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: RouterOptions = {},
): Router {
  const controller = createOperatorRetryController(commandPort, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.post('/jobs/:jobId/retry', permission(retryPermissions.job), controller.retryJob);
  router.post('/notifications/:deliveryId/retry', permission(retryPermissions.notification), controller.retryNotification);
  return router;
}
