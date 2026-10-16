import express, { type RequestHandler } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { SessionAuditPort } from './index.js';
const eventSchema = z.object({ type: z.enum(['session.ended', 'session.revoked', 'session.removed']), timestamp: z.number().int().positive(), data: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), user_id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }) });
export function createSessionWebhookRouter(session: SessionAuditPort | undefined, signingSecret: string | undefined, rateLimit: RequestHandler) {
    const router = express.Router();
    router.post('/webhooks/operator-clerk', rateLimit, express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
        if (!session || !signingSecret)
            throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Session audit is unavailable.');
        let verified: unknown;
        try {
            verified = await verifyWebhook(req, { signingSecret });
        }
        catch {
            throw new AppError(401, 'UNAUTHENTICATED', 'Webhook verification failed.');
        }
        const parsed = eventSchema.safeParse(verified);
        if (!parsed.success || parsed.data.timestamp > Date.now() + 300000)
            throw new AppError(400, 'VALIDATION_FAILED', 'The session event is invalid.');
        const event = parsed.data;
        // A dedicated Clerk signature plus an earlier verified operator session establishes attribution.
        // Unrelated identities in the same provider instance are never classified as operators.
        if (await session.isKnown(event.data.user_id, event.data.id))
            await session.record({ subject: event.data.user_id, sessionId: event.data.id, event: event.type === 'session.ended' ? 'ended' : event.type === 'session.revoked' ? 'revoked' : 'removed', requestId: String(res.locals.requestId), occurredAt: new Date(event.timestamp).toISOString() });
        res.status(200).json({ success: true, data: { accepted: true }, request_id: res.locals.requestId });
    });
    return router;
}
