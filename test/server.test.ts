import { describe, expect, it } from 'vitest';
import { createAppServer, serverLimits } from '../src/server.js';

describe('server lifecycle', () => {
  it('configures bounded HTTP limits and can close before listening', async () => {
    const server = createAppServer();
    expect(server.requestTimeout).toBe(serverLimits.requestTimeout);
    expect(server.headersTimeout).toBe(serverLimits.headersTimeout);
    expect(server.keepAliveTimeout).toBe(serverLimits.keepAliveTimeout);
    expect(server.maxRequestsPerSocket).toBe(serverLimits.maxRequestsPerSocket);
    await new Promise<void>((resolve, reject) => server.close((error) => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
  });
});
