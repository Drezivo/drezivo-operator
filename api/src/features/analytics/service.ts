import type { AnalyticsReadPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createAnalyticsReadService(repository: AnalyticsReadPort): AnalyticsReadPort {
  return {
    getAnalytics: (...args: Parameters<AnalyticsReadPort['getAnalytics']>) => repository.getAnalytics(...args),
  };
}
