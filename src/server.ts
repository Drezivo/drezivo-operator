import http from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { markProcessDraining, markProcessReady } from './process-lifecycle.js';

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
export function startServer(port = config.PORT): http.Server {
  const server = createAppServer();
  const shutdown = createShutdownHandler(server);
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.listen(port, () => markProcessReady());
  return server;
}
if (process.env.NODE_ENV !== 'test') startServer();
