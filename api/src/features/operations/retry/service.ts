import type { OperationsRetryCommandPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createOperationsRetryCommandService(repository: OperationsRetryCommandPort): OperationsRetryCommandPort {
  return {
    retryJob: (...args: Parameters<OperationsRetryCommandPort['retryJob']>) => repository.retryJob(...args),
    retryNotification: (...args: Parameters<OperationsRetryCommandPort['retryNotification']>) => repository.retryNotification(...args),
  };
}
