import type { BillingReadPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createBillingReadService(repository: Pick<BillingReadPort, 'listSubscriptions'>): Pick<BillingReadPort, 'listSubscriptions'> {
  return {
    listSubscriptions: (...args: Parameters<BillingReadPort['listSubscriptions']>) => repository.listSubscriptions(...args),
  };
}
