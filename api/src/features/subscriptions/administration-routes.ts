import express, { type RequestHandler } from 'express';
import { AppError } from '../../shared/http/errors.js';
import { tenantAdminPermissions } from '../../shared/auth/operator-permission-codes.js';
import { unavailableTenantAdminPort, type TenantAdminPort } from '../clients/administration/contracts.js';
import { createSubscriptionAdministrationController } from './administration-controller.js';

export function createSubscriptionAdministrationRouter(
  repository: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: { permissionMiddleware?: (permission: string) => RequestHandler; now?: () => Date } = {},
) {
  const router = express.Router();
  const controller = createSubscriptionAdministrationController(repository, authorize, options);
  const manage: RequestHandler = options.permissionMiddleware?.(tenantAdminPermissions.manage)
    ?? ((_req, _res, next) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use('/tenants', authorize);
  router.post('/tenants/:tenantId/trial', manage, controller.setTrialEnd);
  router.post('/tenants/:tenantId/activate', manage, controller.activateSubscription);
  router.post('/tenants/:tenantId/read-only-extension', manage, controller.extendReadOnly);
  return router;
}
