import type { RequestHandler } from 'express';
import { AppError } from '../../shared/http/errors.js';
import { entitlementDetailSchema, uuid } from '../subscriptions/contracts.js';
import { createAssignedPlansService, type AssignedPlansRepository } from './service.js';

export function createAssignedPlansController(repository: AssignedPlansRepository): RequestHandler {
  const load = createAssignedPlansService(repository);
  return async (req, res, next) => {
    try {
      const tenantId = typeof req.params.tenantId === 'string' ? req.params.tenantId : '';
      if (!uuid.safeParse(tenantId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The tenant identifier is invalid.');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const requestId = String(res.locals.requestId ?? 'unknown');
      const data = await load({ principal, tenantId, requestId });
      if (data === null) throw new AppError(404, 'NOT_FOUND', 'The business entitlements were not found.');
      res.setHeader('Cache-Control', 'no-store').json({ success: true, data: entitlementDetailSchema.parse(data), request_id: requestId });
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.', { cause: error }));
    }
  };
}
