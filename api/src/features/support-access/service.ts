import type { SupportGrantCommandPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createSupportGrantCommandService(repository: SupportGrantCommandPort): SupportGrantCommandPort {
  return {
    createSupportGrant: (...args: Parameters<SupportGrantCommandPort['createSupportGrant']>) => repository.createSupportGrant(...args),
    revokeSupportGrant: (...args: Parameters<SupportGrantCommandPort['revokeSupportGrant']>) => repository.revokeSupportGrant(...args),
  };
}
