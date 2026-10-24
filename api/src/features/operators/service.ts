import type { OperatorDirectoryPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createOperatorDirectoryService(repository: OperatorDirectoryPort): OperatorDirectoryPort {
  return {
    listOperators: (...args: Parameters<OperatorDirectoryPort['listOperators']>) => repository.listOperators(...args),
  };
}
