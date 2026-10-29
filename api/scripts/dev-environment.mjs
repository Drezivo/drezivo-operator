export function createDevelopmentEnvironment(environment) {
  return { ...environment, NODE_ENV: 'development' };
}
