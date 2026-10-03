import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../src/errors.js';
import { errorHandler } from '../src/middleware.js';

type FakeResponse = { locals: { requestId: string }; statusCode: number; body: unknown; setHeader(): void; status(code: number): FakeResponse; json(body: unknown): FakeResponse };

const handle = (error: unknown): FakeResponse => {
  const res: FakeResponse = {
    locals: { requestId: 'req-1' },
    statusCode: 0,
    body: undefined,
    setHeader: () => undefined,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  errorHandler(error, {} as Request, res as unknown as Response, (() => undefined) as NextFunction);
  return res;
};

afterEach(() => vi.restoreAllMocks());

describe('server failure logging', () => {
  it('logs the cause of a dependency failure but sends the client only the generic error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = Object.assign(new Error('password authentication failed for user "drezivo_app"'), { code: '28P01', detail: 'Key (email)=(owner@example.com)' });

    const res = handle(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is temporarily unavailable.', { cause }));

    expect(res.body).toEqual({ success: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Business administration is temporarily unavailable.' }, request_id: 'req-1' });
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ request_id: 'req-1', status: 503, code: 'DEPENDENCY_UNAVAILABLE', cause: { name: 'Error', code: '28P01', message: 'password authentication failed for user "drezivo_app"' } });
    expect(JSON.stringify(line)).not.toContain('owner@example.com');
  });

  it('logs unexpected errors and stays quiet for client errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    handle(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    handle(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' }));
    expect(log).not.toHaveBeenCalled();

    const res = handle(new TypeError('boom'));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ request_id: 'req-1', error: { name: 'TypeError', message: 'boom' } });
  });
});
