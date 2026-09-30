import { describe, expect, it } from 'vitest';
import { createProofLinkSigner, PROOF_LINK_TTL_SECONDS, signProofLink } from '../src/proof-link.js';

// Same vector as the business repository's api/src/modules/billing/__tests__/operator-proof-link.test.ts.
// If either side changes the format, one of the two tests fails.
const SHARED_VECTOR =
  'p1.550e8400-e29b-41d4-a716-446655440000.750e8400-e29b-41d4-a716-446655440000.1790812800.hoJ16R8mj0g7JAbv17giTQoJPtwVtPcCQe3QZUQCBHA';
const secret = 'operator-proof-link-test-secret-0123456789';

describe('proof links for the business API', () => {
  it('signs the shared vector, lowercasing ids and expiring five minutes after now', () => {
    const now = new Date(Date.UTC(2026, 9, 1) - PROOF_LINK_TTL_SECONDS * 1000);
    const link = signProofLink({
      tenantId: '550E8400-E29B-41D4-A716-446655440000',
      paymentId: '750e8400-e29b-41d4-a716-446655440000',
      secret,
      now,
    });
    expect(link.token).toBe(SHARED_VECTOR);
    expect(link.expiresAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('points the router link at the business API proof route', () => {
    const now = new Date(Date.UTC(2026, 9, 1) - PROOF_LINK_TTL_SECONDS * 1000);
    const signer = createProofLinkSigner({ secret, businessApiUrl: 'https://api.drezivo.shop/', now: () => now });
    expect(signer('550e8400-e29b-41d4-a716-446655440000', '750e8400-e29b-41d4-a716-446655440000')).toEqual({
      url: `https://api.drezivo.shop/api/v1/operator/payment-proofs/${SHARED_VECTOR}`,
      expires_at: '2026-10-01T00:00:00.000Z',
    });
  });
});
