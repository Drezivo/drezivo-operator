import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('operator API foundation', () => {
  it('reports health with a request id', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
  it('fails closed for protected routes', async () => {
    const response = await request(app).get('/operator/health');
    expect(response.status).toBe(401);
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
  it('rejects invalid request IDs', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'bad id');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST_ID');
  });
  it('rejects oversized request IDs', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'x'.repeat(129));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST_ID');
  });
});
