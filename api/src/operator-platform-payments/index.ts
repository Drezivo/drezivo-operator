import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { tenantAdminPermissions } from '../operator-tenant-admin/index.js';

/**
 * Drezivo's own payment methods (GCash, bank transfer, ...) that businesses pay the ₱300 Standard
 * subscription to. The business app shows the active ones, in sort order, with their QR image.
 * Global rows (no tenant); every write is idempotent and recorded in platform_payment_method_change.
 */
export const MAX_ACTIVE_PLATFORM_PAYMENT_METHODS = 10;
export const MAX_QR_BYTES = 512 * 1024;

export type QrMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type PlatformPaymentMethod = {
  id: string;
  label: string;
  account_name: string | null;
  account_number: string | null;
  instructions: string | null;
  has_qr: boolean;
  active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
};

export type PlatformPaymentCommandContext = { operatorSubject: string; idempotencyKey: string; requestId: string; reason: string };
export type PlatformPaymentCommandResult = { method: PlatformPaymentMethod; changed: boolean; replayed: boolean };
export type QrImage = { bytes: Buffer; mime: QrMime };

export type PlatformPaymentMethodFields = {
  label: string;
  account_name: string | null;
  account_number: string | null;
  instructions: string | null;
  sort_order: number;
};

export type PlatformPaymentsPort = {
  list(): Promise<PlatformPaymentMethod[]>;
  readQr(id: string): Promise<QrImage | null>;
  create(fields: PlatformPaymentMethodFields, qr: QrImage | null, context: PlatformPaymentCommandContext): Promise<PlatformPaymentCommandResult>;
  /** `qr` undefined keeps the stored image, null removes it. */
  update(id: string, version: number, fields: PlatformPaymentMethodFields, qr: QrImage | null | undefined, context: PlatformPaymentCommandContext): Promise<PlatformPaymentCommandResult>;
  setActive(id: string, version: number, active: boolean, context: PlatformPaymentCommandContext): Promise<PlatformPaymentCommandResult>;
};

const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment method administration is not configured.');
export const unavailablePlatformPaymentsPort: PlatformPaymentsPort = {
  list: async () => { throw unavailable(); },
  readQr: async () => { throw unavailable(); },
  create: async () => { throw unavailable(); },
  update: async () => { throw unavailable(); },
  setActive: async () => { throw unavailable(); },
};

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const singleLine = /^[^\u0000-\u001f\u007f]*$/;
const multiLine = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const reason = z.string().trim().min(3).max(500).regex(singleLine);
const optionalText = (max: number, pattern: RegExp) =>
  z.string().trim().max(max).regex(pattern).nullable().optional().transform((value) => (value ? value : null));
// Base64 of at most MAX_QR_BYTES bytes (4 characters per 3 bytes, padded).
const qrInput = z.object({ data_base64: z.string().min(4).max(Math.ceil(MAX_QR_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const fields = {
  label: z.string().trim().min(1).max(80).regex(singleLine),
  account_name: optionalText(160, singleLine),
  account_number: optionalText(120, singleLine),
  instructions: optionalText(1000, multiLine),
  sort_order: z.number().int().min(0).max(1000).default(0),
};
export const createInputSchema = z.object({ ...fields, qr: qrInput.nullable().default(null), reason }).strict();
export const updateInputSchema = z.object({ ...fields, version: z.number().int().positive(), qr: qrInput.nullable().optional(), reason }).strict();
export const toggleInputSchema = z.object({ version: z.number().int().positive(), reason }).strict();

/** The type comes from the file's own bytes; a client-declared type is never trusted. */
export function detectQrMime(bytes: Buffer): QrMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeQr(input: z.infer<typeof qrInput>): QrImage {
  const bytes = Buffer.from(input.data_base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_QR_BYTES) throw new AppError(400, 'VALIDATION_FAILED', 'The QR image must be at most 512 KB.');
  const mime = detectQrMime(bytes);
  if (!mime) throw new AppError(400, 'VALIDATION_FAILED', 'The QR image must be a PNG, JPEG, or WebP file.');
  return { bytes, mime };
}

function requestIdOf(res: Response): string { return String(res.locals.requestId ?? 'unknown'); }
function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', message);
  return parsed.data;
}
function methodId(req: Request): string {
  const value = typeof req.params.methodId === 'string' ? req.params.methodId : '';
  if (!uuid.safeParse(value).success) throw new AppError(400, 'VALIDATION_FAILED', 'The payment method identifier is invalid.');
  return value;
}
function context(req: Request, res: Response, reasonText: string): PlatformPaymentCommandContext {
  const key = req.get('Idempotency-Key');
  if (!key || !idempotencyKey.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.');
  const subject = res.locals.operatorPrincipal?.clerkUserId;
  if (typeof subject !== 'string' || subject.length === 0) throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  return { operatorSubject: subject, idempotencyKey: key.trim(), requestId: requestIdOf(res), reason: reasonText };
}
function send(res: Response, status: number, data: unknown): void {
  res.status(status).setHeader('Cache-Control', 'no-store').json({ success: true, data, request_id: requestIdOf(res) });
}
function forward(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment method administration is temporarily unavailable.', { cause: error }));
}
const fieldsOf = (input: z.infer<typeof createInputSchema> | z.infer<typeof updateInputSchema>): PlatformPaymentMethodFields => ({
  label: input.label, account_name: input.account_name, account_number: input.account_number, instructions: input.instructions, sort_order: input.sort_order,
});

type Options = { permissionMiddleware?: (permission: string) => RequestHandler };

export function createOperatorPlatformPaymentsRouter(
  port: PlatformPaymentsPort = unavailablePlatformPaymentsPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  router.use('/platform-payment-methods', authorize);

  router.get('/platform-payment-methods', read, async (_req, res, next) => {
    try { send(res, 200, { items: await port.list(), max_active: MAX_ACTIVE_PLATFORM_PAYMENT_METHODS }); } catch (error) { forward(next, error); }
  });

  router.get('/platform-payment-methods/:methodId/qr', read, async (req, res, next) => {
    try {
      const qr = await port.readQr(methodId(req));
      if (!qr) throw new AppError(404, 'NOT_FOUND', 'This payment method has no QR image.');
      res.status(200).set({ 'Content-Type': qr.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(qr.bytes);
    } catch (error) { forward(next, error); }
  });

  router.post('/platform-payment-methods', manage, async (req, res, next) => {
    try {
      const input = parse(createInputSchema, req.body, 'Provide a label (1 to 80 characters), optional account details, and a reason.');
      const qr = input.qr ? decodeQr(input.qr) : null;
      const result = await port.create(fieldsOf(input), qr, context(req, res, input.reason));
      send(res, result.replayed ? 200 : 201, result);
    } catch (error) { forward(next, error); }
  });

  router.post('/platform-payment-methods/:methodId', manage, async (req, res, next) => {
    try {
      const id = methodId(req);
      const input = parse(updateInputSchema, req.body, 'Provide the version you edited, a label, optional account details, and a reason.');
      const qr = input.qr === undefined ? undefined : input.qr === null ? null : decodeQr(input.qr);
      send(res, 200, await port.update(id, input.version, fieldsOf(input), qr, context(req, res, input.reason)));
    } catch (error) { forward(next, error); }
  });

  for (const [action, active] of [['activate', true], ['deactivate', false]] as const) {
    router.post(`/platform-payment-methods/:methodId/${action}`, manage, async (req, res, next) => {
      try {
        const id = methodId(req);
        const input = parse(toggleInputSchema, req.body, 'Provide the version you saw and a reason.');
        send(res, 200, await port.setActive(id, input.version, active, context(req, res, input.reason)));
      } catch (error) { forward(next, error); }
    });
  }

  return router;
}
