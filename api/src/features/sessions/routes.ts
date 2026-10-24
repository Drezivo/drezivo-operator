import express, { type RequestHandler } from 'express';
import type { SessionAuditPort } from './contracts.js';
import { createSessionController } from './controller.js';

export function createOperatorConsoleRouter(
  ports: { session?: SessionAuditPort },
  authorize: RequestHandler,
  _permission: (permission: string) => RequestHandler,
) {
  const router = express.Router();
  const controller = createSessionController(ports.session);
  router.use(authorize);
  router.get('/session', controller.show);
  router.post('/session/events', controller.record);
  return router;
}
