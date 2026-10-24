import type { SupportActivityPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createSupportActivityService(repository: SupportActivityPort): SupportActivityPort {
  return {
    listSupportActivity: (...args: Parameters<SupportActivityPort['listSupportActivity']>) => repository.listSupportActivity(...args),
  };
}
