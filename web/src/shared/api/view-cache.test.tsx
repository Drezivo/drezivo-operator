import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/client", async (original) => ({ ...(await original<typeof import("@/shared/api/client")>()), apiRequest: vi.fn() }));
import { apiRequest } from "@/shared/api/client";
import { clearViewCache, prefetchViews, useCachedLoad } from "@/shared/api/view-cache";

const token = async () => "token";
const mocked = vi.mocked(apiRequest);

afterEach(() => { clearViewCache(); mocked.mockReset(); });

describe("useCachedLoad", () => {
  it("does not let a previous session's pending request repopulate a cleared cache", async () => {
    let finishPrevious!: (value: { data: { name: string }; requestId: string }) => void;
    mocked.mockReturnValueOnce(new Promise((resolve) => { finishPrevious = resolve; }) as never);
    const previous = renderHook(() => useCachedLoad<{ name: string }>("/tenants", token));
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    previous.unmount();
    clearViewCache();
    await act(async () => { finishPrevious({ data: { name: "Previous session" }, requestId: "previous" }); });
    mocked.mockReturnValueOnce(new Promise(() => undefined) as never);
    const current = renderHook(() => useCachedLoad<{ name: string }>("/tenants", token));
    expect(current.result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
  });

  it("does not expose a previous business while a reused hook changes paths", async () => {
    mocked.mockResolvedValueOnce({ data: { name: "Business A" }, requestId: "a" });
    const view = renderHook(({ path }) => useCachedLoad<{ name: string }>(path, token), { initialProps: { path: "/tenants/a" } });
    await waitFor(() => expect(view.result.current[0]).toMatchObject({ status: "ready", data: { name: "Business A" } }));
    let release!: (value: { data: { name: string }; requestId: string }) => void;
    mocked.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }) as never);
    view.rerender({ path: "/tenants/b" });
    expect(view.result.current[0]).toEqual({ status: "loading" });
    await act(async () => { release({ data: { name: "Business B" }, requestId: "b" }); });
    await waitFor(() => expect(view.result.current[0]).toMatchObject({ status: "ready", data: { name: "Business B" } }));
  });

  it("shows the cached response at once on a revisit, then refreshes in the background", async () => {
    mocked.mockResolvedValueOnce({ data: { n: 1 }, requestId: "r1" });
    const first = renderHook(() => useCachedLoad<{ n: number }>("/tenants", token));
    await waitFor(() => expect(first.result.current[0]).toMatchObject({ status: "ready", data: { n: 1 } }));
    first.unmount();

    let release!: (value: { data: { n: number }; requestId: string }) => void;
    mocked.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }) as never);
    const second = renderHook(() => useCachedLoad<{ n: number }>("/tenants", token));
    expect(second.result.current[0]).toMatchObject({ status: "ready", data: { n: 1 }, refreshing: true });
    await act(async () => { release({ data: { n: 2 }, requestId: "r2" }); });
    await waitFor(() => expect(second.result.current[0]).toMatchObject({ status: "ready", data: { n: 2 }, refreshing: false }));
  });

  it("keeps the last good data when a background refresh fails", async () => {
    mocked.mockResolvedValueOnce({ data: { n: 1 }, requestId: "r1" });
    prefetchViews(["/people"], token);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    mocked.mockRejectedValueOnce(new Error("offline"));
    const view = renderHook(() => useCachedLoad<{ n: number }>("/people", token));
    await waitFor(() => expect(view.result.current[0]).toMatchObject({ status: "ready", data: { n: 1 }, refreshing: false }));
  });

  it("never lets a read that started before a command overwrite the command's result", async () => {
    let release!: (value: { data: { n: number }; requestId: string }) => void;
    mocked.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }) as never);
    const view = renderHook(() => useCachedLoad<{ n: number }>("/tenants/a", token));
    act(() => view.result.current[2]({ n: 9 }, "command"));
    await act(async () => { release({ data: { n: 1 }, requestId: "stale" }); });
    expect(view.result.current[0]).toMatchObject({ status: "ready", data: { n: 9 } });
  });

  it("shares one request between a prefetch and the view that opens", async () => {
    mocked.mockResolvedValue({ data: { n: 1 }, requestId: "r1" });
    prefetchViews(["/subscription-payments?status=pending"], token);
    const view = renderHook(() => useCachedLoad<{ n: number }>("/subscription-payments?status=pending", token));
    await waitFor(() => expect(view.result.current[0]).toMatchObject({ status: "ready" }));
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("forgets everything on sign-out", async () => {
    mocked.mockResolvedValueOnce({ data: { n: 1 }, requestId: "r1" });
    const first = renderHook(() => useCachedLoad<{ n: number }>("/tenants", token));
    await waitFor(() => expect(first.result.current[0].status).toBe("ready"));
    first.unmount();
    clearViewCache();
    mocked.mockReturnValueOnce(new Promise(() => undefined) as never);
    const second = renderHook(() => useCachedLoad<{ n: number }>("/tenants", token));
    expect(second.result.current[0]).toEqual({ status: "loading" });
  });
});
