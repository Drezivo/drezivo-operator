import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, noStore, notFound, requestId, requireOperator } from './middleware.js';
import { createOperatorReadRouter, unavailableReadPort } from './operator-read/index.js';
import { createOperatorBillingRouter, unavailableBillingReadPort } from './operator-billing/index.js';
import { createOperatorAuditRouter, unavailableAuditPort } from './operator-audit/index.js';
import { createOperatorDirectoryRouter, unavailableOperatorDirectoryPort } from './operator-directory/index.js';
import { createOperatorSupportActivityRouter, unavailableSupportActivityPort } from './operator-support-activity/index.js';
import { isProcessReady } from './process-lifecycle.js';
import { createOperatorOperationsRouter, unavailableOperationsPort } from './operator-operations/index.js';
import { createOperatorSupportGrantRouter, unavailableSupportGrantCommandPort } from './operator-support/index.js';
import { createOperatorRetryRouter, unavailableOperationsRetryCommandPort } from './operator-retry/index.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { createPermissionMiddleware, denyAuthorizationPort, type AuthorizationPort } from './operator-authorization.js';

export function createApp(protectedRateLimit = createRateLimitMiddleware(), authorizationPort: AuthorizationPort = denyAuthorizationPort) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestId);
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.set('Cache-Control', 'no-store').status(isProcessReady() ? 200 : 503).json({ status: isProcessReady() ? 'ready' : 'draining' }));

  app.use('/operator', noStore, protectedRateLimit);
  app.use('/api/v1', noStore, protectedRateLimit);
  app.use(clerkContextMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.get('/operator/health', requireOperator(), (_req: Request, res: Response) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  const permissionMiddleware = createPermissionMiddleware(authorizationPort);
  app.use('/api/v1', createOperatorReadRouter(unavailableReadPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorBillingRouter(unavailableBillingReadPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorAuditRouter(unavailableAuditPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorDirectoryRouter(unavailableOperatorDirectoryPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportActivityRouter(unavailableSupportActivityPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorOperationsRouter(unavailableOperationsPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportGrantRouter(unavailableSupportGrantCommandPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorRetryRouter(unavailableOperationsRetryCommandPort, requireOperator(), { permissionMiddleware }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
