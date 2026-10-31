import { createApp } from './app.js';
import { config, isBusinessUserDirectoryConfigured, isClerkConfigured, isDevelopmentLoopbackHttpEnabled, isInternalServiceConfigured, isProofLinkConfigured, isTenantAdminConfigured, tenantAdminDatabaseCa } from './config/index.js';
import { createConfiguredAuthorizationPort } from './shared/auth/operator-authorization.js';
import { createRateLimitMiddleware } from './shared/http/rate-limit.js';
import { createTenantAdminDbAdapter } from './features/clients/repository/admin.js';
import { createBusinessUserDirectory, emptyBusinessUserDirectory, type BusinessUserDirectory } from './features/clients/repository/clerk-directory.js';
import { createProofLinkSigner } from './features/payments/proof-link.js';
import { createPlatformPaymentsDbAdapter } from './features/payment-methods/repository/postgres.js';
import { createConsoleDbAdapter, type ConsolePorts } from './infrastructure/db/console-ports.js';
import { createOperatorDirectory } from './features/operators/repository/clerk.js';
import { createBusinessReadAdapter } from './features/clients/repository/internal.js';
import { createBillingReadAdapter } from './features/subscriptions/repository/internal.js';
import { createAnalyticsReadAdapter } from './features/analytics/repository/internal.js';
import { createOperationsReadAdapter } from './features/operations/repository/internal.js';
import { createDirectoryReadAdapter } from './features/operators/repository/internal.js';
import { createOperationsRetryAdapter } from './features/operations/repository/retry-internal.js';
import { unavailableTenantAdminPort, type TenantAdminPort, type ProofLinkSigner } from './features/clients/administration/index.js';
import { unavailablePlatformPaymentsPort, type PlatformPaymentsPort } from './features/payment-methods/index.js';
import { unavailableReadPort } from './features/clients/index.js';
import { unavailableBillingReadPort } from './features/subscriptions/index.js';
import { unavailableAnalyticsReadPort } from './features/analytics/index.js';
import { unavailableAuditPort } from './features/audit-logs/index.js';
import { unavailableOperatorDirectoryPort } from './features/operators/index.js';
import { unavailableOperationsPort } from './features/operations/index.js';
import { unavailableOperationsRetryCommandPort } from './features/operations/retry/index.js';
import { AppError } from './shared/http/errors.js';
import { logStartupFailure } from './shared/logging/failure-diagnostics.js';

function composeApplication() {
  try {
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

    const serviceOptions = isInternalServiceConfigured()
      ? {
        baseUrl: config.INTERNAL_SERVICE_BASE_URL!,
        serviceAuth: () => config.INTERNAL_SERVICE_AUTH!,
        allowInsecureTransport: isDevelopmentLoopbackHttpEnabled(),
      }
      : null;
    const operatorAssertion = serviceOptions ? { ...serviceOptions, operatorAssertionSecret: config.INTERNAL_OPERATOR_ASSERTION_SECRET } : null;
    const configuredConsolePorts: Partial<ConsolePorts> = isTenantAdminConfigured()
      ? createConsoleDbAdapter({
        connectionString: config.OPERATOR_TENANT_ADMIN_DATABASE_URL!,
        caCertificate: tenantAdminDatabaseCa(),
        synthetic: config.OPERATOR_LOCAL_SYNTHETIC,
      })
      : {};

    const consolePorts: Partial<ConsolePorts> = {
      ...configuredConsolePorts,
      read: configuredConsolePorts.read ?? (operatorAssertion ? createBusinessReadAdapter(operatorAssertion) : unavailableReadPort),
      billing: configuredConsolePorts.billing ?? (operatorAssertion ? createBillingReadAdapter(operatorAssertion) : unavailableBillingReadPort),
      analytics: configuredConsolePorts.analytics ?? (operatorAssertion ? createAnalyticsReadAdapter(operatorAssertion) : unavailableAnalyticsReadPort),
      audit: configuredConsolePorts.audit ?? unavailableAuditPort,
      operations: configuredConsolePorts.operations ?? (operatorAssertion ? createOperationsReadAdapter(operatorAssertion) : unavailableOperationsPort),
      directory: configuredConsolePorts.directory ?? (isClerkConfigured()
        ? createOperatorDirectory(config.CLERK_SECRET_KEY!, config.OPERATOR_CLERK_ORGANIZATION_ID!)
        : serviceOptions ? createDirectoryReadAdapter(serviceOptions) : unavailableOperatorDirectoryPort),
      retry: configuredConsolePorts.retry ?? (serviceOptions ? createOperationsRetryAdapter(serviceOptions) : unavailableOperationsRetryCommandPort),
    };

    return createApp({
      protectedRateLimit: createRateLimitMiddleware(),
      authorizationPort: createConfiguredAuthorizationPort(),
      tenantAdminPort: configuredTenantAdminPort,
      businessUserDirectory: configuredBusinessUserDirectory,
      proofLink: configuredProofLink,
      platformPaymentsPort: configuredPlatformPaymentsPort,
      consolePorts,
      corsOrigins: config.OPERATOR_CORS_ORIGINS,
      clerkWebhookSigningSecret: config.OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET,
    });
  } catch (error) {
    if (error instanceof AppError && error.diagnostics) {
      logStartupFailure(error.cause ?? error, {
        phase: 'composition', dependency: error.diagnostics.dependency, reason: error.diagnostics.reason,
        configurationKeys: error.diagnostics.configurationKeys,
      });
    } else if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      logStartupFailure(error, {
        phase: 'composition', dependency: 'tenant_admin_database', reason: 'ca_file_unreadable',
        configurationKeys: ['OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE'],
      });
    } else {
      logStartupFailure(error, { phase: 'composition', reason: 'invalid_configuration' });
    }
    throw new Error('API startup configuration failed.');
  }
}

export const app = composeApplication();
