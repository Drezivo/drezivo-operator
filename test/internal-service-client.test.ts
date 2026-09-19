import { describe, expect, it } from 'vitest';
import { InternalServiceClient } from '../src/internal-service-client.js';

const response = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
const options = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({ baseUrl: 'https://business.example/', serviceAuth: async () => 'Bearer service-token', fetchImpl, ...extra });

describe('internal service client', () => {
  it('accepts relative internal paths and sends bounded JSON request headers', async () => { let seen: { url: string; init?: RequestInit } | undefined; const client = new InternalServiceClient(options(async (url, init) => { seen = { url: String(url), init }; return response(200, '{"ok":true}'); })); await expect(client.requestJson('/internal/operator/v1/overview', { requestId: 'req-1' })).resolves.toEqual({ ok: true }); expect(seen?.url).toBe('https://business.example/internal/operator/v1/overview'); expect(seen?.init?.headers).toEqual({ Accept: 'application/json', 'X-Request-ID': 'req-1', Authorization: 'Bearer service-token' }); expect(seen?.init?.redirect).toBe('error'); await client.requestJson('/internal/operator/v1/overview', { requestId: 'req-1', method: 'POST', body: { ok: true } }); expect((seen?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json'); });
  it('rejects absolute and non-internal paths and enforces HTTPS by default', async () => { const fetchImpl = async () => response(200, '{}'); expect(() => new InternalServiceClient(options(fetchImpl, { baseUrl: 'http://business.example/' }))).toThrow(); const client = new InternalServiceClient(options(fetchImpl)); await expect(client.requestJson('https://evil.example/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); await expect(client.requestJson('/api/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); expect(() => new InternalServiceClient(options(fetchImpl, { baseUrl: 'http://localhost:3000/', allowInsecureTransport: true }))).not.toThrow(); });
  it('rejects malformed runtime path and request shapes with safe errors', async () => { const client = new InternalServiceClient(options(async () => response(200, '{}'))); await expect(client.requestJson(42 as never, { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); await expect(client.requestJson('/internal/x', { requestId: 'r', method: 42 as never })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); await expect(client.requestJson('/internal/x', null as never)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); });
  it('fails closed for missing service auth, unsafe auth, invalid request IDs, methods, and timeout settings', async () => { let calls = 0; const fetchImpl = async () => { calls += 1; return response(200, '{}'); }; const client = new InternalServiceClient(options(fetchImpl, { serviceAuth: async () => '' })); await expect(client.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' }); const unsafe = new InternalServiceClient(options(fetchImpl, { serviceAuth: async () => 'Bearer ok\r\nX-Leak: yes' })); await expect(unsafe.requestJson('/internal/x', { requestId: 'valid' })).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' }); const normal = new InternalServiceClient(options(fetchImpl)); await expect(normal.requestJson('/internal/x', { requestId: 'bad id' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); await expect(normal.requestJson('/internal/x', { requestId: 'valid', method: 'OPTIONS' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); expect(calls).toBe(0); expect(() => new InternalServiceClient(options(fetchImpl, { timeoutMs: 100 }))).toThrow(); });
  it('maps timeout, abort, non-2xx, malformed JSON, and oversized bodies safely', async () => { const timeoutClient = new InternalServiceClient(options((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }), { timeoutMs: 250 })); await expect(timeoutClient.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); const badStatus = new InternalServiceClient(options(async () => response(502, '{"secret":"x"}'))); await expect(badStatus.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); const badStatusContentType = new InternalServiceClient(options(async () => new Response('upstream unavailable', { status: 502, headers: { 'content-type': 'text/plain' } }))); await expect(badStatusContentType.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); const malformed = new InternalServiceClient(options(async () => response(200, 'bad-json'))); await expect(malformed.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' }); const huge = new InternalServiceClient(options(async () => response(200, '123456789', { 'content-length': '9' }), { maxResponseBytes: 8 })); await expect(huge.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); });
  it('maps redirect failures safely', async () => { const client = new InternalServiceClient(options(async () => { throw new TypeError('redirect disallowed'); })); await expect(client.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); });
  it('cancels a streamed response exactly once when it exceeds the byte limit', async () => {
    let cancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4])); },
      cancel() { cancelCalls += 1; },
    });
    const client = new InternalServiceClient(options(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }), { maxResponseBytes: 3 }));
    await expect(client.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(cancelCalls).toBe(1);
  });
  it('cancels a declared oversized response before reading its body', async () => {
    let cancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() { cancelCalls += 1; },
    });
    const client = new InternalServiceClient(options(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-length': '4' } }), { maxResponseBytes: 3 }));
    await expect(client.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(cancelCalls).toBe(1);
  });
  it('does not cancel a response within the byte limit', async () => {
    let cancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":true}')); controller.close(); },
      cancel() { cancelCalls += 1; },
    });
    const client = new InternalServiceClient(options(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }), { maxResponseBytes: 32 }));
    await expect(client.requestJson('/internal/x', { requestId: 'r' })).resolves.toEqual({ ok: true });
    expect(cancelCalls).toBe(0);
  });
  it('keeps abort handling safe while reading a response', async () => {
    const client = new InternalServiceClient(options(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(client.requestJson('/internal/x', { requestId: 'r' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
