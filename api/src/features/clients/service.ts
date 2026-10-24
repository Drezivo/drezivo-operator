import type { ReadPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createReadService(repository: Pick<ReadPort, 'listBusinesses' | 'getBusiness'>): Pick<ReadPort, 'listBusinesses' | 'getBusiness'> {
  return {
    listBusinesses: (...args: Parameters<ReadPort['listBusinesses']>) => repository.listBusinesses(...args),
    getBusiness: (...args: Parameters<ReadPort['getBusiness']>) => repository.getBusiness(...args),
  };
}
