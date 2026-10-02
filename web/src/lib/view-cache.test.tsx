import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async (original) => ({ ...(await original<typeof import("./api")>()), apiRequest: vi.fn() }));
import { apiRequest } from "./api";
import { clearViewCache, prefetchViews, useCachedLoad } from "./view-cache";

const token = async () => "token";
const mocked = vi.mocked(apiRequest);

afterEach(() => { clearViewCache(); mocked.mockReset(); });

describe("useCachedLoad", () => {
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
