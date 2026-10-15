import { createHash } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { rolePermissions, operatorRoleSchema } from '../operator-authorization.js';
import { supportGrantProjectionSchema } from '../operator-support/index.js';
export type SessionAuditPort = {
    record(input: {
        subject: string;
        sessionId: string;
        event: 'started' | 'ended' | 'sign_out_requested' | 'revoked' | 'removed';
        requestId: string;
        occurredAt?: string;
    }): Promise<{
        recorded: boolean;
    }>;
    recordDecision(input: {
        subject: string;
        permission: string;
        allowed: boolean;
        requestId: string;
    }): Promise<void>;
    isKnown(subject: string, sessionId: string): Promise<boolean>;
    isEnded(subject: string, sessionId: string): Promise<boolean>;
};
export type GrantListPort = {
    list(input: {
        tenantId?: string;
        limit: number;
        cursor: {
            at: string;
            id: string;
        } | null;
    }): Promise<{
        items: unknown[];
        next_cursor: {
            at: string;
            id: string;
        } | null;
    }>;
};
const grant = supportGrantProjectionSchema.safeExtend({ business_name: z.string().min(1), granted_by: z.string().min(1), status: z.enum(['active', 'scheduled', 'expired', 'revoked']) });
const cursor = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid(), scope: z.string() }).strict();
export function createOperatorConsoleRouter(ports: {
    session?: SessionAuditPort;
    grantList?: GrantListPort;
}, authorize: RequestHandler, permission: (p: string) => RequestHandler) {
    const router = express.Router();
    router.use(authorize);
    router.get('/session', (_req, res) => { const p = res.locals.operatorPrincipal; const role = operatorRoleSchema.safeParse(p?.roles[0]); if (!p || !role.success)
        throw new AppError(403, 'FORBIDDEN', 'Operator access is required.'); res.json({ success: true, data: { operator_id: p.clerkUserId, role: role.data, permissions: rolePermissions[role.data] }, request_id: res.locals.requestId }); });
    router.post('/session/events', async (req, res) => {
        const body = z.object({ event: z.enum(['started', 'ended']) }).strict().safeParse(req.body);
        const key = z.string().regex(/^[A-Za-z0-9_.:-]{16,200}$/).safeParse(req.get('Idempotency-Key'));
        if (!body.success || !key.success)
            throw new AppError(400, 'VALIDATION_FAILED', 'The session event is invalid.');
        const p = res.locals.operatorPrincipal;
        if (!p?.sessionId)
            throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
        if (!ports.session)
            throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Session audit is unavailable.');
        const data = await ports.session.record({ subject: p.clerkUserId, sessionId: p.sessionId, event: body.data.event === 'ended' ? 'sign_out_requested' : 'started', requestId: String(res.locals.requestId) });
        res.json({ success: true, data, request_id: res.locals.requestId });
    });
    router.get('/support-grants', permission('support.activity.read'), async (req, res) => {
        const q = z.object({ tenant_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(2048).optional() }).strict().safeParse(req.query);
        if (!q.success)
            throw new AppError(400, 'VALIDATION_FAILED', 'The query is invalid.');
        const scope = createHash('sha256').update(q.data.tenant_id ?? 'all').digest('hex');
        let after: {
            at: string;
            id: string;
        } | null = null;
        if (q.data.cursor) {
            try {
                const c = cursor.parse(JSON.parse(Buffer.from(q.data.cursor, 'base64url').toString()));
                if (c.scope !== scope)
                    throw new Error();
                after = { at: c.at, id: c.id };
            }
            catch {
                throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.');
            }
        }
        if (!ports.grantList)
            throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Support grants are unavailable.');
        const data = await ports.grantList.list({ tenantId: q.data.tenant_id, limit: q.data.limit, cursor: after });
        res.json({ success: true, data: { items: data.items.map(x => grant.parse(x)), next_cursor: data.next_cursor ? Buffer.from(JSON.stringify({ ...data.next_cursor, scope })).toString('base64url') : null }, request_id: res.locals.requestId });
    });
    return router;
}
