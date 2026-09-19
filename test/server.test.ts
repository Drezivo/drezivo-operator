import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppServer, createShutdownHandler, serverLimits } from '../src/server.js';
import { isProcessReady, markProcessReady } from '../src/process-lifecycle.js';

describe('server lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    markProcessReady();
  });

  it('configures bounded HTTP limits and can close before listening', async () => {
    const server = createAppServer();
    expect(server.requestTimeout).toBe(serverLimits.requestTimeout);
    expect(server.headersTimeout).toBe(serverLimits.headersTimeout);
    expect(server.keepAliveTimeout).toBe(serverLimits.keepAliveTimeout);
    expect(server.maxRequestsPerSocket).toBe(serverLimits.maxRequestsPerSocket);
    await new Promise<void>((resolve, reject) => server.close((error) => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
  });

  it('marks readiness as draining and closes only once for duplicate shutdown calls', () => {
    const server = createAppServer();
    const close = vi.spyOn(server, 'close').mockImplementation(() => server);
    vi.useFakeTimers();
    const shutdown = createShutdownHandler(server, 1_000);

    shutdown();
    shutdown();

    expect(isProcessReady()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('force-closes connections at the configured deadline', () => {
    const server = createAppServer();
    const close = vi.spyOn(server, 'close').mockImplementation(() => server);
    const closeAllConnections = vi.spyOn(server, 'closeAllConnections');
    vi.useFakeTimers();
    const shutdown = createShutdownHandler(server, 1_000);

    shutdown();
    vi.advanceTimersByTime(999);
    expect(closeAllConnections).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(close).toHaveBeenCalledTimes(1);
    expect(closeAllConnections).toHaveBeenCalledTimes(1);
  });
});
