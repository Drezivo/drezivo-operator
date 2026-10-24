import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import type { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { tenantAdminPermissions } from "../../shared/auth/operator-permission-codes.js";
import { MAX_ACTIVE_PLATFORM_PAYMENT_METHODS, MAX_QR_BYTES, unavailable, unavailablePlatformPaymentsPort, uuid, idempotencyKey, reason, createInputSchema, updateInputSchema, toggleInputSchema } from "./contracts.js";
import type { QrMime, PlatformPaymentCommandContext, QrImage, PlatformPaymentMethodFields, PlatformPaymentsPort } from "./contracts.js";
import type { qrInput } from "./contracts.js";

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



import { createPlatformPaymentsService } from './service.js';

export function createOperatorPlatformPaymentsController(
  port: PlatformPaymentsPort = unavailablePlatformPaymentsPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
) {
  const service = createPlatformPaymentsService(port);
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  return {
    listMethods: async (_req: Request, res: Response, next: NextFunction) => {
    try { send(res, 200, { items: await service.list(), max_active: MAX_ACTIVE_PLATFORM_PAYMENT_METHODS }); } catch (error) { forward(next, error); }
  },
    readQr: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qr = await service.readQr(methodId(req));
      if (!qr) throw new AppError(404, 'NOT_FOUND', 'This payment method has no QR image.');
      res.status(200).set({ 'Content-Type': qr.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(qr.bytes);
    } catch (error) { forward(next, error); }
  },
    createMethod: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parse(createInputSchema, req.body, 'Provide a label (1 to 80 characters), optional account details, and a reason.');
      const qr = input.qr ? decodeQr(input.qr) : null;
      const result = await service.create(fieldsOf(input), qr, context(req, res, input.reason));
      send(res, result.replayed ? 200 : 201, result);
    } catch (error) { forward(next, error); }
  },
    updateMethod: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = methodId(req);
      const input = parse(updateInputSchema, req.body, 'Provide the version you edited, a label, optional account details, and a reason.');
      const qr = input.qr === undefined ? undefined : input.qr === null ? null : decodeQr(input.qr);
      send(res, 200, await service.update(id, input.version, fieldsOf(input), qr, context(req, res, input.reason)));
    } catch (error) { forward(next, error); }
  },
    setActive: (active: boolean): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = methodId(req);
        const input = parse(toggleInputSchema, req.body, 'Provide the version you saw and a reason.');
        send(res, 200, await service.setActive(id, input.version, active, context(req, res, input.reason)));
      } catch (error) { forward(next, error); }
    },
  };
}
