import express, { type RequestHandler } from 'express';
import { AppError } from '../../shared/http/errors.js';
import { unavailableReadPort, type ReadPort } from '../clients/contracts.js';
import { createOverviewController } from './controller.js';

export function createOverviewRouter(
  repository: Pick<ReadPort, 'overview'> = unavailableReadPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: { permissionMiddleware?: (permission: string) => RequestHandler; recentSignupLimit?: number } = {},
) {
  const router = express.Router();
  const permission: RequestHandler = options.permissionMiddleware?.('operator.overview.read')
    ?? ((_req, _res, next) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/overview', permission, createOverviewController(repository, options.recentSignupLimit));
  return router;
}
