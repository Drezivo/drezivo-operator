import { describe, expect, it } from 'vitest';
import { createSupportActivityReadAdapter } from '../src/integrations/support-activity/index.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const eventId = '650e8400-e29b-41d4-a716-446655440000';
const occurredAt = '2026-01-01T00:00:00.000Z';
const activity = { event_id: eventId, tenant_id: tenantId, occurred_at: occurredAt, actor_kind: 'operator', actor_key: 'operator-1', action: 'grant.revoke', entity_type: 'support_grant', entity_id: eventId, support_grant_id: eventId, outcome: 'succeeded', request_id: 'req-1', redacted_summary: 'Grant revoked' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('support activity adapter contract', () => {
  it('forwards exact filters, limit, cursor, auth, and request ID', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/internal/operator/v1/support-activity');
      expect(Object.fromEntries(parsed.searchParams)).toEqual({ tenant_id: tenantId, actor_kind: 'operator', action: 'grant.revoke', entity_type: 'support_grant', outcome: 'succeeded', occurred_from: occurredAt, occurred_to: '2026-01-02T00:00:00.000Z', limit: '25', cursor_occurred_at: occurredAt, cursor_event_id: eventId });
      expect(init?.headers).toEqual({ Accept: 'application/json', 'X-Request-ID': 'req-1', Authorization: 'Bearer internal' });
      return response({ success: true, data: { items: [activity], next_cursor: null } });
    };
    const adapter = createSupportActivityReadAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl });
    await expect(adapter.listSupportActivity({ filters: { tenant_id: tenantId, actor_kind: 'operator', action: 'grant.revoke', entity_type: 'support_grant', outcome: 'succeeded', occurred_from: occurredAt, occurred_to: '2026-01-02T00:00:00.000Z' }, limit: 25, cursor: { occurredAt, eventId }, requestId: 'req-1' })).resolves.toEqual({ items: [activity], next_cursor: null });
  });

  it('maps malformed and unavailable upstream responses safely', async () => {
    const make = (body: unknown, status = 200) => createSupportActivityReadAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl: async () => response(body, status) });
    await expect(make({ success: true, data: { items: [{ ...activity, secret: 'x' }], next_cursor: null } }).listSupportActivity({ filters: {}, limit: 10, cursor: null, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(make({ error: 'secret' }, 503).listSupportActivity({ filters: {}, limit: 10, cursor: null, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
