import express, { type Request, type Response, type RequestHandler } from "express";
import helmet from "helmet";
import { clerkContextMiddleware, errorHandler, noStore, notFound, requestId, requireOperator } from "./shared/http/middleware.js";
import { isProcessReady } from "./shared/lifecycle/process-lifecycle.js";
import { createRateLimitMiddleware } from "./shared/http/rate-limit.js";
import { createPermissionMiddleware, denyAuthorizationPort, type AuthorizationPort } from "./shared/auth/operator-authorization.js";
import { createWorkspaceRouter } from "./features/support-access/workspace/index.js";
import { createSessionWebhookRouter } from "./features/sessions/webhook-routes.js";
import type { ConsolePorts } from "./infrastructure/db/console-ports.js";
import { createOperatorConsoleRouter } from "./features/sessions/index.js";
import { createOperatorReadRouter, unavailableReadPort } from "./features/clients/index.js";
import { createOverviewRouter } from './features/overview/routes.js';
import { createOperatorBillingRouter, unavailableBillingReadPort } from "./features/subscriptions/index.js";
import { createAssignedPlansRouter } from './features/assigned-plans/routes.js';
import { createOperatorAnalyticsRouter, unavailableAnalyticsReadPort } from "./features/analytics/index.js";
import { createOperatorAuditRouter, unavailableAuditPort } from "./features/audit-logs/index.js";
import { createOperatorDirectoryRouter, unavailableOperatorDirectoryPort } from "./features/operators/index.js";
import { createOperatorOperationsRouter, unavailableOperationsPort } from "./features/operations/index.js";
import { createOperatorSupportGrantRouter, unavailableSupportGrantCommandPort } from "./features/support-access/index.js";
import { createOperatorRetryRouter, unavailableOperationsRetryCommandPort } from "./features/operations/retry/index.js";
import { createOperatorTenantAdminRouter, unavailableTenantAdminPort, type TenantAdminPort, type ProofLinkSigner } from "./features/clients/administration/index.js";
import { createSubscriptionAdministrationRouter } from './features/subscriptions/administration-routes.js';
import { createPaymentAdministrationRouter } from './features/payments/routes.js';
import { createOperatorPlatformPaymentsRouter, unavailablePlatformPaymentsPort, type PlatformPaymentsPort } from "./features/payment-methods/index.js";
import { emptyBusinessUserDirectory, type BusinessUserDirectory } from "./features/clients/repository/clerk-directory.js";

const corsMethods = new Set(['GET', 'POST']);
const corsHeaders = new Set(['authorization', 'content-type', 'idempotency-key', 'x-request-id']);

function createOperatorCors(origins: readonly string[]): RequestHandler {
  const allowedOrigins = new Set(origins);
  return (req, res, next) => {
    const origin = req.get('Origin');
    res.vary('Origin');

    if (req.method === 'OPTIONS') {
      const requestedMethod = req.get('Access-Control-Request-Method')?.toUpperCase();
      if (!origin && !requestedMethod) { next(); return; }
      if (!origin || !requestedMethod || !allowedOrigins.has(origin)) { res.sendStatus(403); return; }
      const requestedHeaders = (req.get('Access-Control-Request-Headers') ?? '').split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
      if (!corsMethods.has(requestedMethod) || requestedHeaders.some((header) => !corsHeaders.has(header))) { res.sendStatus(403); return; }
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-ID');
      res.status(204).end();
      return;
    }

    if (origin) {
      if (!allowedOrigins.has(origin) || !corsMethods.has(req.method)) { res.sendStatus(403); return; }
      res.set('Access-Control-Allow-Origin', origin);
    }
    next();
  };
}

export type OperatorAppDependencies = {
  protectedRateLimit?: RequestHandler;
  authorizationPort?: AuthorizationPort;
  tenantAdminPort?: TenantAdminPort;
  businessUserDirectory?: BusinessUserDirectory;
  proofLink?: ProofLinkSigner;
  platformPaymentsPort?: PlatformPaymentsPort;
  consolePorts?: Partial<ConsolePorts>;
  authentication?: RequestHandler;
  corsOrigins?: readonly string[];
  clerkWebhookSigningSecret?: string;
};

/** Builds the HTTP application from explicit ports and middleware. */
export function createApp(dependencies: OperatorAppDependencies = {}) {
  const {
    protectedRateLimit = createRateLimitMiddleware(),
    authorizationPort = denyAuthorizationPort,
    tenantAdminPort = unavailableTenantAdminPort,
    businessUserDirectory = emptyBusinessUserDirectory,
    proofLink,
    platformPaymentsPort = unavailablePlatformPaymentsPort,
    consolePorts = {},
    authentication,
    corsOrigins = [],
    clerkWebhookSigningSecret,
  } = dependencies;
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
  app.use(createOperatorCors(corsOrigins));
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.set('Cache-Control', 'no-store').status(isProcessReady() ? 200 : 503).json({ status: isProcessReady() ? 'ready' : 'draining' }));

  app.use('/operator', noStore, protectedRateLimit, (authentication ? (_req, _res, next) => next() : clerkContextMiddleware()));
  app.use('/api/v1', noStore, protectedRateLimit, (authentication ? (_req, _res, next) => next() : clerkContextMiddleware()));
  app.use(createSessionWebhookRouter(consolePorts.session, clerkWebhookSigningSecret, createRateLimitMiddleware()));
  app.use(express.json({ limit: '1mb' }));
  app.get('/operator/health', requireAuthorizedOperator, (_req: Request, res: Response) => res.set('Cache-Control', 'no-store').status(200).json({ status: 'ok' }));
  const permissionMiddleware = createPermissionMiddleware(authorizationPort, consolePorts.session?.recordDecision);
  app.use('/api/v1', createWorkspaceRouter(consolePorts.workspace, requireAuthorizedOperator, permissionMiddleware));
  app.use('/api/v1', createOperatorConsoleRouter(consolePorts, requireAuthorizedOperator, permissionMiddleware));
  app.use('/api/v1', createOperatorReadRouter(consolePorts.read ?? unavailableReadPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOverviewRouter(consolePorts.read ?? unavailableReadPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorBillingRouter(consolePorts.billing ?? unavailableBillingReadPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createAssignedPlansRouter(consolePorts.billing ?? unavailableBillingReadPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAnalyticsRouter(consolePorts.analytics ?? unavailableAnalyticsReadPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorAuditRouter(consolePorts.audit ?? unavailableAuditPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorDirectoryRouter(consolePorts.directory ?? unavailableOperatorDirectoryPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorOperationsRouter(consolePorts.operations ?? unavailableOperationsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorSupportGrantRouter(consolePorts.grants ?? unavailableSupportGrantCommandPort, requireAuthorizedOperator, { permissionMiddleware, grantList: consolePorts.grantList }));
  app.use('/api/v1', createOperatorRetryRouter(consolePorts.retry ?? unavailableOperationsRetryCommandPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createOperatorTenantAdminRouter(tenantAdminPort, requireAuthorizedOperator, { permissionMiddleware, directory: businessUserDirectory, proofLink }));
  app.use('/api/v1', createSubscriptionAdministrationRouter(tenantAdminPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use('/api/v1', createPaymentAdministrationRouter(tenantAdminPort, requireAuthorizedOperator, { permissionMiddleware, proofLink }));
  app.use('/api/v1', createOperatorPlatformPaymentsRouter(platformPaymentsPort, requireAuthorizedOperator, { permissionMiddleware }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
