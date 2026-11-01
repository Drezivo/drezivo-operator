import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../shared/http/errors.js';
import { tenantAdminPermissions } from '../../shared/auth/operator-permission-codes.js';
import type { ConsoleDbContext } from '../../infrastructure/db/console-context.js';
import { idempotencyKey } from '../clients/administration/contracts.js';

/**
 * Announcements: one email from the operators to every client business (maintenance windows,
 * product updates). The business database records the announcement and queues one job per
 * business in one transaction (migration 0094); the business worker sends each email to the
 * business's contact address. A repeated Idempotency-Key returns the same announcement.
 */
export const announcementInputSchema = z.object({
  subject: z.string().trim().min(1, 'Add a subject.').max(160, 'Keep the subject under 160 characters.'),
  body: z.string().trim().min(1, 'Write the message.').max(5000, 'Keep the message under 5,000 characters.'),
}).strict();
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const announcementSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  body: z.string(),
  created_by: z.string(),
  recipient_count: z.number().int().nonnegative(),
  created_at: z.string(),
  delivered: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type Announcement = z.infer<typeof announcementSchema>;
export const sentAnnouncementSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  recipient_count: z.number().int().nonnegative(),
  created_at: z.string(),
  replayed: z.boolean(),
});
export type SentAnnouncement = z.infer<typeof sentAnnouncementSchema>;

export type AnnouncementsPort = {
  list(): Promise<Announcement[]>;
  send(input: AnnouncementInput, context: { operatorSubject: string; idempotencyKey: string; requestId: string }): Promise<SentAnnouncement>;
};

const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Announcements are not configured.');
export const unavailableAnnouncementsPort: AnnouncementsPort = {
  list: async () => { throw unavailable(); },
  send: async () => { throw unavailable(); },
};

const LIST_LIMIT = 50;

export function createAnnouncementsDbAdapter(db: ConsoleDbContext): AnnouncementsPort {
  return {
    async list() {
      const data = await db.transaction('announcements', false, async (client) => (
        await client.query<{ data: unknown }>('SELECT operator_announcements($1) AS data', [LIST_LIMIT])
      ).rows[0]?.data);
      const parsed = z.array(announcementSchema).safeParse(data);
      if (!parsed.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The announcement history is invalid.');
      return parsed.data;
    },
    async send(input, context) {
      const data = await db.transaction(context.operatorSubject, true, async (client) => (
        await client.query<{ data: unknown }>(
          'SELECT operator_send_announcement($1, $2, $3, $4, $5) AS data',
          [context.operatorSubject, context.idempotencyKey, context.requestId, input.subject, input.body],
        )
      ).rows[0]?.data);
      const parsed = sentAnnouncementSchema.safeParse(data);
      if (!parsed.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The announcement result is invalid.');
      return parsed.data;
    },
  };
}

export function createAnnouncementsRouter(
  port: AnnouncementsPort = unavailableAnnouncementsPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: { permissionMiddleware?: (permission: string) => RequestHandler } = {},
): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const send = (res: Response, status: number, data: unknown) =>
    res.status(status).setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: String(res.locals.requestId ?? 'unknown') });
  const forward = (next: NextFunction, error: unknown) =>
    next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Announcements are temporarily unavailable.', { cause: error }));

  router.use('/announcements', authorize);
  router.get('/announcements', permission(tenantAdminPermissions.read), async (_req, res, next) => {
    try { send(res, 200, { items: await port.list() }); } catch (error) { forward(next, error); }
  });
  router.post('/announcements', permission(tenantAdminPermissions.manage), async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key')?.trim() ?? '';
      if (!idempotencyKey.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
      const input = announcementInputSchema.safeParse(req.body);
      if (!input.success) throw new AppError(400, 'VALIDATION_FAILED', input.error.issues[0]?.message ?? 'The announcement is invalid.');
      const subject = res.locals.operatorPrincipal?.clerkUserId;
      if (typeof subject !== 'string' || subject.length === 0) throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
      const sent = await port.send(input.data, { operatorSubject: subject, idempotencyKey: key, requestId: String(res.locals.requestId ?? 'unknown') });
      send(res, sent.replayed ? 200 : 201, sent);
    } catch (error) { forward(next, error); }
  });
  return router;
}
