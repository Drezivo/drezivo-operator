import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/http/errors.js';
import { createOverviewService, type OverviewRepository } from './service.js';

export function createOverviewController(repository: OverviewRepository, recentSignupLimit?: number): RequestHandler {
  const load = createOverviewService(repository, recentSignupLimit);
  return async (req, res, next) => {
    try {
      if (!z.object({}).strict().safeParse(req.query).success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
      const principal = res.locals.operatorPrincipal;
      if (!principal) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
      const requestId = String(res.locals.requestId ?? 'unknown');
      const data = await load({ principal, requestId });
      res.setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: requestId });
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.', { cause: error }));
    }
  };
}
