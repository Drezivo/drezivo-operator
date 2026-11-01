import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPanel } from "./AnnouncementsPanel";

const envelope = (data: unknown, requestId = "req_test", status = 200) =>
  new Response(JSON.stringify({ success: true, request_id: requestId, data }), { status });
const getToken = vi.fn().mockResolvedValue("operator-session-token");

beforeEach(() => { process.env.NEXT_PUBLIC_DREZIVO_API_BASE_URL = "http://localhost:5080/api/v1"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AnnouncementsPanel", () => {
  it("asks before sending, sends once for a double click, and shows delivery progress", async () => {
    const posts: Array<{ body: unknown; key: string | null }> = [];
    let history: unknown[] = [];
    let release: () => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("Idempotency-Key") });
        await new Promise<void>((resolve) => { release = resolve; });
        history = [{ id: "00000000-0000-4000-8000-000000000001", subject: "Maintenance on Sunday", body: "Offline 1-2 AM.", created_by: "operator:op", recipient_count: 12, created_at: "2026-11-01T02:00:00Z", delivered: 9, queued: 2, failed: 1 }];
        return envelope({ id: "00000000-0000-4000-8000-000000000001", subject: "Maintenance on Sunday", recipient_count: 12, created_at: "2026-11-01T02:00:00Z", replayed: false }, "req_send", 201);
      }
      return envelope({ items: history });
    }));

    render(<AnnouncementsPanel getToken={getToken} />);
    expect(await screen.findByText("No announcements yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: " Maintenance on Sunday " } });
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: "Offline 1-2 AM." } });

    fireEvent.click(screen.getByRole("button", { name: "Review and send" }));
    expect(screen.getByRole("alert")).toHaveTextContent("emails every business that is not closed");
    expect(posts).toHaveLength(0);

    const confirm = screen.getByRole("button", { name: "Send to all businesses" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toHaveLength(1));
    release();

    expect(await screen.findByText(/Sending "Maintenance on Sunday" to 12 businesses/)).toBeInTheDocument();
    expect(posts[0]).toMatchObject({ body: { subject: "Maintenance on Sunday", body: "Offline 1-2 AM." } });
    expect(posts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("9 of 12 done · 2 in progress · 1 failed")).toBeInTheDocument();
  });
});
