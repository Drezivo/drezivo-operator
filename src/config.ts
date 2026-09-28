import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { resolveOperatorCorsOrigins } from './operator-cors-origins.js';
import { isAllowedDevelopmentLoopbackHttpUrl } from './internal-service-transport.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5080),
  OPERATOR_API_HOST: z.enum(['0.0.0.0', '127.0.0.1']).default('0.0.0.0'),
  OPERATOR_CORS_ORIGINS: z.string().optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  OPERATOR_CLERK_ORGANIZATION_ID: z.string().min(1).optional(),
  INTERNAL_SERVICE_BASE_URL: z.string().url().optional(),
  INTERNAL_SERVICE_AUTH: z.string().min(1).optional(),
  INTERNAL_SERVICE_ALLOW_INSECURE_HTTP: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  INTERNAL_OPERATOR_ASSERTION_SECRET: z.string().optional(),
  OPERATOR_TENANT_ADMIN_DATABASE_URL: z.string().optional(),
  OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE: z.string().optional(),
}).superRefine((value, context) => {
  if (value.OPERATOR_TENANT_ADMIN_DATABASE_URL) {
    let protocol = '';
    try { protocol = new URL(value.OPERATOR_TENANT_ADMIN_DATABASE_URL).protocol; } catch { /* reported below */ }
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      context.addIssue({ code: 'custom', path: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'], message: 'Must be a postgres:// connection string.' });
    }
    if (value.NODE_ENV === 'production' && !value.OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE) {
      context.addIssue({ code: 'custom', path: ['OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE'], message: 'Production requires the database CA certificate for verified TLS.' });
    }
  }
  if (value.INTERNAL_OPERATOR_ASSERTION_SECRET && Buffer.byteLength(value.INTERNAL_OPERATOR_ASSERTION_SECRET, 'utf8') < 32) {
    context.addIssue({ code: 'custom', path: ['INTERNAL_OPERATOR_ASSERTION_SECRET'], message: 'Must contain at least 32 UTF-8 bytes.' });
  }
  const origins = value.OPERATOR_CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (value.NODE_ENV === 'production' && origins.length === 0) {
    context.addIssue({ code: 'custom', path: ['OPERATOR_CORS_ORIGINS'], message: 'Production requires explicit HTTPS operator origins.' });
  }
  if (value.INTERNAL_SERVICE_ALLOW_INSECURE_HTTP && !isDevelopmentLoopbackHttpConfiguration({
    nodeEnv: value.NODE_ENV,
    enabled: value.INTERNAL_SERVICE_ALLOW_INSECURE_HTTP,
    baseUrl: value.INTERNAL_SERVICE_BASE_URL,
  })) {
    context.addIssue({ code: 'custom', path: ['INTERNAL_SERVICE_ALLOW_INSECURE_HTTP'], message: 'Insecure internal service HTTP is allowed only for a loopback URL in development.' });
  }
  origins.forEach((origin, index) => {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Origin must be an exact HTTP(S) origin without a path or credentials.');
      }
      if (value.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new Error('Production operator origins must use HTTPS.');
      }
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['OPERATOR_CORS_ORIGINS', index],
        message: error instanceof Error ? error.message : 'Invalid operator origin.',
      });
    }
  });
});

type Environment = Readonly<Record<string, string | undefined>>;

/** Maps the app-facing Clerk key names to the names read by the Express SDK. */
export function resolveClerkEnvironment(environment: Environment): {
  CLERK_SECRET_KEY: string | undefined;
  CLERK_PUBLISHABLE_KEY: string | undefined;
} {
  const resolveKey = (sdkName: string, appName: string): string | undefined => {
    const sdkValue = environment[sdkName];
    const appValue = environment[appName];
    if (sdkValue !== undefined && appValue !== undefined && sdkValue !== appValue) {
      throw new Error(`Conflicting Clerk configuration: use matching ${sdkName} and ${appName} values.`);
    }
    return sdkValue ?? appValue;
  };

  return {
    CLERK_SECRET_KEY: resolveKey('CLERK_SECRET_KEY', 'NEXT_CLERK_SECRET_KEY'),
    CLERK_PUBLISHABLE_KEY: resolveKey('CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'),
  };
}

const clerkEnvironment = resolveClerkEnvironment(process.env);
for (const [name, value] of Object.entries(clerkEnvironment)) {
  if (value !== undefined) process.env[name] = value;
}

const parsedConfig = schema.safeParse({ ...process.env, ...clerkEnvironment });
if (!parsedConfig.success) {
  const invalidNames = [...new Set(parsedConfig.error.issues.map((issue) => String(issue.path[0] ?? 'configuration')))];
  throw new Error(`Invalid environment configuration for: ${invalidNames.join(', ')}.`);
}
export const config = {
  ...parsedConfig.data,
  OPERATOR_CORS_ORIGINS: resolveOperatorCorsOrigins(parsedConfig.data.OPERATOR_CORS_ORIGINS, parsedConfig.data.NODE_ENV),
};

export function isClerkConfigured(): boolean {
  return Boolean(config.CLERK_SECRET_KEY && config.CLERK_PUBLISHABLE_KEY && config.OPERATOR_CLERK_ORGANIZATION_ID);
}

export function isTenantAdminConfigured(): boolean {
  return Boolean(config.OPERATOR_TENANT_ADMIN_DATABASE_URL);
}

/** Reads the PEM certificate used to verify the business database's TLS certificate. */
export function tenantAdminDatabaseCa(): string | undefined {
  const file = config.OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE;
  return file ? readFileSync(file, 'utf8') : undefined;
}

export function isInternalServiceConfigured(): boolean {
  return Boolean(config.INTERNAL_SERVICE_BASE_URL && config.INTERNAL_SERVICE_AUTH);
}

export function isDevelopmentLoopbackHttpEnabled(): boolean {
  return isDevelopmentLoopbackHttpConfiguration({
    nodeEnv: config.NODE_ENV,
    enabled: config.INTERNAL_SERVICE_ALLOW_INSECURE_HTTP,
    baseUrl: config.INTERNAL_SERVICE_BASE_URL,
  });
}

export function isDevelopmentLoopbackHttpConfiguration(input: {
  nodeEnv: string;
  enabled: boolean;
  baseUrl: string | undefined;
}): boolean {
  return input.enabled
    && input.nodeEnv === 'development'
    && isAllowedDevelopmentLoopbackHttpUrl(input.baseUrl);
}
