import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/http/errors.js';
import type { GrantListPort } from './contracts.js';
import { createGrantListService } from './grants-service.js';

export function createGrantListController(repository: GrantListPort | undefined): RequestHandler {
  const list = createGrantListService(repository);
  return async (req, res) => {
    const query = z.object({ tenant_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(2048).optional() }).strict().safeParse(req.query);
    if (!query.success) throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
    const data = await list(query.data);
    res.json({ success: true, data, request_id: res.locals.requestId });
  };
}
