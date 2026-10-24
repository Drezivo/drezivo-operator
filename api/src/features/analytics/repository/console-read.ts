import type { AnalyticsReadPort } from '../index.js';
import { buildAnalytics } from './postgres.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createAnalyticsDbAdapter(db: ConsoleDbContext, synthetic = false): AnalyticsReadPort {
  return {
    async getAnalytics({ months }) {
      return buildAnalytics(await db.projection('analytics', {}), months, new Date(), synthetic);
    },
  };
}
