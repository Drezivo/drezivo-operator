import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, ApiError, resourcePaths, resourceRequest, withCursor } from "./api";

const envelope = (data: unknown) => ({ success: true, data, request_id: "req_test_01" });
const failed = (code: string, message: string) => ({ success: false, error: { code, message }, request_id: "req_test_02" });

beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "http://localhost:5080/api/v1"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("apiRequest", () => {
  it("adds an opaque cursor without changing the page size", () => {
    expect(withCursor("/subscriptions?limit=25", "next / page+2")).toBe("/subscriptions?limit=25&cursor=next%20%2F%20page%2B2");
    expect(withCursor("/overview", null)).toBe("/overview");
  });

  it("requests the overview without a caller-supplied snapshot time", async () => {
    const serverAsOf = "2026-09-25T00:00:00Z";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ as_of: serverAsOf })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await resourceRequest("overview", resourcePaths.overview, { token: "signed-session-token" });
    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/overview");
    expect(url.search).toBe("");
    expect(result.data.as_of).toBe(serverAsOf);
  });

  it("uses no-store, Clerk bearer auth, and returns the server envelope data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ total: 3 })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiRequest<{ total: number }>("/overview", { token: "signed-session-token" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("localhost:5080/api/v1/overview");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer signed-session-token");
    expect(result).toEqual({ data: { total: 3 }, requestId: "req_test_01" });
  });

  it("sends a supplied idempotency key once with a mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ accepted: true })), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/support-grants", { token: "signed-session-token", method: "POST", body: { tenant_id: "tenant_1" }, idempotencyKey: "intent-key-1234567890" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("intent-key-1234567890");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ tenant_id: "tenant_1" }));
  });

  it("sends the operator-provided reason for a retry without substituting copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ accepted: true })), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/jobs/job_1/retry", { token: "signed-session-token", method: "POST", body: { reason: "Reviewed timeout with on-call" }, idempotencyKey: "retry-intent-1234567890" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ reason: "Reviewed timeout with on-call" }));
  });

  it("does not call fetch when the API base URL is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "");
    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({ kind: "unavailable", code: "API_BASE_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects production HTTP bases before sending the Clerk token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "http://localhost:5080/api/v1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({
      kind: "unavailable",
      code: "API_BASE_INSECURE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "operator.localhost"])("allows development HTTP on loopback host %s", async (host) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", `http://${host}:5080/api/v1`);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ ok: true })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/overview", { token: "signed-session-token" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("Authorization")).toBe("Bearer signed-session-token");
  });

  it("rejects development HTTP for non-loopback hosts before sending the Clerk token", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "http://api.example.com/api/v1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({
      kind: "unavailable",
      code: "API_BASE_INSECURE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on loopback HTTP when the runtime environment is not development or test", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({
      kind: "unavailable",
      code: "API_BASE_INSECURE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows production HTTPS bases and sends the Clerk token only after validation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "https://api.example.com/api/v1");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope({ ok: true })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/overview", { token: "signed-session-token" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.example.com/api/v1/overview");
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("Authorization")).toBe("Bearer signed-session-token");
  });

  it.each([undefined, null, "", " \t\n"] as const)("rejects a missing or blank bearer token (%s) before fetch", async (token) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/overview", { token })).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED", "unauthorized"],
    [403, "OPERATOR_ACCESS_DENIED", "forbidden"],
    [503, "SERVICE_UNAVAILABLE", "unavailable"],
  ] as const)("preserves API failure category for status %s", async (status, code, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(failed(code, "Denied by server")), { status })));
    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({ kind, status, code, requestId: "req_test_02" });
  });

  it("rejects non-local route paths before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("//outside.example/path", { token: "signed-session-token" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a network failure without exposing transport internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket details")));
    await expect(apiRequest("/overview", { token: "signed-session-token" })).rejects.toMatchObject({ kind: "network", message: expect.not.stringContaining("socket details") });
  });

  it("stops waiting when the operator API does not respond", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = apiRequest("/overview", { token: "signed-session-token" });
    const timeoutAssertion = expect(request).rejects.toMatchObject({ kind: "network", code: "API_REQUEST_TIMEOUT", message: "The operator API took too long to respond. Try again." });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutAssertion;
    vi.useRealTimers();
  });

  it("preserves caller cancellation so navigation does not show an error", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const request = apiRequest("/overview", { token: "signed-session-token", signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
