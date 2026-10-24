import type { WorkspacePort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createWorkspaceService(repository: WorkspacePort): WorkspacePort {
  return {
    execute: (...args: Parameters<WorkspacePort['execute']>) => repository.execute(...args),
  };
}
