import type { TenantAdminPort } from './contracts.js';

export type ClientAdministrationRepository = Pick<TenantAdminPort, 'listTenants' | 'listPeople' | 'getTenant' | 'changeSubscriptionPlan' | 'updateProfile' | 'setTenantLocked' | 'setMemberSuspended' | 'addNote'>;

export function createClientAdministrationService(repository: ClientAdministrationRepository): ClientAdministrationRepository {
  return {
    listTenants: (...args: Parameters<TenantAdminPort['listTenants']>) => repository.listTenants(...args),
    listPeople: (...args: Parameters<TenantAdminPort['listPeople']>) => repository.listPeople(...args),
    getTenant: (...args: Parameters<TenantAdminPort['getTenant']>) => repository.getTenant(...args),
    changeSubscriptionPlan: (...args: Parameters<TenantAdminPort['changeSubscriptionPlan']>) => repository.changeSubscriptionPlan(...args),
    updateProfile: (...args: Parameters<TenantAdminPort['updateProfile']>) => repository.updateProfile(...args),
    setTenantLocked: (...args: Parameters<TenantAdminPort['setTenantLocked']>) => repository.setTenantLocked(...args),
    setMemberSuspended: (...args: Parameters<TenantAdminPort['setMemberSuspended']>) => repository.setMemberSuspended(...args),
    addNote: (...args: Parameters<TenantAdminPort['addNote']>) => repository.addNote(...args),
  };
}
