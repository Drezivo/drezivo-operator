import express, { type RequestHandler } from 'express';
import { AppError } from '../../shared/http/errors.js';
import { unavailableBillingReadPort, type BillingReadPort } from '../subscriptions/contracts.js';
import { createAssignedPlansController } from './controller.js';

export function createAssignedPlansRouter(
  repository: Pick<BillingReadPort, 'getEntitlements'> = unavailableBillingReadPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: { permissionMiddleware?: (permission: string) => RequestHandler } = {},
) {
  const router = express.Router();
  const permission: RequestHandler = options.permissionMiddleware?.('entitlement.read')
    ?? ((_req, _res, next) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/businesses/:tenantId/entitlements', permission, createAssignedPlansController(repository));
  return router;
}
