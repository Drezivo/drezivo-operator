import type { AnalyticsReadPort } from './contracts.js';
import { AppError } from '../../shared/http/errors.js';

/** Feature use cases depend on this narrow repository contract. */
export function createAnalyticsReadService(repository: AnalyticsReadPort): AnalyticsReadPort & Required<Pick<AnalyticsReadPort, 'getPaidBusinesses'>> {
  return {
    getAnalytics: (...args: Parameters<AnalyticsReadPort['getAnalytics']>) => repository.getAnalytics(...args),
    getPaidBusinesses: () => {
      if (!repository.getPaidBusinesses) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The paid-business count is unavailable.');
      return repository.getPaidBusinesses();
    },
  };
}
