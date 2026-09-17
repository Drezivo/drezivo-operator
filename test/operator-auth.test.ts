import { describe, expect, it } from 'vitest';
import type { AppError } from '../src/errors.js';
import { authorizeOperator } from '../src/operator-auth.js';

const expectedOrganizationId = 'org_drezivo_operations';
const verified = { isAuthenticated: true, userId: 'user_123', orgId: expectedOrganizationId };

describe('operator authorization', () => {
  it('rejects a verified user from a business organization', async () => {
    await expect(authorizeOperator({ ...verified, orgId: 'org_business_tenant' }, expectedOrganizationId, 'req_1'))
      .rejects.toMatchObject({ status: 403, code: 'OPERATOR_ACCESS_REQUIRED' } satisfies Partial<AppError>);
  });

  it('keeps the local authorization seam closed by default', async () => {
    await expect(authorizeOperator(verified, expectedOrganizationId, 'req_2'))
      .rejects.toMatchObject({ status: 403, code: 'OPERATOR_ACCESS_REQUIRED' } satisfies Partial<AppError>);
  });

  it('returns only the safe principal after local authorization approves', async () => {
    const principal = await authorizeOperator(verified, expectedOrganizationId, 'req_3', async (candidate) => {
      expect(candidate).toEqual({ clerkUserId: 'user_123', operatorOrganizationId: expectedOrganizationId });
      return true;
    });
    expect(principal).toEqual({
      clerkUserId: 'user_123',
      operatorOrganizationId: expectedOrganizationId,
      requestId: 'req_3',
    });
    expect(Object.keys(principal).sort()).toEqual(['clerkUserId', 'operatorOrganizationId', 'requestId'].sort());
  });
});
