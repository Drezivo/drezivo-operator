import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofLightbox } from "./ProofLightbox";
import { apiBlobRequest } from "@/shared/api/client";

vi.mock("@/shared/api/client", () => ({ apiBlobRequest: vi.fn() }));
const token = async () => "session";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  URL.createObjectURL = vi.fn(() => "blob:proof");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("payment proof lightbox", () => {
  it("retries an unavailable proof and previews a PDF", async () => {
    vi.mocked(apiBlobRequest).mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(new Blob(["pdf"], { type: "application/pdf" }));
    render(<ProofLightbox tenantId="tenant" paymentId="payment" token={token} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTitle("Payment proof PDF")).toHaveAttribute("src", "blob:proof");
  });

  it("closes on Escape", () => {
    vi.mocked(apiBlobRequest).mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    render(<ProofLightbox tenantId="tenant" paymentId="payment" token={token} onClose={onClose} />);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
