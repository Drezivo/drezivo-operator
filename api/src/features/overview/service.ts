import { operatorOverviewSchema, type ReadPort } from '../clients/contracts.js';

export type OverviewRepository = Pick<ReadPort, 'overview'>;

export function createOverviewService(repository: OverviewRepository, recentSignupLimit = 50) {
  return async (input: Parameters<ReadPort['overview']>[0]) => {
    const data = operatorOverviewSchema.parse(await repository.overview(input));
    data.recent_businesses = data.recent_businesses.slice(0, Math.max(1, Math.min(recentSignupLimit, 100)));
    return data;
  };
}
