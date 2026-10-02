import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AppError } from '../src/errors.js';
import { authorizeOperator, createBearerOnlyClerkContext, mapClerkProviderError } from '../src/operator-auth.js';

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
      expect(candidate).toMatchObject({ clerkUserId: 'user_123', operatorOrganizationId: expectedOrganizationId });
      return { active: true, roles: ['platform_owner'] };
    });
    expect(principal).toEqual({
      clerkUserId: 'user_123',
      operatorOrganizationId: expectedOrganizationId,
      roles: ['platform_owner'],
      requestId: 'req_3',
    });
    expect(Object.keys(principal).sort()).toEqual(['clerkUserId', 'operatorOrganizationId', 'roles', 'requestId'].sort());
  });

  it('does not let Clerk authenticate an API request from browser cookies', async () => {
    let clerkSawCookie: string | undefined;
    let clerkSawAuthorization: string | undefined;
    const middleware = createBearerOnlyClerkContext((req, _res, next) => {
      clerkSawCookie = req.headers.cookie;
      clerkSawAuthorization = req.headers.authorization;
      next();
    });
    const server = express();
    server.use(middleware);
    server.get('/', (req, res) => res.json({ cookieRestored: req.headers.cookie }));

    const response = await request(server).get('/').set('Cookie', 'session=browser-session').set('Authorization', 'Bearer api-token');
    expect(response.status).toBe(200);
    expect(clerkSawCookie).toBeUndefined();
    expect(clerkSawAuthorization).toBe('Bearer api-token');
    expect(response.body.cookieRestored).toBe('session=browser-session');
  });

  it('maps invalid provider credentials to a safe 401', () => {
    expect(mapClerkProviderError({ status: 401, code: 'token_invalid' })).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('maps provider dependency failures to a safe 503', () => {
    expect(mapClerkProviderError({ status: 503, code: 'upstream_timeout' })).toMatchObject({
      status: 503,
      code: 'OPERATOR_AUTH_UNAVAILABLE',
    });
  });
});
