import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../shared/http/errors.js';
import type { SafeOperatorPrincipal } from '../../../shared/auth/operator-auth.js';
import { createInternalServiceClient } from '../../../infrastructure/http/internal-service-client.js';
import type { PlatformPaymentsPort, PlatformPaymentCommandContext, QrImage } from '../contracts.js';

type Options = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; operatorAssertionSecret?: string; allowInsecureTransport?: boolean; fetchImpl?: typeof fetch };
const methodSchema = z.object({ id: z.string().uuid(), label: z.string(), account_name: z.string().nullable(), account_number: z.string().nullable(), instructions: z.string().nullable(), has_qr: z.boolean(), active: z.boolean(), sort_order: z.number(), version: z.number(), updated_at: z.string() }).strict();
const commandResponse = z.object({ success: z.literal(true), request_id: z.string(), data: z.object({ method: methodSchema, changed: z.boolean(), replayed: z.boolean() }).strict() }).passthrough();
const qrResponse = z.object({ success: z.literal(true), request_id: z.string(), data: z.object({ method_id: z.string().uuid(), data_base64: z.string().max(Math.ceil(512 * 1024 / 3) * 4), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']) }).strict() }).passthrough();
const errorResponse = z.object({ success: z.literal(false), request_id: z.string(), error: z.object({ code: z.string(), message: z.string() }).passthrough() }).passthrough();
const invalid = () => new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business service returned an invalid response.');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function assertion(secret: string | undefined, principal: SafeOperatorPrincipal | undefined, requestId: string, method: 'GET' | 'POST', path: string, body: unknown, key: string | null): string {
  if (!secret || Buffer.byteLength(secret) < 32 || !principal || principal.roles.length !== 1 || principal.roles[0] !== 'platform_owner' || !principal.operatorOrganizationId || principal.requestId !== requestId) {
    throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.');
  }
  const iat = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: principal.clerkUserId, org_id: principal.operatorOrganizationId,
    role: 'platform_owner', permission: method === 'GET' ? 'tenant.admin.read' : 'tenant.admin.manage', method, path, request_id: requestId,
    idempotency_key: key, body_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), iat, exp: iat + 60, jti: randomUUID() });
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

export function createBusinessPlatformQrAdapter(options: Options, reads: Pick<PlatformPaymentsPort, 'list' | 'setActive'>): PlatformPaymentsPort {
  const client = createInternalServiceClient({ ...options, timeoutMs: 30_000, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  async function call(path: string, method: 'GET' | 'POST', body: unknown, principal: SafeOperatorPrincipal | undefined, requestId: string, key: string | null) {
    const token = assertion(options.operatorAssertionSecret, principal, requestId, method, path, body, key);
    const response = await client.requestJsonResponse<unknown>(path, { requestId, method, ...(method === 'POST' ? { body } : {}), ...(key ? { headers: { 'Idempotency-Key': key } } : {}), operatorAssertion: token }, [200, 401, 403, 404, 409, 422]);
    if (response.status === 404 && response.data === null) {
      if (method === 'GET') return null;
      throw new AppError(404, 'NOT_FOUND', 'The payment method was not found.');
    }
    if (response.status !== 200) {
      const failure = errorResponse.safeParse(response.data);
      if (!failure.success || failure.data.request_id !== requestId) throw invalid();
      throw new AppError(response.status, failure.data.error.code as never, failure.data.error.message);
    }
    return response.data;
  }
  async function write(path: string, body: unknown, ctx: PlatformPaymentCommandContext, expectedId?: string) {
    if (ctx.operatorSubject !== ctx.operatorPrincipal?.clerkUserId) throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.');
    const raw = await call(path, 'POST', body, ctx.operatorPrincipal, ctx.requestId, ctx.idempotencyKey);
    const parsed = commandResponse.safeParse(raw);
    if (!parsed.success || parsed.data.request_id !== ctx.requestId || (expectedId && parsed.data.data.method.id !== expectedId)) throw invalid();
    return parsed.data.data;
  }
  const qrBody = (qr: QrImage | null | undefined) => qr === undefined ? undefined : qr === null ? null : { data_base64: qr.bytes.toString('base64') };
  return {
    list: (...args) => reads.list(...args),
    setActive: (...args) => reads.setActive(...args),
    async readQr(id, principal) {
      if (!principal) throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.');
      const raw = await call(`/internal/operator/v1/platform-payment-methods/${encodeURIComponent(id)}/qr`, 'GET', {}, principal, principal.requestId, null);
      if (raw === null) return null;
      const parsed = qrResponse.safeParse(raw);
      if (!parsed.success || parsed.data.request_id !== principal.requestId || parsed.data.data.method_id !== id) throw invalid();
      const bytes = Buffer.from(parsed.data.data.data_base64, 'base64');
      if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') !== parsed.data.data.data_base64) throw invalid();
      return { bytes, mime: parsed.data.data.mime };
    },
    create: (fields, qr, ctx) => write('/internal/operator/v1/platform-payment-methods', { ...fields, qr: qrBody(qr), reason: ctx.reason }, ctx),
    update: (id, version, fields, qr, ctx) => write(`/internal/operator/v1/platform-payment-methods/${encodeURIComponent(id)}`, { ...fields, version, ...(qr === undefined ? {} : { qr: qrBody(qr) }), reason: ctx.reason }, ctx, id),
  };
}
