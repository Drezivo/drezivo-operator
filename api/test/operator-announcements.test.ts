import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createAnnouncementsRouter, type AnnouncementsPort } from '../src/features/announcements/index.js';

const key = 'announcement-maintenance-0001';

function app(port: AnnouncementsPort, granted: string[] = ['tenant.admin.read', 'tenant.admin.manage']) {
  const a = express();
  a.use(express.json());
  a.use((_req, res, next) => {
    res.locals.requestId = 'req';
    res.locals.operatorPrincipal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_op', roles: ['platform_owner'], requestId: 'req' };
    next();
  });
  const permission = (name: string) => (_req: Request, _res: Response, next: NextFunction) =>
    granted.includes(name) ? next() : next(Object.assign(new Error('forbidden'), { status: 403, code: 'FORBIDDEN' }));
  a.use('/api/v1', createAnnouncementsRouter(port, (_req, _res, next) => next(), { permissionMiddleware: permission }));
  a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const typed = e as { status?: number; code?: string; message?: string };
    res.status(typed.status ?? 500).json({ error: { code: typed.code, message: typed.message } });
  });
  return a;
}

describe('operator announcements', () => {
  it('sends once per intent key, replays the same announcement, and validates the message', async () => {
    const sent: Array<{ subject: string; key: string; actor: string }> = [];
    const port: AnnouncementsPort = {
      list: async () => [],
      send: async (input, context) => {
        const replayed = sent.some((entry) => entry.key === context.idempotencyKey);
        if (!replayed) sent.push({ subject: input.subject, key: context.idempotencyKey, actor: context.operatorSubject });
        return { id: '00000000-0000-4000-8000-000000000001', subject: input.subject, recipient_count: 12, created_at: '2026-11-01T00:00:00Z', replayed };
      },
    };
    const a = app(port);
    const body = { subject: ' Maintenance on Sunday ', body: 'Drezivo is offline from 1 AM to 2 AM.' };

    const first = await request(a).post('/api/v1/announcements').set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ recipient_count: 12, replayed: false });
    expect((await request(a).post('/api/v1/announcements').set('Idempotency-Key', key).send(body)).status).toBe(200);
    expect(sent).toEqual([{ subject: 'Maintenance on Sunday', key, actor: 'user_operator' }]);

    expect((await request(a).post('/api/v1/announcements').send(body)).body.error.code).toBe('VALIDATION_FAILED');
    const empty = await request(a).post('/api/v1/announcements').set('Idempotency-Key', 'announcement-empty-0001').send({ subject: 'Hi', body: '  ' });
    expect(empty.body.error.message).toBe('Write the message.');
    expect((await request(a).post('/api/v1/announcements').set('Idempotency-Key', 'announcement-extra-0001').send({ ...body, to: 'x' })).status).toBe(400);
  });

  it('needs the manage permission to send and the read permission to list', async () => {
    const port: AnnouncementsPort = { list: async () => [], send: async () => { throw new Error('must not send'); } };
    const readOnly = app(port, ['tenant.admin.read']);
    expect((await request(readOnly).get('/api/v1/announcements')).status).toBe(200);
    expect((await request(readOnly).post('/api/v1/announcements').set('Idempotency-Key', key).send({ subject: 'a', body: 'b' })).status).toBe(403);
    expect((await request(app(port, [])).get('/api/v1/announcements')).status).toBe(403);
  });
});
