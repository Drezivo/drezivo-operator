import type { SessionAuditPort } from './contracts.js';

export function createSessionService(repository: SessionAuditPort | undefined) {
  return {
    async recordEvent(input: Parameters<SessionAuditPort['record']>[0]) {
      return repository?.record(input);
    },
    async recordWebhookEvent(input: Parameters<SessionAuditPort['record']>[0]) {
      return repository?.record(input);
    },
    async isKnown(subject: string, sessionId: string) {
      return repository?.isKnown(subject, sessionId) ?? false;
    },
  };
}
