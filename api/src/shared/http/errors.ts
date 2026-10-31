export type FailureDependency =
  | 'tenant_admin_database'
  | 'internal_service'
  | 'internal_service_auth'
  | 'operator_auth'
  | 'session_audit'
  | 'proof_link';

export type FailureReason =
  | 'not_configured'
  | 'invalid_configuration'
  | 'configuration_conflict'
  | 'ca_file_unreadable'
  | 'connection_failed'
  | 'database_error'
  | 'authentication_failed'
  | 'permission_denied'
  | 'unsafe_role'
  | 'schema_unavailable'
  | 'transport_failed'
  | 'timeout'
  | 'dns_failure'
  | 'tls_failure'
  | 'upstream_rejected'
  | 'invalid_response'
  | 'response_too_large'
  | 'provider_unavailable'
  | 'request_auth_unavailable'
  | 'missing_assertion_secret'
  | 'dependency_unavailable';

export type AppErrorDiagnostics = {
  dependency: FailureDependency;
  reason: FailureReason;
  configurationKeys?: readonly string[];
  upstreamStatus?: number;
  databaseRole?: { superuser: boolean; bypassRls: boolean };
};

/** Repackages a dependency exception without losing its safe classification or raw cause. */
export function remapDependencyError(
  error: unknown,
  input: { code: string; message: string; diagnostics: AppErrorDiagnostics },
): AppError {
  const diagnostics = error instanceof AppError && error.diagnostics ? error.diagnostics : input.diagnostics;
  const cause = error instanceof AppError ? (error.cause ?? error) : error;
  return new AppError(503, input.code, input.message, {
    ...(cause !== undefined ? { cause } : {}),
    diagnostics,
  });
}

export class AppError extends Error {
  /** `cause` is the underlying failure; it is logged on the server and never sent to the client. */
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    options?: { cause?: unknown; diagnostics?: AppErrorDiagnostics },
  ) {
    super(message, options);
    this.diagnostics = options?.diagnostics;
  }

  /** Safe, structured server-side context. It is never included in the HTTP response. */
  public readonly diagnostics?: AppErrorDiagnostics;
}

export const errorBody = (code: string, message: string, requestId: string) => ({
  success: false,
  error: { code, message },
  request_id: requestId,
});
