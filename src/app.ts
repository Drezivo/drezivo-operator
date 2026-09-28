import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, noStore, notFound, requestId, requireOperator } from './middleware.js';
import { createOperatorReadRouter, unavailableReadPort } from './operator-read/index.js';
import { createOperatorBillingRouter, unavailableBillingReadPort } from './operator-billing/index.js';
import { createOperatorAnalyticsRouter, unavailableAnalyticsReadPort } from './operator-analytics/index.js';
import { createOperatorAuditRouter, unavailableAuditPort } from './operator-audit/index.js';
import { createOperatorDirectoryRouter, unavailableOperatorDirectoryPort } from './operator-directory/index.js';
import { createOperatorSupportActivityRouter, unavailableSupportActivityPort } from './operator-support-activity/index.js';
import { isProcessReady } from './process-lifecycle.js';
import { createOperatorOperationsRouter, unavailableOperationsPort } from './operator-operations/index.js';
import { createOperatorSupportGrantRouter, unavailableSupportGrantCommandPort } from './operator-support/index.js';
import { createOperatorRetryRouter, unavailableOperationsRetryCommandPort } from './operator-retry/index.js';
import { createOperatorTenantAdminRouter, unavailableTenantAdminPort, type TenantAdminPort } from './operator-tenant-admin/index.js';
import { createTenantAdminDbAdapter } from './integrations/tenant-admin-db/index.js';
import { createBusinessUserDirectory, emptyBusinessUserDirectory, type BusinessUserDirectory } from './integrations/business-user-directory/index.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { createConfiguredAuthorizationPort, createPermissionMiddleware, denyAuthorizationPort, type AuthorizationPort } from './operator-authorization.js';
import { config, isDevelopmentLoopbackHttpEnabled, isInternalServiceConfigured, isBusinessUserDirectoryConfigured, isTenantAdminConfigured, tenantAdminDatabaseCa } from './config.js';
import { createBusinessReadAdapter } from './integrations/business-read/index.js';
import { createBillingReadAdapter } from './integrations/billing-read/index.js';
import { createAnalyticsReadAdapter } from './integrations/analytics-read/index.js';
import { createAuditReadAdapter } from './integrations/audit-read/index.js';
import { createOperationsReadAdapter } from './integrations/operations-read/index.js';
import { createDirectoryReadAdapter } from './integrations/directory-read/index.js';
import { createSupportActivityReadAdapter } from './integrations/support-activity/index.js';
import { createSupportGrantCommandAdapter } from './integrations/support-grants/index.js';
import { createOperationsRetryAdapter } from './integrations/operations-retry/index.js';

const corsMethods = new Set(['GET', 'POST']);
const corsHeaders = new Set(['authorization', 'content-type', 'idempotency-key', 'x-request-id']);

function operatorCors(req: Request, res: Response, next: (error?: unknown) => void): void {
  const origin = req.get('Origin');
  res.vary('Origin');

  if (req.method === 'OPTIONS') {
    const requestedMethod = req.get('Access-Control-Request-Method')?.toUpperCase();
    if (!origin && !requestedMethod) { next(); return; }
    if (!origin || !requestedMethod || !config.OPERATOR_CORS_ORIGINS.includes(origin)) { res.sendStatus(403); return; }
    const requestedHeaders = (req.get('Access-Control-Request-Headers') ?? '').split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
    if (!corsMethods.has(requestedMethod) || requestedHeaders.some((header) => !corsHeaders.has(header))) { res.sendStatus(403); return; }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-ID');
    res.status(204).end();
    return;
  }

  if (origin) {
    if (!config.OPERATOR_CORS_ORIGINS.includes(origin) || !corsMethods.has(req.method)) { res.sendStatus(403); return; }
    res.set('Access-Control-Allow-Origin', origin);
  }
  next();
}

export function createApp(
  protectedRateLimit = createRateLimitMiddleware(),
  authorizationPort: AuthorizationPort = denyAuthorizationPort,
  tenantAdminPort: TenantAdminPort = unavailableTenantAdminPort,
  businessUserDirectory: BusinessUserDirectory = emptyBusinessUserDirectory,
) {
  const app = express();
  const requireAuthorizedOperator = requireOperator({ membershipResolver: authorizationPort.resolveMembership });
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestId);
  app.use(operatorCors);
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.set('Cache-Control', 'no-store').status(isProcessReady() ? 200 : 503).json({ status: isProcessReady() ? 'ready' : 'draining' }));

  app.use('/operator', noStore, protectedRateLimit, clerkContextMiddleware());
  app.use('/api/v1', noStore, protectedRateLimit, clerkContextMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.get('/operator/health', requireAuthorizedOperator, (_req: Request, res: Response) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  const permissionMiddleware = createPermissionMiddleware(authorizationPort);
  const serviceOptions = isInternalServiceConfigured() ? { baseUrl: config.INTERNAL_SERVICE_BASE_URL!, serviceAuth: () => config.INTERNAL_SERVICE_AUTH!, allowInsecureTransport: isDevelopmentLoopbackHttpEnabled() } : null;
  const readPort = serviceOptions ? createBusinessReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableReadPort;
  const billingPort = serviceOptions ? createBillingReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableBillingReadPort;
  const analyticsPort = serviceOptions ? createAnalyticsReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableAnalyticsReadPort;
  const auditPort = serviceOptions ? createAuditReadAdapter(serviceOptions) : unavailableAuditPort;
  const operationsPort = serviceOptions ? createOperationsReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableOperationsPort;
  const directoryPort = serviceOptions ? createDirectoryReadAdapter(serviceOptions) : unavailableOperatorDirectoryPort;
  const supportActivityPort = serviceOptions ? createSupportActivityReadAdapter(serviceOptions) : unavailableSupportActivityPort;
  const supportGrantPort = serviceOptions ? createSupportGrantCommandAdapter(serviceOptions) : unavailableSupportGrantCommandPort;
  const retryPort = serviceOptions ? createOperationsRetryAdapter(serviceOptions) : unavailableOperationsRetryCommandPort;
  app.use('/api/v1', createOperatorReadRouter(readPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorBillingRouter(billingPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAnalyticsRouter(analyticsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAuditRouter(auditPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorDirectoryRouter(directoryPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportActivityRouter(supportActivityPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorOperationsRouter(operationsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportGrantRouter(supportGrantPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorRetryRouter(retryPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorTenantAdminRouter(tenantAdminPort, requireAuthorizedOperator, { permissionMiddleware, directory: businessUserDirectory }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const configuredTenantAdminPort: TenantAdminPort = isTenantAdminConfigured()
  ? createTenantAdminDbAdapter({ connectionString: config.OPERATOR_TENANT_ADMIN_DATABASE_URL!, caCertificate: tenantAdminDatabaseCa() })
  : unavailableTenantAdminPort;

const configuredBusinessUserDirectory: BusinessUserDirectory = isBusinessUserDirectoryConfigured()
  ? createBusinessUserDirectory({ secretKey: config.BUSINESS_CLERK_SECRET_KEY! })
  : emptyBusinessUserDirectory;

export const app = createApp(createRateLimitMiddleware(), createConfiguredAuthorizationPort(), configuredTenantAdminPort, configuredBusinessUserDirectory);
