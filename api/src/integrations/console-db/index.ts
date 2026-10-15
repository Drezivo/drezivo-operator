import type { WorkspacePort } from '../../operator-workspace/index.js';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { AppError } from '../../errors.js';
import { auditEventSchema, type AuditPort } from '../../operator-audit/index.js';
import { subscriptionSummarySchema, entitlementDetailSchema, type BillingReadPort } from '../../operator-billing/index.js';
import { operatorOverviewSchema, businessSummarySchema, businessDetailSchema, type ReadPort } from '../../operator-read/index.js';
import { jobSchema, notificationSchema, type OperationsPort } from '../../operator-operations/index.js';
import { type SupportGrantCommandPort, supportGrantProjectionSchema } from '../../operator-support/index.js';
import { type OperationsRetryCommandPort, retryResultSchema } from '../../operator-retry/index.js';
import { type AnalyticsReadPort } from '../../operator-analytics/index.js';
import { buildAnalytics } from './analytics.js';
import type { OperatorDirectoryPort } from '../../operator-directory/index.js';
import type { SessionAuditPort, GrantListPort } from '../../operator-console/index.js';
import type { TenantAdminDbOptions } from '../tenant-admin-db/index.js';
export type ConsolePorts = {
    workspace: WorkspacePort;
    directory?: OperatorDirectoryPort;
    audit: AuditPort;
    billing: BillingReadPort;
    read: ReadPort;
    operations: OperationsPort;
    grants: SupportGrantCommandPort;
    retry: OperationsRetryCommandPort;
    session: SessionAuditPort;
    grantList: GrantListPort;
    analytics: AnalyticsReadPort;
};
/** Only calls fixed, business-owned projections and commands. No arbitrary customer query. */
export function createConsoleDbAdapter(options: TenantAdminDbOptions & {
    synthetic?: boolean;
}): ConsolePorts & {
    close(): Promise<void>;
} {
    const pool = new pg.Pool({ connectionString: options.connectionString, max: 4, connectionTimeoutMillis: 5000,
        ...(options.caCertificate ? { ssl: { ca: options.caCertificate, rejectUnauthorized: true } } : {}) });
    async function transaction<T>(subject: string, write: boolean, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
            const role = (await client.query<{
                rolsuper: boolean;
                rolbypassrls: boolean;
            }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
            if (!role || role.rolsuper || role.rolbypassrls)
                throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator database role is invalid.');
            await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
            await client.query("SELECT set_config('app.actor_kind','operator',true),set_config('app.tenant_id','',true),set_config('app.principal_id',$1,true),set_config('statement_timeout','5s',true),set_config('lock_timeout','3s',true)", [`operator:${subject}`]);
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            const code = (error as {
                code?: string;
            }).code;
            if (code === '42501')
                throw new AppError(403, 'FORBIDDEN', 'Workspace access has expired, was closed, or does not allow this action.');
            if (code === '23503')
                throw new AppError(409, 'STATE_CONFLICT', 'This clothing has linked records. Review the deletion preview before continuing.');
            if (code === '23514' || code === '23502' || code === '22P02')
                throw new AppError(400, 'VALIDATION_FAILED', 'The correction violates the workspace data rules.');
            if (code === '23505')
                throw new AppError(409, 'STATE_CONFLICT', 'This intent or resource state has changed. Refresh before trying again.');
            if (code === 'P0002')
                throw new AppError(404, 'NOT_FOUND', 'The resource was not found.');
            if (code === '22023')
                throw new AppError(400, 'VALIDATION_FAILED', 'The operator command is invalid.');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async function projection(resource: string, input: object): Promise<unknown> {
        return transaction('projection', false, async (c) => (await c.query<{
            data: unknown;
        }>('SELECT operator_console_projection($1,$2::jsonb) AS data', [resource, JSON.stringify(input)])).rows[0]?.data);
    }
    async function page<T>(resource: string, filters: object, limit: number, at: string | null | undefined, id: string | undefined, parse: (v: unknown) => T) {
        const rows = await projection(resource, { ...filters, limit: limit + 1, ...(id ? { at, id } : {}) });
        if (!Array.isArray(rows))
            throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The operator projection is invalid.');
        return { items: rows.slice(0, limit).map(parse), more: rows.length > limit };
    }
    async function command(kind: string, subject: string, key: string, requestId: string, body: object): Promise<unknown> {
        return transaction(subject, true, async (c) => (await c.query<{
            data: unknown;
        }>('SELECT operator_console_command($1,$2,$3,$4,$5::jsonb) AS data', [kind, subject, key, requestId, JSON.stringify(body)])).rows[0]?.data);
    }
    return {
        workspace: { async execute({operation,subject,tenantId,grantId,idempotencyKey,requestId,input}) {
            return transaction(subject,true,async c => (await c.query<{data:unknown}>('SELECT operator_workspace($1,$2,$3::uuid,$4::uuid,$5,$6,$7::jsonb) AS data',[operation,subject,tenantId,grantId??null,idempotencyKey??null,requestId,JSON.stringify(input)])).rows[0]?.data);
        } },
        audit: { async listAuditEvents({ filters, limit, cursor }) {
                const p = await page('audit', filters, limit, cursor?.occurredAt, cursor?.eventId, (x) => auditEventSchema.parse(x));
                const last = p.items.at(-1);
                return { items: p.items, next_cursor: p.more && last ? { occurredAt: last.occurred_at, eventId: last.event_id } : null };
            } },
        billing: {
            async listSubscriptions({ filters, limit, cursor }) {
                const p = await page('subscriptions', filters, limit, cursor?.currentPeriodEnd, cursor?.tenantId, (x) => subscriptionSummarySchema.parse(x));
                const last = p.items.at(-1);
                return { items: p.items, next_cursor: p.more && last ? { currentPeriodEnd: last.current_period_end, tenantId: last.tenant_id } : null };
            },
            async getEntitlements({ tenantId }) { const data = await projection('entitlements', { tenant_id: tenantId }); return data === null ? null : entitlementDetailSchema.parse(data); },
        },
        read: {
            async overview() { return operatorOverviewSchema.parse(await projection('overview', {})); },
            async listBusinesses({ filters, limit, cursor }) { const p = await page('businesses', filters, limit, cursor?.createdAt, cursor?.tenantId, (x) => businessSummarySchema.parse(x)); const last = p.items.at(-1); return { items: p.items, next_cursor: p.more && last ? { createdAt: last.created_at, tenantId: last.tenant_id } : null }; },
            async getBusiness({ tenantId }) { const data = await projection('business', { tenant_id: tenantId }); return data === null ? null : businessDetailSchema.parse(data); },
        },
        operations: {
            async listJobs({ filters, limit, cursor }) { const p = await page('jobs', filters, limit, cursor?.availableAt, cursor?.id, (x) => jobSchema.parse(x)); const last = p.items.at(-1); return { items: p.items, next_cursor: p.more && last ? { availableAt: last.available_at, id: last.job_id } : null }; },
            async listNotifications({ filters, limit, cursor }) { const p = await page('notifications', filters, limit, cursor?.acceptedAt, cursor?.deliveryId, (x) => notificationSchema.parse(x)); const last = p.items.at(-1); return { items: p.items, next_cursor: p.more && last ? { acceptedAt: last.accepted_at, deliveryId: last.delivery_id } : null }; },
        },
        analytics: { async getAnalytics({ months }) { return buildAnalytics(await projection('analytics', {}), months, new Date(), options.synthetic); } },
        grants: {
            async createSupportGrant({ operatorSubject, idempotencyKey, requestId, ...body }) { return supportGrantProjectionSchema.parse(await command('grant.create', operatorSubject, idempotencyKey, requestId, body)); },
            async revokeSupportGrant({ operatorSubject, idempotencyKey, requestId, grantId }) { return supportGrantProjectionSchema.parse(await command('grant.revoke', operatorSubject, idempotencyKey, requestId, { grant_id: grantId })); },
        },
        retry: {
            async retryJob({ operatorSubject, idempotencyKey, requestId, jobId, ...body }) { return retryResultSchema.parse(await command('job.retry', operatorSubject, idempotencyKey, requestId, { ...body, resource_id: jobId })); },
            async retryNotification({ operatorSubject, idempotencyKey, requestId, deliveryId, ...body }) { return retryResultSchema.parse(await command('notification.retry', operatorSubject, idempotencyKey, requestId, { ...body, resource_id: deliveryId })); },
        },
        grantList: { async list({ tenantId, limit, cursor }) { const p = await page('grants', tenantId ? { tenant_id: tenantId } : {}, limit, cursor?.at, cursor?.id, (x) => x); const last = p.items.at(-1) as {
                created_at: string;
                grant_id: string;
            } | undefined; return { items: p.items, next_cursor: p.more && last ? { at: last.created_at, id: last.grant_id } : null }; } },
        session: {
            async record({ subject, sessionId, event, requestId, occurredAt }) {
                return transaction(subject, true, async (c) => {
                    const r = await c.query("INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id,created_at) VALUES('operator',$1,$2,'operator_session',$3,'succeeded','{}',$4,coalesce($5::timestamptz,now())) ON CONFLICT DO NOTHING RETURNING id", [`operator:${subject}`, `operator.session.${event}`, sessionEntityId(sessionId), requestId, occurredAt ?? null]);
                    return { recorded: r.rowCount === 1 };
                });
            },
            async recordDecision({ subject, permission, allowed, requestId }) {
                await transaction(subject, true, async (c) => {
                    await c.query("INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,outcome,redacted_summary,request_id) VALUES('operator',$1,$2,'operator_access',$3,$4::jsonb,$5)", [`operator:${subject}`, allowed ? 'operator.permission.allowed' : 'operator.permission.denied', allowed ? 'succeeded' : 'rejected', JSON.stringify({ permission }), requestId]);
                });
            },
            async isKnown(subject, sessionId) { return transaction(subject, false, async (c) => (await c.query("SELECT 1 FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND entity_type='operator_session' AND action='operator.session.started'", [`operator:${subject}`, sessionEntityId(sessionId)])).rowCount !== 0); },
            async isEnded(subject, sessionId) { return transaction(subject, false, async (c) => (await c.query("SELECT 1 FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND entity_type='operator_session' AND action IN ('operator.session.ended','operator.session.revoked','operator.session.removed') LIMIT 1", [`operator:${subject}`, sessionEntityId(sessionId)])).rowCount !== 0); },
        },
        close: () => pool.end(),
    };
}
function sessionEntityId(sessionId: string): string {
    const hash = createHash('sha256').update('operator-session:').update(sessionId).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
