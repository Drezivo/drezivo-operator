import type { TenantAdminPort } from '../clients/administration/contracts.js';

export type PaymentAdministrationRepository = Pick<TenantAdminPort, 'listPayments' | 'listTenantPayments' | 'reviewPayment'>;

export function createPaymentAdministrationService(repository: PaymentAdministrationRepository): PaymentAdministrationRepository {
  return {
    listPayments: (...args: Parameters<TenantAdminPort['listPayments']>) => repository.listPayments(...args),
    listTenantPayments: (...args: Parameters<TenantAdminPort['listTenantPayments']>) => repository.listTenantPayments(...args),
    reviewPayment: (...args: Parameters<TenantAdminPort['reviewPayment']>) => repository.reviewPayment(...args),
  };
}
