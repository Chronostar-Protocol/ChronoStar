import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TxToast } from "./TxToast";

describe("TxToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    [undefined, "https://stellar.expert/explorer/testnet"],
    ["", "https://stellar.expert/explorer/testnet"],
    ["https://stellar.expert/explorer/public", "https://stellar.expert/explorer/public"],
    ["https://stellar.expert/explorer/public///", "https://stellar.expert/explorer/public"],
  ])("uses configured explorer %s with the testnet fallback", (base, expected) => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_EXPLORER", base ?? "");
    if (base === undefined) delete process.env.NEXT_PUBLIC_STELLAR_EXPLORER;
    render(<TxToast status="success" hash="abc123" />);
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link.getAttribute("href")).toBe(`${expected}/tx/abc123`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("announces pending and success status with polite live-region semantics without moving focus", () => {
    const { rerender } = render(<TxToast status="pending" message="Submitting transaction" />);
    const pendingRegion = screen.getByRole("status");
    expect(pendingRegion.getAttribute("aria-live")).toBe("polite");
    expect(pendingRegion.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByText("Transaction pending:")).toBeTruthy();
    expect(screen.getByText("Submitting transaction")).toBeTruthy();

    rerender(<TxToast status="success" message="Transaction confirmed" />);
    const successRegion = screen.getByRole("status");
    expect(successRegion.getAttribute("aria-live")).toBe("polite");
    expect(successRegion.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByText("Transaction confirmed")).toBeTruthy();
  });

  it("announces error state with assertive alert priority", () => {
    render(<TxToast status="error" message="Transaction simulation failed" />);
    const alertRegion = screen.getByRole("alert");
    expect(alertRegion.getAttribute("aria-live")).toBe("assertive");
    expect(alertRegion.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByText("Transaction simulation failed")).toBeTruthy();
  });

  it("allows keyboard dismissal using the dismiss control button", () => {
    const onClose = vi.fn();
    render(<TxToast status="success" message="Done" onClose={onClose} />);
    const dismissButton = screen.getByRole("button", { name: "Dismiss notification" });
    expect(dismissButton).toBeTruthy();
    fireEvent.click(dismissButton);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("allows keyboard dismissal by pressing the Escape key", () => {
    const onClose = vi.fn();
    render(<TxToast status="success" message="Escape test" onClose={onClose} />);
    expect(screen.getByText("Escape test")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText("Escape test")).toBeNull();
  });

  it("keeps pending receipts visible beyond 30 seconds and dismisses after confirmation", () => {
    const onClose = vi.fn();
    const { rerender } = render(<TxToast status="pending" hash="abc123" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("link", { name: "View on explorer" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    rerender(<TxToast status="success" hash="abc123" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByText("success")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("link")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves error dismissal after five seconds without requiring a hash", () => {
    const onClose = vi.fn();
    render(<TxToast status="error" onClose={onClose} />);
    expect(screen.queryByRole("link")).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText("error")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears its timer on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<TxToast status="error" onClose={onClose} />);
    expect(screen.queryByRole("link")).toBeNull();
    unmount();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels a terminal dismissal when a new pending transaction starts", () => {
    const onClose = vi.fn();
    const { rerender } = render(<TxToast status="error" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(2_000));
    rerender(<TxToast status="pending" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("pending")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
