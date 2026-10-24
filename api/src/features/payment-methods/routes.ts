import { createOperatorPlatformPaymentsController } from './controller.js';
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
type Options = { permissionMiddleware?: (permission: string) => RequestHandler };

export function createOperatorPlatformPaymentsRouter(
  port: PlatformPaymentsPort = unavailablePlatformPaymentsPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: Options = {},
): Router {
  const controller = createOperatorPlatformPaymentsController(port, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware
    ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  const read = permission(tenantAdminPermissions.read);
  const manage = permission(tenantAdminPermissions.manage);
  router.use('/platform-payment-methods', authorize);

  router.get('/platform-payment-methods', read, controller.listMethods);

  router.get('/platform-payment-methods/:methodId/qr', read, controller.readQr);

  router.post('/platform-payment-methods', manage, controller.createMethod);

  router.post('/platform-payment-methods/:methodId', manage, controller.updateMethod);

  for (const [action, active] of [['activate', true], ['deactivate', false]] as const) {
    router.post(`/platform-payment-methods/:methodId/${action}`, manage, controller.setActive(active));
  }

  return router;
}
