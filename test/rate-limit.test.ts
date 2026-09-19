import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimitMiddleware, InMemoryRateLimitStore } from '../src/rate-limit.js';

describe('rate limiting', () => {
  it('allows requests within the limit and rejects with a safe retry response', async () => {
    const app = express();
    app.use(createRateLimitMiddleware({ limit: 2, windowMs: 60_000 }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status((error as { status: number }).status).json({ error: (error as { code: string }).code });
    });
    await request(app).get('/').expect(200);
    await request(app).get('/').expect(200);
    const response = await request(app).get('/').expect(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(response.body).toEqual({ error: 'RATE_LIMITED' });
  });

  it.each([
    ['a throwing store', { consume: () => { throw new Error('store unavailable'); } }],
    ['a malformed store result', { consume: () => ({ allowed: true, retryAfterSeconds: 0 }) }],
  ])('fails closed for %s', async (_label, store) => {
    const app = express();
    app.use(createRateLimitMiddleware({ store }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status((error as { status: number }).status).json({ error: (error as { code: string }).code });
    });

    const response = await request(app).get('/').expect(503);
    expect(response.body).toEqual({ error: 'RATE_LIMIT_UNAVAILABLE' });
  });

  it('expires entries and bounds key growth', () => {
    const store = new InMemoryRateLimitStore(1, 100, 2);
    store.consume('a', 0);
    store.consume('b', 0);
    store.consume('c', 0);
    expect(store.size).toBe(2);
    store.consume('d', 101);
    expect(store.size).toBe(1);
  });
});
