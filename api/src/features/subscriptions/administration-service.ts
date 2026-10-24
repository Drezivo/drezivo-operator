import type { TenantAdminPort } from '../clients/administration/contracts.js';

export type SubscriptionAdministrationRepository = Pick<TenantAdminPort, 'setTrialEnd' | 'activateSubscription' | 'extendReadOnly'>;

export function createSubscriptionAdministrationService(repository: SubscriptionAdministrationRepository): SubscriptionAdministrationRepository {
  return {
    setTrialEnd: (...args: Parameters<TenantAdminPort['setTrialEnd']>) => repository.setTrialEnd(...args),
    activateSubscription: (...args: Parameters<TenantAdminPort['activateSubscription']>) => repository.activateSubscription(...args),
    extendReadOnly: (...args: Parameters<TenantAdminPort['extendReadOnly']>) => repository.extendReadOnly(...args),
  };
}
