import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaginationControls } from "./PaginationControls";

afterEach(cleanup);

describe("PaginationControls", () => {
  it("uses the server cursor to open the next page and returns to the previous page", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(<PaginationControls pageNumber={1} hasPrevious={false} nextCursor="server-cursor-2" onPrevious={onPrevious} onNext={onNext} />);

    expect(screen.getByRole("navigation", { name: "List pages" })).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledWith("server-cursor-2");

    rerender(<PaginationControls pageNumber={2} hasPrevious nextCursor={null} onPrevious={onPrevious} onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("does not render controls when the server has no next cursor", () => {
    const { container } = render(<PaginationControls pageNumber={1} hasPrevious={false} nextCursor={null} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
