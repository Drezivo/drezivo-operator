import type { RequestHandler } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { z } from 'zod';
import { AppError } from '../../shared/http/errors.js';
import type { SessionAuditPort } from './contracts.js';
import { createSessionService } from './service.js';

const eventSchema = z.object({
  type: z.enum(['session.ended', 'session.revoked', 'session.removed']),
  timestamp: z.number().int().positive(),
  data: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    user_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  }),
});

export function createSessionWebhookController(repository: SessionAuditPort | undefined, signingSecret: string | undefined): RequestHandler {
  const service = createSessionService(repository);
  return async (req, res) => {
    if (!repository || !signingSecret) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Session audit is unavailable.');
    let verified: unknown;
    try {
      verified = await verifyWebhook(req, { signingSecret });
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Webhook verification failed.');
    }
    const parsed = eventSchema.safeParse(verified);
    if (!parsed.success || parsed.data.timestamp > Date.now() + 300000) throw new AppError(400, 'VALIDATION_FAILED', 'The session event is invalid.');
    const event = parsed.data;
    if (await service.isKnown(event.data.user_id, event.data.id)) {
      await service.recordWebhookEvent({
        subject: event.data.user_id,
        sessionId: event.data.id,
        event: event.type === 'session.ended' ? 'ended' : event.type === 'session.revoked' ? 'revoked' : 'removed',
        requestId: String(res.locals.requestId),
        occurredAt: new Date(event.timestamp).toISOString(),
      });
    }
    res.status(200).json({ success: true, data: { accepted: true }, request_id: res.locals.requestId });
  };
}
