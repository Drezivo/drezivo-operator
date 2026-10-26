import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { vi.stubEnv("NEXT_PUBLIC_OPERATOR_LOCAL_MODE", "true"); });
vi.mock("@clerk/nextjs", () => ({ useAuth: () => { throw new Error("Local mode must not use Clerk auth"); } }));
import { LocalOperatorProvider, isLocalOperator, useOperatorAuth } from "./local-auth";

function LocalSession() {
  const { userId, signOut } = useOperatorAuth();
  return <><p>Signed in: {userId}</p><button onClick={() => void signOut()}>End local session</button></>;
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
afterAll(() => { vi.unstubAllEnvs(); });

describe("synthetic local operator auth", () => {
  it("opens one local session for duplicate submits and clears it on sign-out", async () => {
    expect(isLocalOperator).toBe(true);
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LocalOperatorProvider><LocalSession /></LocalOperatorProvider>);
    const button = await screen.findByRole("button", { name: "Open local console" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5080/local/login");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ profile: "user_local_founder" });
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
    await act(async () => { finish(new Response(JSON.stringify({ data: { token: "synthetic-session-token", profile: { id: "user_local_founder", label: "Founder", role: "superadmin" }, session_id: "local-session" } }), { status: 200 })); });
    expect(await screen.findByText("Signed in: user_local_founder")).toBeInTheDocument();
    expect(sessionStorage.getItem("operator-local-session")).toContain("user_local_founder");
    fireEvent.click(screen.getByRole("button", { name: "End local session" }));
    expect(await screen.findByRole("heading", { name: "Operator sign-in" })).toBeInTheDocument();
    expect(sessionStorage.getItem("operator-local-session")).toBeNull();
  });

  it("rejects a stored profile outside the synthetic allowlist", async () => {
    sessionStorage.setItem("operator-local-session", JSON.stringify({ token: "invalid", profile: { id: "unknown-profile" } }));
    render(<LocalOperatorProvider><LocalSession /></LocalOperatorProvider>);
    expect(await screen.findByRole("heading", { name: "Operator sign-in" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in:/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem("operator-local-session")).toBeNull();
  });
});
