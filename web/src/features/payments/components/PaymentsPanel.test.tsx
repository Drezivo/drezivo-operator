import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPanel } from "./PaymentReview";

const tenantId = "11111111-1111-4111-8111-111111111111";
const payment = {
  payment_id: "66666666-6666-4666-8666-666666666666", tenant_id: tenantId, tenant_name: "Luna Gowns", status: "pending", amount_minor: "30000",
  currency: "PHP", reference: "GC-1", method_label: "GCash", submitted_at: "2026-10-01T02:00:00Z", reviewed_at: null, reviewed_by: null, review_note: null, has_proof: false,
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

describe("PaymentsPanel", () => {
  it("loads the pending queue, switches to recent, and opens a business", async () => {
    const urls: string[] = [];
    mockFetch((url) => { urls.push(url); return envelope({ items: url.includes("status=pending") ? [payment] : [] }); });
    const onOpenBusiness = vi.fn();
    render(<PaymentsPanel getToken={getToken} onOpenBusiness={onOpenBusiness} />);
    fireEvent.click(await screen.findByRole("button", { name: "Luna Gowns" }));
    expect(onOpenBusiness).toHaveBeenCalledWith(tenantId);
    expect(screen.getByText("GC-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Recently sent" }));
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
    await waitFor(() => expect(urls.some((url) => url.endsWith("/subscription-payments?status=recent"))).toBe(true));
  });

  it("rejects with a reason for the owner and reloads the queue", async () => {
    let posted: string | null = null;
    let pending = [payment];
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        posted = url;
        pending = [];
        return envelope({ tenant: { name: "Luna Gowns" }, changed: true, replayed: false });
      }
      return envelope({ items: pending });
    });
    render(<PaymentsPanel getToken={getToken} onOpenBusiness={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText(/Reason for the owner/), { target: { value: "Amount was 200, not 300" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject payment" }));
    expect(await screen.findByText(/Payment rejected for Luna Gowns/)).toBeInTheDocument();
    expect(posted).toContain(`/subscription-payments/${payment.payment_id}/reject`);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("lists one business's whole history after choosing it, without loading the queue", async () => {
    const urls: string[] = [];
    const history = [
      { ...payment, payment_id: '77777777-7777-4777-8777-777777777777', status: 'verified', reference: 'GC-OCT', amount_minor: '29900', reviewed_at: '2026-10-02T00:00:00Z' },
      { ...payment, payment_id: '88888888-8888-4888-8888-888888888888', status: 'verified', reference: 'GC-SEP', amount_minor: '29900', reviewed_at: '2026-09-02T00:00:00Z' },
      { ...payment, payment_id: '99999999-9999-4999-8999-999999999999', status: 'failed', reference: 'GC-BAD', review_note: 'No match' },
    ];
    mockFetch((url) => {
      urls.push(url);
      if (url.endsWith('/tenants?') || url.endsWith('/tenants')) return envelope({ items: [{ tenant_id: tenantId, name: 'Luna Gowns', slug: 'luna-gowns' }] });
      if (url.includes(`/tenants/${tenantId}/subscription-payments`)) return envelope({ items: history });
      return envelope({ items: [] });
    });
    render(<PaymentsPanel getToken={getToken} onOpenBusiness={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'By business' }));
    expect(screen.getByText('Choose a business')).toBeInTheDocument();
    await screen.findByRole('option', { name: /Luna Gowns/ });
    urls.length = 0;
    fireEvent.change(screen.getByRole('combobox', { name: 'Business' }), { target: { value: tenantId } });

    expect(await screen.findByText('GC-OCT')).toBeInTheDocument();
    expect(screen.getByText('GC-SEP')).toBeInTheDocument();
    expect(screen.getByText('GC-BAD')).toBeInTheDocument();
    expect(screen.getByText(/3 payments · 2 approved/)).toBeInTheDocument();
    expect(urls.some((url) => url.includes('/subscription-payments?status='))).toBe(false);
  });
});
