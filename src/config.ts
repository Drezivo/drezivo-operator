import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5080),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  OPERATOR_CLERK_ORGANIZATION_ID: z.string().min(1).optional(),
  INTERNAL_SERVICE_BASE_URL: z.string().url().optional(),
  INTERNAL_SERVICE_AUTH: z.string().min(1).optional(),
});

export const config = schema.parse(process.env);

export function isClerkConfigured(): boolean {
  return Boolean(config.CLERK_SECRET_KEY && config.OPERATOR_CLERK_ORGANIZATION_ID);
}

export function isInternalServiceConfigured(): boolean {
  return Boolean(config.INTERNAL_SERVICE_BASE_URL && config.INTERNAL_SERVICE_AUTH);
}
