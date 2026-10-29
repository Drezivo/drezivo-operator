import http from 'node:http';
import { app } from './composition.js';
import { config } from './config/index.js';
import { logger } from './shared/logging/logger.js';
import { markProcessDraining, markProcessReady } from './shared/lifecycle/process-lifecycle.js';

export const serverLimits = { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000, maxRequestsPerSocket: 100 } as const;
export const shutdownDeadlineMs = 10_000;

export function createShutdownHandler(server: http.Server, deadlineMs = shutdownDeadlineMs): () => void {
  let stopping = false;
  return () => {
    if (stopping) return;
    stopping = true;
    markProcessDraining();
    server.close();
    const forceCloseTimer = setTimeout(() => server.closeAllConnections(), deadlineMs);
    forceCloseTimer.unref();
  };
}

export function createAppServer(): http.Server {
  const server = http.createServer(app);
  server.requestTimeout = serverLimits.requestTimeout;
  server.headersTimeout = serverLimits.headersTimeout;
  server.keepAliveTimeout = serverLimits.keepAliveTimeout;
  server.maxRequestsPerSocket = serverLimits.maxRequestsPerSocket;
  return server;
}

export function createStartupFailureHandler(port: number): (error: NodeJS.ErrnoException) => never {
  return (error) => {
    logger.error({
      event: 'api.server.startup_failed',
      host: config.OPERATOR_API_HOST,
      port,
      error: { name: error.name, code: error.code, message: error.message },
    }, 'API server failed to start');
    throw error;
  };
}

export function startServer(port = config.PORT): http.Server {
  const server = createAppServer();
  const shutdown = createShutdownHandler(server);
  const onStartupFailure = createStartupFailureHandler(port);
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.once('error', onStartupFailure);
  server.listen(port, config.OPERATOR_API_HOST, () => {
    server.off('error', onStartupFailure);
    markProcessReady();
    const address = server.address();
    const host = address && typeof address === 'object' ? address.address : config.OPERATOR_API_HOST;
    const boundPort = address && typeof address === 'object' ? address.port : port;
    logger.info({ event: 'api.server.listening', host, port: boundPort }, 'API server is listening');
    if (process.env.OPERATOR_DEV_STARTUP_NOTIFY === '1' && process.connected && process.send) {
      process.send({ event: 'api.server.listening' }, () => {});
    }
  });
  return server;
}
if (process.env.NODE_ENV !== 'test') startServer();
