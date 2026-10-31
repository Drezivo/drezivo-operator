import type { AppErrorDiagnostics, FailureDependency, FailureReason } from '../http/errors.js';
import { logger } from './logger.js';

const dependencies = new Set<FailureDependency>([
  'tenant_admin_database', 'internal_service', 'internal_service_auth', 'operator_auth', 'session_audit', 'proof_link',
]);
const reasons = new Set<FailureReason>([
  'not_configured', 'invalid_configuration', 'configuration_conflict', 'ca_file_unreadable', 'connection_failed',
  'database_error', 'authentication_failed', 'permission_denied', 'unsafe_role', 'schema_unavailable', 'transport_failed', 'timeout',
  'dns_failure', 'tls_failure', 'upstream_rejected', 'invalid_response', 'response_too_large', 'provider_unavailable',
  'request_auth_unavailable', 'missing_assertion_secret', 'dependency_unavailable',
]);
const configurationKeys = new Set([
  'NODE_ENV', 'PORT', 'OPERATOR_API_HOST', 'OPERATOR_CORS_ORIGINS',
  'OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY',
  'OPERATOR_CLERK_ORGANIZATION_ID', 'NEXT_CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'INTERNAL_SERVICE_BASE_URL', 'INTERNAL_SERVICE_AUTH', 'INTERNAL_SERVICE_ALLOW_INSECURE_HTTP',
  'INTERNAL_OPERATOR_ASSERTION_SECRET', 'OPERATOR_TENANT_ADMIN_DATABASE_URL',
  'OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE', 'OPERATOR_PROOF_LINK_SECRET', 'BUSINESS_API_PUBLIC_URL',
]);
const safeCodes = new Set([
  '28P01', '28000', '42501', '23505', '23503', '23514', '23502', '22P02', '22023', '42P01', '42703', '42883',
  '08001', '08006', '53300', '53400', '57P01', '57014', '55P03', 'P0002',
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'EACCES', 'ENOENT',
  'EADDRINUSE', 'ERR_SOCKET_BAD_PORT',
]);
const safeNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError', 'AppError', 'AbortError']);

export function postgresFailureReason(error: unknown): AppErrorDiagnostics['reason'] {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === '28P01' || code === '28000') return 'authentication_failed';
  if (code === '42501') return 'permission_denied';
  if (code === '42P01' || code === '42703' || code === '42883') return 'schema_unavailable';
  if (code === '57014' || code === '55P03' || code === 'ETIMEDOUT') return 'timeout';
  if (code === '08001' || code === '08006' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'connection_failed';
  return 'database_error';
}

export function networkFailureReason(error: unknown): AppErrorDiagnostics['reason'] {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const value = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (value.name === 'AbortError' || value.code === 'ETIMEDOUT') return 'timeout';
    if (value.code === 'ENOTFOUND' || value.code === 'EAI_AGAIN' || value.code === 'EHOSTUNREACH') return 'dns_failure';
    if (typeof value.code === 'string' && (value.code.startsWith('CERT_') || value.code.startsWith('ERR_TLS_') || value.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')) return 'tls_failure';
    current = value.cause;
  }
  return 'transport_failed';
}

export function safeErrorSummary(value: unknown, depth = 0): { name: string; code?: string; cause?: ReturnType<typeof safeErrorSummary> } {
  if (!(value instanceof Error)) return { name: 'UnknownError' };
  const code = (value as Error & { code?: unknown }).code;
  const cause = value.cause;
  return {
    name: safeNames.has(value.name) ? value.name : 'Error',
    ...(typeof code === 'string' && safeCodes.has(code) ? { code } : {}),
    ...(depth < 2 && cause !== undefined ? { cause: safeErrorSummary(cause, depth + 1) } : {}),
  };
}

export function safeDiagnosticFields(diagnostics: AppErrorDiagnostics | undefined): Record<string, unknown> {
  if (!diagnostics || !dependencies.has(diagnostics.dependency) || !reasons.has(diagnostics.reason)) return {};
  const keys = [...new Set(diagnostics.configurationKeys ?? [])].filter((key) => configurationKeys.has(key));
  const status = diagnostics.upstreamStatus;
  const role = diagnostics.databaseRole;
  return {
    dependency: diagnostics.dependency,
    reason: diagnostics.reason,
    ...(keys.length ? { configuration_keys: keys } : {}),
    ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { upstream_status: status } : {}),
    ...(role && typeof role.superuser === 'boolean' && typeof role.bypassRls === 'boolean'
      ? { database_role: { superuser: role.superuser, bypass_rls: role.bypassRls } }
      : {}),
  };
}

export function logStartupFailure(
  error: unknown,
  input: { phase: string; dependency?: FailureDependency; reason: FailureReason; configurationKeys?: readonly string[] },
): void {
  const safePhase = /^[a-z][a-z0-9_]{1,40}$/.test(input.phase) ? input.phase : 'startup';
  const diagnostics = safeDiagnosticFields(input.dependency ? {
    dependency: input.dependency, reason: input.reason, configurationKeys: input.configurationKeys,
  } : undefined);
  const safeKeys = [...new Set(input.configurationKeys ?? [])].filter((key) => configurationKeys.has(key));
  logger.error({
    event: 'api.config.startup_failed',
    phase: safePhase,
    reason: reasons.has(input.reason) ? input.reason : 'invalid_configuration',
    ...diagnostics,
    ...(safeKeys.length ? { configuration_keys: safeKeys } : {}),
    error: safeErrorSummary(error),
  }, 'API startup configuration failed');
}
