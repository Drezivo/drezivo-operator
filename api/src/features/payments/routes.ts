import express, { type RequestHandler } from 'express';
import { AppError } from '../../shared/http/errors.js';
import { tenantAdminPermissions } from '../../shared/auth/operator-permission-codes.js';
import { unavailableTenantAdminPort, type TenantAdminPort, type ProofLinkSigner } from '../clients/administration/contracts.js';
import { createPaymentAdministrationController } from './administration-controller.js';

export function createPaymentAdministrationRouter(
  repository: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: { permissionMiddleware?: (permission: string) => RequestHandler; proofLink?: ProofLinkSigner } = {},
) {
  const router = express.Router();
  const controller = createPaymentAdministrationController(repository, authorize, options);
  const permission = options.permissionMiddleware ?? (() => (_req, _res, next) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  router.use('/subscription-payments', authorize);
  router.use('/tenants', authorize);
  router.get('/subscription-payments', read, controller.listPayments);
  for (const decision of ['approve', 'reject'] as const) {
    router.post(`/tenants/:tenantId/subscription-payments/:paymentId/${decision}`, manage, controller.reviewPayment(decision));
  }
  router.get('/tenants/:tenantId/subscription-payments/:paymentId/proof-link', read, controller.proofLink);
  return router;
}
