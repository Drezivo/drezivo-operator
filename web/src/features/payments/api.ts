export const paymentPaths = {
  payments: (status: "pending" | "recent") => `/subscription-payments?status=${status}`,
  tenantPayments: (id: string) => `/tenants/${encodeURIComponent(id)}/subscription-payments`,
  reviewPayment: (id: string, paymentId: string, decision: "approve" | "reject") =>
    `/tenants/${encodeURIComponent(id)}/subscription-payments/${encodeURIComponent(paymentId)}/${decision}`,
  proofLink: (id: string, paymentId: string) =>
    `/tenants/${encodeURIComponent(id)}/subscription-payments/${encodeURIComponent(paymentId)}/proof-link`,
} as const;
