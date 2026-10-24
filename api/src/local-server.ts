/** Isolated Docker development entrypoint. Never used by npm start or deployment. */
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import { config } from './config/index.js';
import { createApp } from './app.js';
import { createConsoleDbAdapter } from './infrastructure/db/console-ports.js';
import { createTenantAdminDbAdapter } from './features/clients/repository/admin.js';
import { createPlatformPaymentsDbAdapter } from './features/payment-methods/repository/postgres.js';
import { rolePermissions, authorizationContractVersion, operatorRoleSchema, type AuthorizationPort } from './shared/auth/operator-authorization.js';
import { AppError } from './shared/http/errors.js';
import { errorHandler, requestId, noStore } from './shared/http/middleware.js';
import { createRateLimitMiddleware } from './shared/http/rate-limit.js';
if (process.env.NODE_ENV !== 'development' || process.env.CLERK_SECRET_KEY || process.env.OPERATOR_TENANT_ADMIN_DATABASE_URL || process.env.INTERNAL_SERVICE_BASE_URL)
    throw new Error('Local entrypoint refuses hosted configuration.');
const secrets = z.object({ databasePassword: z.string(), runtimePassword: z.string().min(32), signingSecret: z.string().min(32) }).parse(JSON.parse(readFileSync('/run/secrets/credentials', 'utf8')));
const connectionString = `postgres://drezivo_app:${encodeURIComponent(secrets.runtimePassword)}@db:5432/operator_local`;
const ports = createConsoleDbAdapter({ connectionString, synthetic: true });
const tenant = createTenantAdminDbAdapter({ connectionString });
const payments = createPlatformPaymentsDbAdapter({ connectionString });
const tokenSchema = z.object({ sub: z.string(), role: operatorRoleSchema, sid: z.string().uuid(), exp: z.number() }).strict();
const profiles = [{ id: 'user_local_founder', role: 'platform_owner' as const, label: 'You (Superadmin)' }, { id: 'user_local_ryanny', role: 'platform_owner' as const, label: 'Ryanny (Superadmin)' }];
const sign = (value: string) => createHmac('sha256', secrets.signingSecret).update(value).digest('base64url');
const authenticate: RequestHandler = async (req, res, next) => {
    try {
        const token = req.get('Authorization')?.replace(/^Bearer /, '');
        if (!token)
            throw new Error();
        const [body, signature, extra] = token.split('.');
        if (!body || !signature || extra)
            throw new Error();
        const expected = Buffer.from(sign(body)), actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
            throw new Error();
        const p = tokenSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
        if (p.exp <= Date.now() || !profiles.some(x => x.id === p.sub && x.role === p.role))
            throw new Error();
        if (await ports.session.isEnded(p.sub, p.sid) && !(req.method === 'POST' && req.originalUrl === '/api/v1/session/events' && (req.body as {
            event?: unknown;
        })?.event === 'ended'))
            throw new Error();
        res.locals.operatorPrincipal = { clerkUserId: p.sub, operatorOrganizationId: 'org_local_operator', roles: [p.role], requestId: String(res.locals.requestId), sessionId: p.sid };
        next();
    }
    catch {
        next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    }
};
const authorization: AuthorizationPort = { version: authorizationContractVersion, resolveMembership: async () => ({ active: false, roles: [] }), resolvePermission: async ({ principal, permission }) => principal.roles.some(role => rolePermissions[role].includes(permission)), resolveTenantScope: async () => false };
ports.directory = { async listOperators({ filters, limit, cursor }) { const rows = profiles.filter(p => (!filters.role || p.role === filters.role) && (!filters.status || filters.status === 'active')).map(p => ({ operator_id: p.id, display_name: p.label, role: p.role, status: 'active' as const, last_activity_at: null, assigned_tenant_count: 0 })).sort((a, b) => a.operator_id.localeCompare(b.operator_id)).filter(x => !cursor || x.operator_id > cursor.operatorId); const items = rows.slice(0, limit), last = items.at(-1); return { items, next_cursor: rows.length > limit && last ? { lastActivityAt: null, operatorId: last.operator_id } : null }; } };
const localPorts = { ...ports, session: { ...ports.session, record: (input: Parameters<typeof ports.session.record>[0]) => ports.session.record({ ...input, event: input.event === 'sign_out_requested' ? 'ended' : input.event }) } };
const app = express();
app.disable('x-powered-by');
app.use(requestId, noStore);
app.use((req, res, next) => { const origin = req.get('Origin'); if (origin && !['http://localhost:3010', 'http://127.0.0.1:3010'].includes(origin)) {
    res.sendStatus(403);
    return;
} if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
} if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Request-ID');
    res.sendStatus(204);
    return;
} next(); });
app.use('/local', createRateLimitMiddleware(), express.json({ limit: '4kb' }));
app.get('/local/profiles', (_req, res) => res.json({ success: true, data: { profiles }, request_id: res.locals.requestId }));
app.post('/local/login', async (req, res) => {
    const input = z.object({ profile: z.string().max(100) }).strict().safeParse(req.body);
    const key = z.string().uuid().safeParse(req.get('Idempotency-Key'));
    const profile = input.success ? profiles.find(x => x.id === input.data.profile) : undefined;
    if (!profile || !key.success)
        throw new AppError(400, 'VALIDATION_FAILED', 'The local sign-in request is invalid.');
    const hash = createHash('sha256').update(profile.id + key.data).digest('hex');
    const sid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const payload = { sub: profile.id, role: profile.role, sid, exp: Date.now() + 12 * 3600000 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    await ports.session.record({ subject: profile.id, sessionId: sid, event: 'started', requestId: String(res.locals.requestId) });
    res.json({ success: true, data: { token: `${body}.${sign(body)}`, profile, session_id: sid }, request_id: res.locals.requestId });
});
app.use(createApp({
  protectedRateLimit: createRateLimitMiddleware(),
  authorizationPort: authorization,
  tenantAdminPort: tenant,
  platformPaymentsPort: payments,
  consolePorts: localPorts,
  authentication: authenticate,
  corsOrigins: config.OPERATOR_CORS_ORIGINS,
  clerkWebhookSigningSecret: config.OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET,
}));
app.use(errorHandler);
const server = app.listen(5080, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { server.close(() => { void Promise.all([ports.close(), tenant.close(), payments.close()]).then(() => process.exit(0)); }); });
