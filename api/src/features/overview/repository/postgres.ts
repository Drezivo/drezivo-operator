import { operatorOverviewSchema, type ReadPort } from '../../clients/contracts.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createOverviewDbRepository(db: ConsoleDbContext): Pick<ReadPort, 'overview'> {
  return {
    async overview() {
      return operatorOverviewSchema.parse(await db.projection('overview', {}));
    },
  };
}
