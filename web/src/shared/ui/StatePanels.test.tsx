import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/client";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("API states", () => {
  it("announces loading accessibly", () => {
    render(<LoadingPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading from operator API");
  });

  it("shows a genuine empty response without inventing records", () => {
    render(<EmptyPanel />);
    expect(screen.getByRole("heading", { name: "No records returned" })).toBeInTheDocument();
    expect(screen.getByText("The API returned an empty collection for this view.")).toBeInTheDocument();
  });

  it("shows a successful request ID and copies it when the clipboard is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<RequestId requestId="req_success_123" />);

    expect(screen.getByText("req_success_123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("status");
    expect(writeText).toHaveBeenCalledWith("req_success_123");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("distinguishes API authorization denial and permits a retry", () => {
    const retry = vi.fn();
    render(<StatePanel error={new ApiError("Access denied", "forbidden", 403, "OPERATOR_ACCESS_DENIED", "req_3")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Operator access not granted");
    expect(screen.getByRole("alert")).toHaveTextContent("req_3");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    ["Business API", "SERVICE_UNAVAILABLE", "req_business_503"],
    ["Clerk operator directory", "DEPENDENCY_UNAVAILABLE", "req_directory_503"],
  ] as const)("names the known %s dependency on a 503 and retains its request ID", (dependency, code, requestId) => {
    render(<StatePanel error={new ApiError("Dependency unavailable", "unavailable", 503, code, requestId)} dependency={dependency} onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(`${dependency} could not provide this view`);
    expect(screen.getByRole("alert")).toHaveTextContent(`This view needs data from ${dependency}`);
    expect(screen.getByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("alert")).toHaveTextContent(requestId);
    expect(screen.getByRole("alert")).not.toHaveTextContent("localhost");
  });

  it("identifies an invalid dependency response instead of reporting it as unavailable", () => {
    render(<StatePanel error={new ApiError("Dependency response invalid", "unavailable", 503, "DEPENDENCY_INVALID_RESPONSE", "req_invalid_dependency")} dependency="Business API" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Business API returned data we could not verify");
    expect(screen.getByRole("alert")).toHaveTextContent("its response failed validation");
    expect(screen.getByRole("alert")).toHaveTextContent("req_invalid_dependency");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Business API could not provide this view");
  });

  it("does not guess a dependency for a generic unavailable response", () => {
    render(<StatePanel error={new ApiError("Unavailable", "unavailable", 503, "SERVICE_UNAVAILABLE", "req_ambiguous_503")} onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("This request is temporarily unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("req_ambiguous_503");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Business API");
  });

});
