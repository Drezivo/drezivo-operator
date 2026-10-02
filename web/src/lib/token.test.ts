import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationGuard } from "./mutations";
import { getTokenWithTimeout } from "./token";

afterEach(() => vi.useRealTimers());

describe("getTokenWithTimeout", () => {
  it("rejects a token request that never settles so mutation pending state can recover", async () => {
    vi.useFakeTimers();
    const getToken = vi.fn(() => new Promise<string | null>(() => {}));
    const tokenPromise = getTokenWithTimeout(getToken);
    const timeoutAssertion = expect(tokenPromise).rejects.toMatchObject({ code: "AUTH_TOKEN_TIMEOUT", kind: "network" });

    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutAssertion;
    expect(getToken).toHaveBeenCalledOnce();
  });

  it("preserves caller aborts instead of turning them into token timeout errors", async () => {
    const controller = new AbortController();
    const tokenPromise = getTokenWithTimeout(() => new Promise<string | null>(() => {}), controller.signal);
    const abortAssertion = expect(tokenPromise).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    await abortAssertion;
  });

  it("keeps the same idempotency key when a token timeout is retried", async () => {
    vi.useFakeTimers();
    const guard = new MutationGuard();
    const sentKeys: string[] = [];
    const firstRequest = guard.run("support-grant:create", { tenant_id: "tenant-1" }, async (key) => {
      sentKeys.push(key);
      await getTokenWithTimeout(() => new Promise<string | null>(() => {}));
    });
    const timeoutAssertion = expect(firstRequest).rejects.toMatchObject({ code: "AUTH_TOKEN_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutAssertion;

    await guard.run("support-grant:create", { tenant_id: "tenant-1" }, async (key) => {
      sentKeys.push(key);
      return "retried";
    });
    expect(sentKeys).toHaveLength(2);
    expect(sentKeys[1]).toBe(sentKeys[0]);
  });
});
