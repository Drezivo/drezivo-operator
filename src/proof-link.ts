import { createHmac } from 'node:crypto';
import type { ProofLinkSigner } from './operator-tenant-admin/index.js';

/**
 * Signs a 5-minute link that opens a business's proof of payment on the business API
 * (GET /api/v1/operator/payment-proofs/<token>), after this API has authorized the operator.
 * Format and verification live in the business repository: api/src/modules/billing/operator-proof-link.ts.
 */
export const PROOF_LINK_TTL_SECONDS = 5 * 60;

export function signProofLink(input: { tenantId: string; paymentId: string; secret: string; now?: Date }): { token: string; expiresAt: Date } {
  const expiresAt = new Date((Math.floor((input.now ?? new Date()).getTime() / 1000) + PROOF_LINK_TTL_SECONDS) * 1000);
  // The business API accepts lowercase UUIDs only.
  const payload = `p1.${input.tenantId.toLowerCase()}.${input.paymentId.toLowerCase()}.${Math.floor(expiresAt.getTime() / 1000)}`;
  const signature = createHmac('sha256', input.secret).update(payload, 'utf8').digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

/** The router's signer: a link on the business API that redirects to the stored proof. */
export function createProofLinkSigner(input: { secret: string; businessApiUrl: string; now?: () => Date }): ProofLinkSigner {
  return (tenantId, paymentId) => {
    const { token, expiresAt } = signProofLink({ tenantId, paymentId, secret: input.secret, now: input.now?.() });
    const url = new URL(`/api/v1/operator/payment-proofs/${token}`, input.businessApiUrl);
    return { url: url.toString(), expires_at: expiresAt.toISOString() };
  };
}
