import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/http/errors.js';
import { rolePermissions, operatorRoleSchema } from '../../shared/auth/operator-authorization.js';
import type { SessionAuditPort } from './contracts.js';
import { createSessionService } from './service.js';

export function createSessionController(repository: SessionAuditPort | undefined) {
  const service = createSessionService(repository);
  const show: RequestHandler = (_req, res) => {
    const principal = res.locals.operatorPrincipal;
    const role = operatorRoleSchema.safeParse(principal?.roles[0]);
    if (!principal || !role.success) throw new AppError(403, 'FORBIDDEN', 'Operator access is required.');
    res.json({ success: true, data: { operator_id: principal.clerkUserId, role: role.data, permissions: rolePermissions[role.data] }, request_id: res.locals.requestId });
  };
  const record: RequestHandler = async (req, res) => {
    const body = z.object({ event: z.enum(['started', 'ended']) }).strict().safeParse(req.body);
    const key = z.string().regex(/^[A-Za-z0-9_.:-]{16,200}$/).safeParse(req.get('Idempotency-Key'));
    if (!body.success || !key.success) throw new AppError(400, 'VALIDATION_FAILED', 'The session event is invalid.');
    const principal = res.locals.operatorPrincipal;
    if (!principal?.sessionId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    if (!repository) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Session audit is unavailable.');
    const data = await service.recordEvent({ subject: principal.clerkUserId, sessionId: principal.sessionId, event: body.data.event === 'ended' ? 'sign_out_requested' : 'started', requestId: String(res.locals.requestId) });
    res.json({ success: true, data, request_id: res.locals.requestId });
  };
  return { show, record };
}
