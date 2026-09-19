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
import { config, isInternalServiceConfigured } from './config.js';
import { createBusinessReadAdapter } from './integrations/business-read/index.js';
import { createBillingReadAdapter } from './integrations/billing-read/index.js';
import { createAuditReadAdapter } from './integrations/audit-read/index.js';
import { createOperationsReadAdapter } from './integrations/operations-read/index.js';
import { createDirectoryReadAdapter } from './integrations/directory-read/index.js';

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
  const serviceOptions = isInternalServiceConfigured() ? { baseUrl: config.INTERNAL_SERVICE_BASE_URL!, serviceAuth: () => config.INTERNAL_SERVICE_AUTH! } : null;
  const readPort = serviceOptions ? createBusinessReadAdapter(serviceOptions) : unavailableReadPort;
  const billingPort = serviceOptions ? createBillingReadAdapter(serviceOptions) : unavailableBillingReadPort;
  const auditPort = serviceOptions ? createAuditReadAdapter(serviceOptions) : unavailableAuditPort;
  const operationsPort = serviceOptions ? createOperationsReadAdapter(serviceOptions) : unavailableOperationsPort;
  const directoryPort = serviceOptions ? createDirectoryReadAdapter(serviceOptions) : unavailableOperatorDirectoryPort;
  app.use('/api/v1', createOperatorReadRouter(readPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorBillingRouter(billingPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorAuditRouter(auditPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorDirectoryRouter(directoryPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportActivityRouter(unavailableSupportActivityPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorOperationsRouter(operationsPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportGrantRouter(unavailableSupportGrantCommandPort, requireOperator(), { permissionMiddleware }));
  app.use('/api/v1', createOperatorRetryRouter(unavailableOperationsRetryCommandPort, requireOperator(), { permissionMiddleware }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
