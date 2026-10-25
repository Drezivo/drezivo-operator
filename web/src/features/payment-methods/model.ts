/** Contract for the Operator API `/platform-payment-methods` routes (Drezivo's own payment methods). */

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
export type PlatformPaymentMethodList = { items: PlatformPaymentMethod[]; max_active: number };
export type PlatformPaymentMethodCommandResult = { method: PlatformPaymentMethod; changed: boolean; replayed: boolean };

/** The API re-checks size and file type from the bytes; this only saves a doomed upload. */
export const MAX_QR_BYTES = 512 * 1024;

export const platformPaymentPaths = {
  list: "/platform-payment-methods",
  update: (id: string) => `/platform-payment-methods/${encodeURIComponent(id)}`,
  qr: (id: string) => `/platform-payment-methods/${encodeURIComponent(id)}/qr`,
  toggle: (id: string, action: "activate" | "deactivate") => `/platform-payment-methods/${encodeURIComponent(id)}/${action}`,
} as const;

/** Base64 of a file's bytes (no data-URL prefix), as the API expects. */
export async function readQrFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
