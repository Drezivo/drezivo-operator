import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { markProcessDraining, markProcessReady } from '../src/process-lifecycle.js';
describe('process readiness', () => { afterEach(() => markProcessReady()); it('reports ready', async () => { const r = await request(app).get('/ready'); expect(r.status).toBe(200); expect(r.body).toEqual({ status: 'ready' }); }); it('reports draining without auth', async () => { markProcessDraining(); const r = await request(app).get('/ready'); expect(r.status).toBe(503); expect(r.body).toEqual({ status: 'draining' }); }); });
