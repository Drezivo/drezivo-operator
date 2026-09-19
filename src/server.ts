import http from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { markProcessDraining, markProcessReady } from './process-lifecycle.js';

export const serverLimits = { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000, maxRequestsPerSocket: 100 } as const;
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
  let stopping = false;
  const shutdown = () => { if (stopping) return; stopping = true; markProcessDraining(); server.close(); setTimeout(() => server.closeAllConnections(), 10_000).unref(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.listen(port, () => markProcessReady());
  return server;
}
if (process.env.NODE_ENV !== 'test') startServer();
