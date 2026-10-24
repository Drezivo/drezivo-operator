import type { OperationsPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createOperationsService(repository: OperationsPort): OperationsPort {
  return {
    listJobs: (...args: Parameters<OperationsPort['listJobs']>) => repository.listJobs(...args),
    listNotifications: (...args: Parameters<OperationsPort['listNotifications']>) => repository.listNotifications(...args),
  };
}
