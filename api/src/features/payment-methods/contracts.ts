import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";

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

export const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Payment method administration is not configured.');
export const unavailablePlatformPaymentsPort: PlatformPaymentsPort = {
  list: async () => { throw unavailable(); },
  readQr: async () => { throw unavailable(); },
  create: async () => { throw unavailable(); },
  update: async () => { throw unavailable(); },
  setActive: async () => { throw unavailable(); },
};

export const uuid = z.string().uuid();
export const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const singleLine = /^[^\u0000-\u001f\u007f]*$/;
const multiLine = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
export const reason = z.string().trim().min(3).max(500).regex(singleLine);
const optionalText = (max: number, pattern: RegExp) =>
  z.string().trim().max(max).regex(pattern).nullable().optional().transform((value) => (value ? value : null));
// Base64 of at most MAX_QR_BYTES bytes (4 characters per 3 bytes, padded).
export const qrInput = z.object({ data_base64: z.string().min(4).max(Math.ceil(MAX_QR_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
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
