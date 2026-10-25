import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethodsPanel } from "@/features/payment-methods/components/PaymentMethodsPanel";
import { readQrFile, type PlatformPaymentMethod } from "@/features/payment-methods/model";

const methodId = "77777777-7777-4777-8777-777777777777";
const method: PlatformPaymentMethod = {
  id: methodId, label: "GCash", account_name: "Drezivo", account_number: "09171234567", instructions: null,
  has_qr: true, active: true, sort_order: 0, version: 3, updated_at: "2026-10-01T00:00:00Z",
};
const envelope = (data: unknown, requestId = "req_test") => new Response(JSON.stringify({ success: true, request_id: requestId, data }), { status: 200 });
const getToken = vi.fn().mockResolvedValue("operator-session-token");

beforeEach(() => { process.env.NEXT_PUBLIC_DREZIVO_API_BASE_URL = "http://localhost:5080/api/v1"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("readQrFile", () => {
  it("returns the raw base64 of the file's bytes", async () => {
    expect(await readQrFile(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]))).toBe("iVBORw==");
  });
});

describe("PaymentMethodsPanel", () => {
  it("adds a method with its QR as base64, a reason, and an Idempotency-Key", async () => {
    const posts: Array<{ key: string | null; body: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        posts.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return envelope({ method: { ...method, id: "88888888-8888-4888-8888-888888888888", label: "Maya" }, changed: true, replayed: false });
      }
      return envelope({ items: [method], max_active: 10 });
    });
    render(<PaymentMethodsPanel getToken={getToken} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add payment method/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Maya " } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "09181234567" } });
    const qr = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "maya.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/QR image/), { target: { files: [qr] } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Second wallet" } });
    const submit = screen.getByRole("button", { name: "Add method" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await screen.findByText(/Payment method added\./);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.key).toBeTruthy();
    expect(posts[0]!.body).toEqual({
      label: "Maya", account_name: null, account_number: "09181234567", instructions: null, sort_order: 0,
      reason: "Second wallet", qr: { data_base64: "iVBORw==" },
    });
  });

  it("refuses a QR over 512 KB before sending anything", async () => {
    const fetchMock = mockFetch(() => envelope({ items: [], max_active: 10 }));
    render(<PaymentMethodsPanel getToken={getToken} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add payment method/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "BPI" } });
    const big = new File([new Uint8Array(512 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/QR image/), { target: { files: [big] } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Bank" } });
    expect(screen.getByRole("alert")).toHaveTextContent("512 KB or smaller");
    expect(screen.getByRole("button", { name: "Add method" })).toBeDisabled();
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method !== "POST")).toBe(true);
  });

  it("turns a method off at its version, and blocks adding at the limit", async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const full = Array.from({ length: 10 }, (_, index) => ({ ...method, id: `7777777${index}-7777-4777-8777-777777777777`, label: `Method ${index}` }));
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return envelope({ method: { ...full[0]!, active: false, version: 4 }, changed: true, replayed: false });
      }
      return envelope({ items: full, max_active: 10 });
    });
    render(<PaymentMethodsPanel getToken={getToken} />);
    expect(await screen.findByRole("button", { name: /Add payment method/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Turn off" })[0]!);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Account closed" } });
    fireEvent.click(document.querySelector(".row-form button[type=submit]") as HTMLButtonElement);
    await screen.findByText(/Payment method turned off\./);
    expect(posts[0]).toEqual({ url: expect.stringContaining(`/platform-payment-methods/${full[0]!.id}/deactivate`), body: { version: 3, reason: "Account closed" } });
  });
});
