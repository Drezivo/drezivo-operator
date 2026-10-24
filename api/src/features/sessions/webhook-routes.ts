import express, { type RequestHandler } from 'express';
import type { SessionAuditPort } from './contracts.js';
import { createSessionWebhookController } from './webhook-controller.js';

export function createSessionWebhookRouter(repository: SessionAuditPort | undefined, signingSecret: string | undefined, rateLimit: RequestHandler) {
  const router = express.Router();
  router.post('/webhooks/operator-clerk', rateLimit, express.raw({ type: 'application/json', limit: '64kb' }), createSessionWebhookController(repository, signingSecret));
  return router;
}
