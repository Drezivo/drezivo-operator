import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppServer, createShutdownHandler, createStartupFailureHandler, serverLimits } from '../src/server.js';
import { logger } from '../src/shared/logging/logger.js';
import { isProcessReady, markProcessDraining, markProcessReady } from '../src/shared/lifecycle/process-lifecycle.js';

describe('server lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('logs and rethrows startup failures without marking the process ready', () => {
    markProcessDraining();
    const error = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:5080'), { code: 'EADDRINUSE' });
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    expect(() => createStartupFailureHandler(5080)(error)).toThrow(error);
    expect(isProcessReady()).toBe(false);
    expect(logError).toHaveBeenCalledWith({
      event: 'api.server.startup_failed',
      host: expect.any(String),
      port: 5080,
      error: { name: 'Error', code: 'EADDRINUSE', message: error.message },
    }, 'API server failed to start');
  });

  it('binds only to loopback when OPERATOR_API_HOST is set to 127.0.0.1', async () => {
    const sigtermListeners = new Set(process.listeners('SIGTERM'));
    const sigintListeners = new Set(process.listeners('SIGINT'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPERATOR_API_HOST', '127.0.0.1');
    vi.stubEnv('OPERATOR_DEV_STARTUP_NOTIFY', '1');
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
    const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected');
    const send = vi.fn();
    Object.defineProperty(process, 'send', { configurable: true, value: send });
    Object.defineProperty(process, 'connected', { configurable: true, value: true });
    vi.resetModules();
    const { startServer: startConfiguredServer } = await import('../src/server.js');
    const { logger: serverLogger } = await import('../src/shared/logging/logger.js');
    const logInfo = vi.spyOn(serverLogger, 'info').mockImplementation(() => undefined);
    const server = startConfiguredServer(0);

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const address = server.address();
      expect(address).toMatchObject({ address: '127.0.0.1' });
      if (address === null || typeof address === 'string') throw new Error('Expected a TCP server address.');
      expect(logInfo).toHaveBeenCalledTimes(1);
      expect(logInfo).toHaveBeenCalledWith({
        event: 'api.server.listening',
        host: address.address,
        port: address.port,
      }, 'API server is listening');
      expect(send).toHaveBeenCalledWith({ event: 'api.server.listening' }, expect.any(Function));
      expect(isProcessReady()).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (sendDescriptor) Object.defineProperty(process, 'send', sendDescriptor);
      else Reflect.deleteProperty(process, 'send');
      if (connectedDescriptor) Object.defineProperty(process, 'connected', connectedDescriptor);
      else Reflect.deleteProperty(process, 'connected');
      for (const listener of process.listeners('SIGTERM')) {
        if (!sigtermListeners.has(listener)) process.removeListener('SIGTERM', listener);
      }
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.has(listener)) process.removeListener('SIGINT', listener);
      }
    }
  });
});
