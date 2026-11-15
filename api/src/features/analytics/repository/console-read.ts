import type { AnalyticsReadPort } from '../index.js';
import { buildAnalytics } from './postgres.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createAnalyticsDbAdapter(db: ConsoleDbContext, synthetic = false): AnalyticsReadPort {
  return {
    async getPaidBusinesses() {
      const count = await db.transaction('analytics', false, async (client) => {
        const result = await client.query<{ count: number }>('SELECT operator_private.paid_business_count() AS count');
        const value = result.rows[0]?.count;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid paid business count.');
        return value;
      });
      return synthetic ? { count: 0, synthetic_count: count } : { count, synthetic_count: null };
    },
    async getAnalytics({ months }) {
      return buildAnalytics(await db.projection('analytics', {}), months, new Date(), synthetic);
    },
  };
}
