import type { BillingReadPort } from '../subscriptions/contracts.js';

export type AssignedPlansRepository = Pick<BillingReadPort, 'getEntitlements'>;

export function createAssignedPlansService(repository: AssignedPlansRepository) {
  return (input: Parameters<BillingReadPort['getEntitlements']>[0]) => repository.getEntitlements(input);
}
