import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/use-session-token", () => ({ useSessionToken: () => async () => "operator-token" }));
vi.mock("@/shared/api/client", async (original) => ({ ...(await original<typeof import("@/shared/api/client")>()), apiRequest: vi.fn() }));
import { ApiError, apiRequest } from "@/shared/api/client";
import { useRetryCommand } from "./use-retry-command";

const request = vi.mocked(apiRequest);
const action = { key: "jobs:job-1:retry", path: "/jobs/job-1/retry", label: "Retry job" };
afterEach(() => { request.mockReset(); });

describe("operation retry commands", () => {
  it("keeps the reason and idempotency key when a failed command is retried", async () => {
    request.mockRejectedValueOnce(new ApiError("Unavailable", "unavailable"));
    request.mockResolvedValueOnce({ data: { accepted: true }, requestId: "retried" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(useRetryCommand);
    await act(async () => { expect(await view.result.current.run(action, " Reviewed timeout ", refresh)).toBe(false); });
    expect(view.result.current.error?.message).toBe("Unavailable");
    await act(async () => { expect(await view.result.current.run(action, " Reviewed timeout ", refresh)).toBe(true); });
    expect(request.mock.calls[0][1]).toMatchObject({ token: "operator-token", method: "POST", body: { reason: "Reviewed timeout" } });
    expect(request.mock.calls[1][1]?.idempotencyKey).toBe(request.mock.calls[0][1]?.idempotencyKey);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.result.current.notice?.requestId).toBe("retried");
    expect(view.result.current.pending).toBeNull();
  });

  it("submits only once for duplicate confirmation clicks", async () => {
    let finish!: (value: { data: unknown; requestId: string }) => void;
    request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(useRetryCommand);
    let first!: Promise<boolean>;
    act(() => { first = view.result.current.run(action, "Reviewed timeout", refresh); void view.result.current.run(action, "Reviewed timeout", refresh); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ data: {}, requestId: "accepted" }); await first; });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh an old page after navigation unmounts the command owner", async () => {
    let finish!: (value: { data: unknown; requestId: string }) => void;
    request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const refresh = vi.fn();
    const view = renderHook(useRetryCommand);
    let result!: Promise<boolean>;
    act(() => { result = view.result.current.run(action, "Reviewed timeout", refresh); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { finish({ data: {}, requestId: "accepted" }); await result; });
    expect(refresh).not.toHaveBeenCalled();
  });
});
