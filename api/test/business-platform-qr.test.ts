import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createBusinessPlatformQrAdapter } from '../src/features/payment-methods/repository/business-qr.js';
import type { PlatformPaymentsPort } from '../src/features/payment-methods/contracts.js';
import type { SafeOperatorPrincipal } from '../src/shared/auth/operator-auth.js';

const principal: SafeOperatorPrincipal = { clerkUserId: 'operator', operatorOrganizationId: 'org', roles: ['platform_owner'], requestId: 'req' };
const secret = 'local-assertion-key-at-least-32-characters';
const key = 'local-intent-12345';
const id = '850e8400-e29b-41d4-a716-446655440000';
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fields = { label: 'Bank', account_name: null, account_number: null, instructions: null, sort_order: 0 };
const record = { id, ...fields, has_qr: true, active: true, version: 1, updated_at: '2026-01-01T00:00:00Z' };
const ctx = { operatorSubject: 'operator', operatorPrincipal: principal, requestId: 'req', idempotencyKey: key, reason: 'New method' };
const reads = { list: vi.fn(), setActive: vi.fn() } as unknown as PlatformPaymentsPort;

describe('Business platform QR adapter', () => {
  it('binds a create request to its operator, body, path, and idempotency key', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:4000/internal/operator/v1/platform-payment-methods');
      const headers = new Headers(init?.headers);
      const [head, payload, signature] = (headers.get('X-Drezivo-Operator-Assertion') ?? '').split('.');
      if (!head || !payload || !signature) throw new Error('Missing assertion segments');
      const expected = createHmac('sha256', secret).update(`${head}.${payload}`).digest('base64url');
      expect(timingSafeEqual(Buffer.from(signature), Buffer.from(expected))).toBe(true);
      const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
      expect(claim).toMatchObject({ sub: 'operator', permission: 'tenant.admin.manage', path: '/internal/operator/v1/platform-payment-methods', idempotency_key: key });
      expect(claim.body_hash).toBe(createHash('sha256').update(String(init?.body)).digest('hex'));
      expect(JSON.parse(String(init?.body))).toMatchObject({ qr: { data_base64: bytes.toString('base64') } });
      return Response.json({ success: true, request_id: 'req', data: { method: record, changed: true, replayed: false } });
    });
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await expect(adapter.create(fields, { bytes, mime: 'image/png' }, ctx)).resolves.toMatchObject({ method: { id }, changed: true });
  });

  it('returns QR bytes without exposing the storage key', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, request_id: 'req', data: { method_id: id, data_base64: bytes.toString('base64'), mime: 'image/png' } }));
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await expect(adapter.readQr(id, principal)).resolves.toEqual({ bytes, mime: 'image/png' });
  });

  it('rejects a response for a different payment method', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, request_id: 'req', data: { method_id: '950e8400-e29b-41d4-a716-446655440000', data_base64: bytes.toString('base64'), mime: 'image/png' } }));
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await expect(adapter.readQr(id, principal)).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('fails closed when the operator principal is missing', async () => {
    const fetchImpl = vi.fn();
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await expect(adapter.create(fields, null, { ...ctx, operatorPrincipal: undefined })).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves the distinction between keeping and removing a QR', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: true, request_id: 'req', data: { method: record, changed: true, replayed: false } });
    });
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await adapter.update(id, 1, fields, undefined, ctx);
    await adapter.update(id, 1, fields, null, ctx);
    expect(Object.hasOwn(bodies[0] ?? {}, 'qr')).toBe(false);
    expect(bodies[1]?.qr).toBeNull();
  });

  it('preserves not-found behavior for a missing payment method on update', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const adapter = createBusinessPlatformQrAdapter({ baseUrl: 'http://127.0.0.1:4000/', allowInsecureTransport: true, serviceAuth: () => 'service', operatorAssertionSecret: secret, fetchImpl }, reads);
    await expect(adapter.update(id, 1, fields, null, ctx)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
