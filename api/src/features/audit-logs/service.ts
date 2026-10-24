import type { AuditPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createAuditService(repository: AuditPort): AuditPort {
  return {
    listAuditEvents: (...args: Parameters<AuditPort['listAuditEvents']>) => repository.listAuditEvents(...args),
  };
}
