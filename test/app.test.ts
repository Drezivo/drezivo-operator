import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, createApp } from '../src/app.js';
import { createRateLimitMiddleware } from '../src/rate-limit.js';

describe('operator API foundation', () => {
  it('reports health with a request id', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
  it('keeps public liveness and readiness available when Clerk auth is unavailable', async () => {
    const health = await request(app).get('/health');
    const readiness = await request(app).get('/ready');

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(readiness.status).toBe(200);
    expect(readiness.body).toEqual({ status: 'ready' });
  });
  it('keeps public probes unthrottled while protected routes are rate limited', async () => {
    const isolatedApp = createApp(createRateLimitMiddleware({ limit: 1, windowMs: 60_000 }));
    expect((await request(isolatedApp).get('/health')).status).toBe(200);
    expect((await request(isolatedApp).get('/ready')).status).toBe(200);
    expect((await request(isolatedApp).get('/operator/health')).status).toBe(401);
    const limited = await request(isolatedApp).get('/operator/health');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
  it('fails closed for protected routes', async () => {
    const response = await request(app).get('/operator/health');
    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('rejects malformed authorization headers', async () => {
    const response = await request(app).get('/operator/health').set('authorization', 'Basic token');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('fails closed when Clerk configuration is absent', async () => {
    const response = await request(app).get('/operator/health').set('authorization', 'Bearer token');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('OPERATOR_AUTH_NOT_CONFIGURED');
  });
  it('protects the read-only operator API routes', async () => {
    const response = await request(app).get('/api/v1/overview');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('protects the billing read routes', async () => {
    const subscriptions = await request(app).get('/api/v1/subscriptions');
    const entitlements = await request(app).get('/api/v1/businesses/550e8400-e29b-41d4-a716-446655440000/entitlements');
    expect(subscriptions.status).toBe(401);
    expect(subscriptions.body.error.code).toBe('UNAUTHENTICATED');
    expect(entitlements.status).toBe(401);
    expect(entitlements.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('protects the audit read route', async () => {
    const response = await request(app).get('/api/v1/audit-events');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('protects the operations read routes', async () => {
    const jobs = await request(app).get('/api/v1/jobs');
    const notifications = await request(app).get('/api/v1/notifications');
    expect(jobs.status).toBe(401);
    expect(jobs.body.error.code).toBe('UNAUTHENTICATED');
    expect(notifications.status).toBe(401);
    expect(notifications.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('protects directory and support activity routes', async () => {
    const operators = await request(app).get('/api/v1/operators');
    const activity = await request(app).get('/api/v1/support-activity');
    expect(operators.status).toBe(401);
    expect(operators.body.error.code).toBe('UNAUTHENTICATED');
    expect(activity.status).toBe(401);
    expect(activity.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('rejects invalid request IDs', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'bad id');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST_ID');
  });

  it('uses the canonical error envelope', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'bad id');
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST_ID', message: 'The request ID is invalid.' },
      request_id: expect.any(String),
    });
  });
  it('rejects oversized request IDs', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'x'.repeat(129));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST_ID');
  });
});
