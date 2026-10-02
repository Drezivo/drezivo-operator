const localDevelopmentOrigins = ['http://localhost:3010', 'http://127.0.0.1:3010'];

/** Keep the local console reachable in development while production uses explicit origins. */
export function resolveOperatorCorsOrigins(configured: string | undefined, nodeEnv: string): string[] {
  const explicit = configured?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (nodeEnv === 'production') return explicit;
  return [...new Set([...explicit, ...localDevelopmentOrigins])];
}
