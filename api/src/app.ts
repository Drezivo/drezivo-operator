import { createWorkspaceRouter } from './operator-workspace/index.js';
import { createSessionWebhookRouter } from './operator-console/session-webhook.js';
import { createOperatorDirectory } from './integrations/operator-directory/index.js';
import { createConsoleDbAdapter, type ConsolePorts } from './integrations/console-db/index.js';
import { createOperatorConsoleRouter } from './operator-console/index.js';
import express, { type Request, type Response, type RequestHandler } from 'express';
import helmet from 'helmet';
import { clerkContextMiddleware, errorHandler, noStore, notFound, requestId, requireOperator } from './middleware.js';
import { createOperatorReadRouter, unavailableReadPort } from './operator-read/index.js';
import { createOperatorBillingRouter, unavailableBillingReadPort } from './operator-billing/index.js';
import { createOperatorAnalyticsRouter, unavailableAnalyticsReadPort } from './operator-analytics/index.js';
import { createOperatorAuditRouter, unavailableAuditPort } from './operator-audit/index.js';
import { createOperatorDirectoryRouter, unavailableOperatorDirectoryPort } from './operator-directory/index.js';
import { isProcessReady } from './process-lifecycle.js';
import { createOperatorOperationsRouter, unavailableOperationsPort } from './operator-operations/index.js';
import { createOperatorSupportGrantRouter, unavailableSupportGrantCommandPort } from './operator-support/index.js';
import { createOperatorRetryRouter, unavailableOperationsRetryCommandPort } from './operator-retry/index.js';
import { createOperatorTenantAdminRouter, unavailableTenantAdminPort, type TenantAdminPort } from './operator-tenant-admin/index.js';
import { createTenantAdminDbAdapter } from './integrations/tenant-admin-db/index.js';
import { createProofLinkSigner } from './proof-link.js';
import { createOperatorPlatformPaymentsRouter, unavailablePlatformPaymentsPort, type PlatformPaymentsPort } from './operator-platform-payments/index.js';
import { createPlatformPaymentsDbAdapter } from './integrations/platform-payments-db/index.js';
import type { ProofLinkSigner } from './operator-tenant-admin/index.js';
import { createBusinessUserDirectory, emptyBusinessUserDirectory, type BusinessUserDirectory } from './integrations/business-user-directory/index.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { createConfiguredAuthorizationPort, createPermissionMiddleware, denyAuthorizationPort, type AuthorizationPort } from './operator-authorization.js';
import { config, isDevelopmentLoopbackHttpEnabled, isInternalServiceConfigured, isBusinessUserDirectoryConfigured, isProofLinkConfigured, isTenantAdminConfigured, isClerkConfigured, tenantAdminDatabaseCa } from './config.js';
import { createBusinessReadAdapter } from './integrations/business-read/index.js';
import { createBillingReadAdapter } from './integrations/billing-read/index.js';
import { createAnalyticsReadAdapter } from './integrations/analytics-read/index.js';
import { createOperationsReadAdapter } from './integrations/operations-read/index.js';
import { createDirectoryReadAdapter } from './integrations/directory-read/index.js';
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
  proofLink?: ProofLinkSigner,
  platformPaymentsPort: PlatformPaymentsPort = unavailablePlatformPaymentsPort,
  consolePorts: Partial<ConsolePorts> = {},
  authentication?: RequestHandler,
) {
  const app = express();
  const verifyOperator = authentication ?? requireOperator({ membershipResolver: authorizationPort.resolveMembership });
  const requireAuthorizedOperator: RequestHandler = (req,res,next) => {
    if(res.locals.operatorPrincipal){next();return;}
    verifyOperator(req,res,(error?:unknown)=>{
      if(error){next(error);return;}
      const principal=res.locals.operatorPrincipal;
      if(consolePorts.session && principal?.sessionId){
        void consolePorts.session.record({subject:principal.clerkUserId,sessionId:principal.sessionId,event:'started',requestId:String(res.locals.requestId)}).then(()=>next(),next);
      }else next();
    });
  };
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestId);
  app.use(operatorCors);
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.set('Cache-Control', 'no-store').status(isProcessReady() ? 200 : 503).json({ status: isProcessReady() ? 'ready' : 'draining' }));

  app.use('/operator', noStore, protectedRateLimit, (authentication ? (_req, _res, next) => next() : clerkContextMiddleware()));
  app.use('/api/v1', noStore, protectedRateLimit, (authentication ? (_req, _res, next) => next() : clerkContextMiddleware()));
  app.use(createSessionWebhookRouter(consolePorts.session,config.OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET,createRateLimitMiddleware()));
  app.use(express.json({ limit: '1mb' }));
  app.get('/operator/health', requireAuthorizedOperator, (_req: Request, res: Response) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  const permissionMiddleware = createPermissionMiddleware(authorizationPort, consolePorts.session?.recordDecision);
  const serviceOptions = isInternalServiceConfigured() ? { baseUrl: config.INTERNAL_SERVICE_BASE_URL!, serviceAuth: () => config.INTERNAL_SERVICE_AUTH!, allowInsecureTransport: isDevelopmentLoopbackHttpEnabled() } : null;
  const upstreamReadPort = serviceOptions ? createBusinessReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableReadPort;
  const readPort = consolePorts.read ?? upstreamReadPort;
  const billingPort = consolePorts.billing ?? (serviceOptions ? createBillingReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableBillingReadPort);
  const analyticsPort = consolePorts.analytics ?? (serviceOptions ? createAnalyticsReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableAnalyticsReadPort);
  const auditPort = consolePorts.audit ?? unavailableAuditPort;
  const operationsPort = consolePorts.operations ?? (serviceOptions ? createOperationsReadAdapter({ ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET }) : unavailableOperationsPort);
  const directoryPort = consolePorts.directory ?? (isClerkConfigured() ? createOperatorDirectory(config.CLERK_SECRET_KEY!, config.OPERATOR_CLERK_ORGANIZATION_ID!) : serviceOptions ? createDirectoryReadAdapter(serviceOptions) : unavailableOperatorDirectoryPort);
  const supportGrantPort = consolePorts.grants ?? (serviceOptions ? createSupportGrantCommandAdapter(serviceOptions) : unavailableSupportGrantCommandPort);
  const retryPort = consolePorts.retry ?? (serviceOptions ? createOperationsRetryAdapter(serviceOptions) : unavailableOperationsRetryCommandPort);
  app.use('/api/v1', createWorkspaceRouter(consolePorts.workspace, requireAuthorizedOperator, permissionMiddleware));
  app.use('/api/v1', createOperatorConsoleRouter(consolePorts, requireAuthorizedOperator, permissionMiddleware));
  app.use('/api/v1', createOperatorReadRouter(readPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorBillingRouter(billingPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAnalyticsRouter(analyticsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAuditRouter(auditPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorDirectoryRouter(directoryPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorOperationsRouter(operationsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportGrantRouter(supportGrantPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorRetryRouter(retryPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorTenantAdminRouter(tenantAdminPort, requireAuthorizedOperator, { permissionMiddleware, directory: businessUserDirectory, proofLink }));
  app.use('/api/v1', createOperatorPlatformPaymentsRouter(platformPaymentsPort, requireAuthorizedOperator, { permissionMiddleware }));
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

// Same database login as business administration (ADR 0025); Drezivo's payment methods live there too.
const configuredPlatformPaymentsPort: PlatformPaymentsPort = isTenantAdminConfigured()
  ? createPlatformPaymentsDbAdapter({ connectionString: config.OPERATOR_TENANT_ADMIN_DATABASE_URL!, caCertificate: tenantAdminDatabaseCa() })
  : unavailablePlatformPaymentsPort;

const configuredProofLink: ProofLinkSigner | undefined = isProofLinkConfigured()
  ? createProofLinkSigner({ secret: config.OPERATOR_PROOF_LINK_SECRET!, businessApiUrl: config.BUSINESS_API_PUBLIC_URL! })
  : undefined;

export const app = createApp(createRateLimitMiddleware(), createConfiguredAuthorizationPort(), configuredTenantAdminPort, configuredBusinessUserDirectory, configuredProofLink, configuredPlatformPaymentsPort, isTenantAdminConfigured() ? createConsoleDbAdapter({ connectionString: config.OPERATOR_TENANT_ADMIN_DATABASE_URL!, caCertificate: tenantAdminDatabaseCa() }) : {});
