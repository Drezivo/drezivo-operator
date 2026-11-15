import { describe, expect, it, vi } from 'vitest';
import { buildAnalytics } from '../src/features/analytics/repository/postgres.js';
import { createAnalyticsDbAdapter } from '../src/features/analytics/repository/console-read.js';
import type { ConsoleDbContext } from '../src/infrastructure/db/console-context.js';

const snapshot = { businesses: [], memberships: [], events: [], subscriptions: { active: 0, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 }, run_rate: [] };

describe('analytics database adapter', () => {
  it.each([6, 12, 24, 36, 48])('builds %i complete Manila months', (months) => {
    const data = buildAnalytics(snapshot, months, new Date('2026-09-25T00:00:00Z'));
    expect(data.period.months).toBe(months);
    expect(data.series.new_businesses).toHaveLength(months);
    expect(data.series.new_businesses.at(-1)?.month).toBe('2026-08');
  });
  it('keeps synthetic paid businesses separate from live counts', async () => {
    const query = vi.fn(async () => ({ rows: [{ count: 3 }] }));
    const transaction = vi.fn(async (_subject: string, _write: boolean, action: (client: { query: typeof query }) => Promise<unknown>) => action({ query }));
    const db = { transaction } as unknown as ConsoleDbContext;
    const live = await createAnalyticsDbAdapter(db).getPaidBusinesses!();
    const synthetic = await createAnalyticsDbAdapter(db, true).getPaidBusinesses!();
    expect(live).toEqual({ count: 3, synthetic_count: null });
    expect(synthetic).toEqual({ count: 0, synthetic_count: 3 });
    expect(query).toHaveBeenCalledWith('SELECT operator_private.paid_business_count() AS count');
  });
});
