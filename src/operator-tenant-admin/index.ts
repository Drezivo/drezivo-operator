import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { emptyBusinessUserDirectory, type BusinessUserDirectory, type BusinessUserProfile } from '../integrations/business-user-directory/index.js';

/**
 * Operator MVP for the first client businesses: list and view businesses and their staff, and run
 * the few lifecycle actions an operator needs before the business API exposes operator commands
 * (ADR 0025). Every mutation is keyed by an Idempotency-Key so a retry replays instead of acting twice.
 */

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const reason = z.string().trim().min(3).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const isoDate = z.string().datetime({ offset: true });
const businessName = z.string().trim().min(2).max(120).regex(/^[^\u0000-\u001f\u007f]*$/);
const timezone = z.string().trim().min(3).max(64).refine((value) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}, 'Unknown IANA time zone.');

export const tenantStatusSchema = z.enum(['active', 'restricted', 'cancelled']);
export const subscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']);
export const membershipStatusSchema = z.enum(['active', 'suspended', 'removed']);

export type TenantSummary = {
  tenant_id: string;
  name: string;
  slug: string;
  status: z.infer<typeof tenantStatusSchema>;
  timezone: string;
  created_at: string;
  subscription: {
    status: z.infer<typeof subscriptionStatusSchema>;
    plan_code: string;
    trial_ends_at: string | null;
    grace_ends_at: string | null;
    current_period_end: string;
  } | null;
  member_counts: { active: number; suspended: number; removed: number };
};

export type TenantMember = {
  membership_id: string;
  clerk_user_id: string;
  role: 'owner' | 'frontdesk';
  status: z.infer<typeof membershipStatusSchema>;
  created_at: string;
  /** Name/email from the business Clerk instance; null when unknown or the directory is not configured. */
  profile?: BusinessUserProfile | null;
};

export type PersonRow = Omit<TenantMember, 'profile'> & { tenant_id: string; tenant_name: string; tenant_status: z.infer<typeof tenantStatusSchema> };

export type TenantAuditEntry = {
  occurred_at: string;
  actor_kind: string;
  action: string;
  entity_type: string;
  outcome: string;
};

export type TenantDetail = TenantSummary & { members: TenantMember[]; recent_audit: TenantAuditEntry[] };

export type CommandContext = { operatorSubject: string; idempotencyKey: string; requestId: string; reason: string };
export type CommandResult = { tenant: TenantDetail; changed: boolean; replayed: boolean };

export const profileInputSchema = z.object({ name: businessName.optional(), timezone: timezone.optional(), reason }).strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined, 'Provide a name or a timezone to change.');
export const reasonInputSchema = z.object({ reason }).strict();
export const trialInputSchema = z.object({ trial_ends_at: isoDate, reason }).strict();
export const activateInputSchema = z.object({ current_period_end: isoDate, reason }).strict();

export type TenantAdminPort = {
  listTenants(): Promise<TenantSummary[]>;
  listPeople(): Promise<PersonRow[]>;
  getTenant(tenantId: string): Promise<TenantDetail | null>;
  updateProfile(tenantId: string, change: { name?: string; timezone?: string }, context: CommandContext): Promise<CommandResult>;
  setTenantLocked(tenantId: string, locked: boolean, context: CommandContext): Promise<CommandResult>;
  setMemberSuspended(tenantId: string, membershipId: string, suspended: boolean, context: CommandContext): Promise<CommandResult>;
  setTrialEnd(tenantId: string, trialEndsAt: Date, context: CommandContext): Promise<CommandResult>;
  activateSubscription(tenantId: string, currentPeriodEnd: Date, context: CommandContext): Promise<CommandResult>;
};

const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is not configured.');
export const unavailableTenantAdminPort: TenantAdminPort = {
  listTenants: async () => { throw unavailable(); },
  listPeople: async () => { throw unavailable(); },
  getTenant: async () => { throw unavailable(); },
  updateProfile: async () => { throw unavailable(); },
  setTenantLocked: async () => { throw unavailable(); },
  setMemberSuspended: async () => { throw unavailable(); },
  setTrialEnd: async () => { throw unavailable(); },
  activateSubscription: async () => { throw unavailable(); },
};

export const tenantAdminPermissions = { read: 'tenant.admin.read', manage: 'tenant.admin.manage' } as const;

/** Trial and paid periods are bounded so a typo cannot grant years of free service. */
export const MAX_TRIAL_DAYS_AHEAD = 90;
export const MAX_PERIOD_DAYS_AHEAD = 400;

type Options = { permissionMiddleware?: (permission: string) => RequestHandler; now?: () => Date; directory?: BusinessUserDirectory };

function requestId(res: Response): string { return String(res.locals.requestId ?? 'unknown'); }
function tenantIdParam(req: Request): string {
  const value = typeof req.params.tenantId === 'string' ? req.params.tenantId : '';
  if (!uuid.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'The business identifier is invalid.');
  return value;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', message);
  return parsed.data;
}
function context(req: Request, res: Response, reasonText: string): CommandContext {
  const key = req.get('Idempotency-Key');
  if (!key || !idempotencyKey.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
  const subject = res.locals.operatorPrincipal?.clerkUserId;
  if (typeof subject !== 'string' || subject.length === 0) throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  return { operatorSubject: subject, idempotencyKey: key.trim(), requestId: requestId(res), reason: reasonText };
}
function futureWithin(value: string, days: number, now: Date, field: string): Date {
  const date = new Date(value);
  const max = new Date(now.getTime() + days * 86_400_000);
  if (date.getTime() <= now.getTime() || date.getTime() > max.getTime()) {
    throw new AppError(400, 'VALIDATION_FAILED', `${field} must be in the future and at most ${days} days ahead.`);
  }
  return date;
}
function send(res: Response, status: number, data: unknown): void {
  res.status(status).setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: requestId(res) });
}
function forward(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is temporarily unavailable.'));
}

export function createOperatorTenantAdminRouter(
  port: TenantAdminPort = unavailableTenantAdminPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
): Router {
  const router = express.Router();
  const now = options.now ?? (() => new Date());
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const directory = options.directory ?? emptyBusinessUserDirectory;
  const withProfiles = async (tenant: TenantDetail): Promise<TenantDetail> => {
    const profiles = await directory.lookup(tenant.members.map((member) => member.clerk_user_id));
    return { ...tenant, members: tenant.members.map((member) => ({ ...member, profile: profiles.get(member.clerk_user_id) ?? null })) };
  };
  const command = async (result: CommandResult) => ({ ...result, tenant: await withProfiles(result.tenant) });
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  router.use('/tenants', authorize);
  router.use('/people', authorize);

  router.get('/people', read, async (_req, res, next) => {
    try {
      const people = await port.listPeople();
      const profiles = await directory.lookup(people.map((person) => person.clerk_user_id));
      send(res, 200, { items: people.map((person) => ({ ...person, profile: profiles.get(person.clerk_user_id) ?? null })) });
    } catch (error) { forward(next, error); }
  });

  router.get('/tenants', read, async (_req, res, next) => {
    try { send(res, 200, { items: await port.listTenants() }); } catch (error) { forward(next, error); }
  });

  router.get('/tenants/:tenantId', read, async (req, res, next) => {
    try {
      const tenant = await port.getTenant(tenantIdParam(req));
      if (!tenant) throw new AppError(404, 'NOT_FOUND', 'The business was not found.');
      send(res, 200, await withProfiles(tenant));
    } catch (error) { forward(next, error); }
  });

  router.post('/tenants/:tenantId/profile', manage, async (req, res, next) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(profileInputSchema, req.body, 'Provide a valid name or IANA time zone and a reason.');
      const { reason: text, ...change } = input;
      send(res, 200, await command(await port.updateProfile(tenantId, change, context(req, res, text))));
    } catch (error) { forward(next, error); }
  });

  for (const [path, locked] of [['lock', true], ['unlock', false]] as const) {
    router.post(`/tenants/:tenantId/${path}`, manage, async (req, res, next) => {
      try {
        const tenantId = tenantIdParam(req);
        const input = parse(reasonInputSchema, req.body, 'A reason of 3 to 500 characters is required.');
        send(res, 200, await command(await port.setTenantLocked(tenantId, locked, context(req, res, input.reason))));
      } catch (error) { forward(next, error); }
    });
  }

  for (const [path, suspended] of [['suspend', true], ['reactivate', false]] as const) {
    router.post(`/tenants/:tenantId/members/:membershipId/${path}`, manage, async (req, res, next) => {
      try {
        const tenantId = tenantIdParam(req);
        const membershipId = typeof req.params.membershipId === 'string' ? req.params.membershipId : '';
        if (!uuid.safeParse(membershipId).success) throw new AppError(400, 'VALIDATION_FAILED', 'The member identifier is invalid.');
        const input = parse(reasonInputSchema, req.body, 'A reason of 3 to 500 characters is required.');
        send(res, 200, await command(await port.setMemberSuspended(tenantId, membershipId, suspended, context(req, res, input.reason))));
      } catch (error) { forward(next, error); }
    });
  }

  router.post('/tenants/:tenantId/trial', manage, async (req, res, next) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(trialInputSchema, req.body, 'Provide trial_ends_at as an ISO date-time and a reason.');
      const end = futureWithin(input.trial_ends_at, MAX_TRIAL_DAYS_AHEAD, now(), 'The trial end');
      send(res, 200, await command(await port.setTrialEnd(tenantId, end, context(req, res, input.reason))));
    } catch (error) { forward(next, error); }
  });

  router.post('/tenants/:tenantId/activate', manage, async (req, res, next) => {
    try {
      const tenantId = tenantIdParam(req);
      const input = parse(activateInputSchema, req.body, 'Provide current_period_end as an ISO date-time and a reason.');
      const end = futureWithin(input.current_period_end, MAX_PERIOD_DAYS_AHEAD, now(), 'The paid period end');
      send(res, 200, await command(await port.activateSubscription(tenantId, end, context(req, res, input.reason))));
    } catch (error) { forward(next, error); }
  });

  return router;
}
