import type { TenantAdminPort } from '../clients/administration/contracts.js';

export type PaymentAdministrationRepository = Pick<TenantAdminPort, 'listPayments' | 'reviewPayment'>;

export function createPaymentAdministrationService(repository: PaymentAdministrationRepository): PaymentAdministrationRepository {
  return {
    listPayments: (...args: Parameters<TenantAdminPort['listPayments']>) => repository.listPayments(...args),
    reviewPayment: (...args: Parameters<TenantAdminPort['reviewPayment']>) => repository.reviewPayment(...args),
  };
}
