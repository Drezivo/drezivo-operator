import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  createOperatorPlatformPaymentsRouter,
  detectQrMime,
  MAX_QR_BYTES,
  type PlatformPaymentMethod,
  type PlatformPaymentsPort,
  type QrImage,
} from '../src/operator-platform-payments/index.js';

const methodId = '850e8400-e29b-41d4-a716-446655440000';
const key = 'intent-key-1234567890';
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const method: PlatformPaymentMethod = {
  id: methodId, label: 'GCash', account_name: 'Drezivo', account_number: '09171234567', instructions: null,
  has_qr: true, active: true, sort_order: 0, version: 1, updated_at: '2026-10-01T00:00:00.000Z',
};
const result = { method, changed: true, replayed: false };

function port(overrides: Partial<PlatformPaymentsPort> = {}): PlatformPaymentsPort {
  return {
    list: async () => [method], readQr: async () => ({ bytes: png, mime: 'image/png' }), create: async () => result,
    update: async () => result, setActive: async () => result, ...overrides,
  };
}

function app(p: PlatformPaymentsPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next()) {
  const a = express();
  a.use(express.json({ limit: '1mb' }));
  a.use((_req, res, next) => {
    res.locals.requestId = 'req';
    res.locals.operatorPrincipal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_op', roles: ['platform_owner'], requestId: 'req' };
    next();
  });
  a.use('/api/v1', createOperatorPlatformPaymentsRouter(p, (_req, _res, next) => next(), { permissionMiddleware: permission }));
  a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const typed = e as { status?: number; code?: string; message?: string };
    res.status(typed.status ?? 500).json({ error: { code: typed.code, message: typed.message } });
  });
  return a;
}

const post = (a: express.Express, path: string, body: object) =>
  request(a).post(`/api/v1/platform-payment-methods${path}`).set('Idempotency-Key', key).send(body);

describe('operator platform payment methods boundary', () => {
  it('lists methods without image bytes and serves the QR with its detected type', async () => {
    const a = app(port());
    const list = await request(a).get('/api/v1/platform-payment-methods');
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({ items: [{ label: 'GCash', has_qr: true }], max_active: 10 });
    expect(JSON.stringify(list.body)).not.toContain('qr_image');
    const qr = await request(a).get(`/api/v1/platform-payment-methods/${methodId}/qr`);
    expect(qr.status).toBe(200);
    expect(qr.headers['content-type']).toBe('image/png');
    expect(qr.headers['x-content-type-options']).toBe('nosniff');
    expect(qr.headers['cache-control']).toBe('no-store');
    const none = await request(app(port({ readQr: async () => null }))).get(`/api/v1/platform-payment-methods/${methodId}/qr`);
    expect(none.status).toBe(404);
  });

  it('creates with a decoded QR, blank optional fields as null, and 201 only for a new intent', async () => {
    const seen: Array<{ qr: QrImage | null; fields: unknown }> = [];
    const a = app(port({ create: async (fields, qr) => { seen.push({ fields, qr }); return result; } }));
    const created = await post(a, '', { label: ' GCash ', account_name: '', account_number: '09171234567', qr: { data_base64: png.toString('base64') }, reason: 'Pilot launch' });
    expect(created.status).toBe(201);
    expect(seen[0]?.fields).toEqual({ label: 'GCash', account_name: null, account_number: '09171234567', instructions: null, sort_order: 0 });
    expect(seen[0]?.qr?.mime).toBe('image/png');
    expect(seen[0]?.qr?.bytes.equals(png)).toBe(true);
    const replayed = await post(app(port({ create: async () => ({ ...result, changed: false, replayed: true }) })), '', { label: 'GCash', reason: 'Pilot launch' });
    expect(replayed.status).toBe(200);
  });

  it('distinguishes keep, remove, and replace for the QR on update', async () => {
    const qrs: Array<QrImage | null | undefined> = [];
    const a = app(port({ update: async (_id, _version, _fields, qr) => { qrs.push(qr); return result; } }));
    await post(a, `/${methodId}`, { version: 1, label: 'GCash', reason: 'Fix label' });
    await post(a, `/${methodId}`, { version: 1, label: 'GCash', qr: null, reason: 'Remove QR' });
    await post(a, `/${methodId}`, { version: 1, label: 'GCash', qr: { data_base64: png.toString('base64') }, reason: 'New QR' });
    expect(qrs[0]).toBeUndefined();
    expect(qrs[1]).toBeNull();
    expect(qrs[2]?.mime).toBe('image/png');
  });

  it('forwards activate and deactivate with the version and the operator context', async () => {
    const calls: unknown[][] = [];
    const a = app(port({ setActive: async (...args) => { calls.push(args); return result; } }));
    expect((await post(a, `/${methodId}/deactivate`, { version: 3, reason: 'Account closed' })).status).toBe(200);
    expect((await post(a, `/${methodId}/activate`, { version: 4, reason: 'Account reopened' })).status).toBe(200);
    expect(calls[0]).toEqual([methodId, 3, false, expect.objectContaining({ operatorSubject: 'user_operator', idempotencyKey: key, reason: 'Account closed' })]);
    expect(calls[1]).toEqual([methodId, 4, true, expect.objectContaining({ reason: 'Account reopened' })]);
  });

  it('rejects bad input before calling the port', async () => {
    let called = false;
    const touch = async () => { called = true; return result; };
    const a = app(port({ create: touch, update: touch, setActive: touch }));
    const gif = Buffer.from('GIF89a-not-allowed-here').toString('base64');
    expect((await post(a, '', { label: 'GCash', qr: { data_base64: gif }, reason: 'Pilot launch' })).body.error.message).toContain('PNG, JPEG, or WebP');
    const huge = Buffer.concat([png, Buffer.alloc(MAX_QR_BYTES, 1)]).toString('base64');
    expect((await post(a, '', { label: 'GCash', qr: { data_base64: huge }, reason: 'Pilot launch' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(a, '', { label: '', reason: 'Pilot launch' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(a, '', { label: 'GCash' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(a, '', { label: 'GCash', reason: 'Pilot launch', extra: 1 })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post('/api/v1/platform-payment-methods').send({ label: 'GCash', reason: 'Pilot launch' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(a, `/${methodId}`, { label: 'GCash', reason: 'no version' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(a, '/not-a-uuid/activate', { version: 1, reason: 'Turn on' })).body.error.code).toBe('VALIDATION_FAILED');
    expect(called).toBe(false);
  });

  it('requires the manage permission for writes and redacts unexpected errors', async () => {
    const denyManage = (name: string) => (_req: Request, _res: Response, next: NextFunction) =>
      next(name === 'tenant.admin.manage' ? new AppError(403, 'FORBIDDEN', 'denied') : undefined);
    const readOnly = app(port(), denyManage);
    expect((await request(readOnly).get('/api/v1/platform-payment-methods')).status).toBe(200);
    expect((await post(readOnly, '', { label: 'GCash', reason: 'Pilot launch' })).status).toBe(403);
    const leaking = app(port({ list: async () => { throw new Error('password authentication failed for user drezivo_app'); } }));
    const down = await request(leaking).get('/api/v1/platform-payment-methods');
    expect(down.status).toBe(503);
    expect(JSON.stringify(down.body)).not.toContain('password');
  });

  it('detects image types from their bytes only', () => {
    expect(detectQrMime(png)).toBe('image/png');
    expect(detectQrMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectQrMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary'))).toBe('image/webp');
    expect(detectQrMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
