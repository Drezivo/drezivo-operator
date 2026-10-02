import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["active", "status-badge-success", "Active"],
    ["past_due", "status-badge-warning", "Past Due"],
    ["failed", "status-badge-danger", "Failed"],
    ["new_api_state", "status-badge-neutral", "New Api State"],
  ])("renders %s with its semantic tone", (value, tone, label) => {
    render(<StatusBadge value={value} />);

    expect(screen.getByText(label)).toHaveClass("status-badge", tone);
  });
});
