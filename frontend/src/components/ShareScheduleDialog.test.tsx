import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareScheduleDialog, ShareScheduleButton } from "./ShareScheduleDialog";

describe("ShareScheduleDialog Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("renders the dialog when isOpen is true with matching QR code and readable link", () => {
    render(
      <ShareScheduleDialog
        isOpen={true}
        onClose={vi.fn()}
        scheduleType="vault"
        scheduleId={15}
        label="Treasury Vesting"
        network="testnet"
      />,
    );

    const title = screen.getByRole("heading", { name: /Share Vault #15/i });
    expect(title).toBeDefined();

    const networkBadge = screen.getByTestId("share-network-badge");
    expect(networkBadge.textContent?.toLowerCase()).toBe("testnet");

    const qrCode = screen.getByTestId("share-qr-code");
    const input = screen.getByTestId("share-link-input") as HTMLInputElement;

    // AC 1: QR payload matches the displayed link
    expect(qrCode).toBeDefined();
    expect(input).toBeDefined();
    expect(qrCode.getAttribute("data-payload")).toBe(input.value);

    // AC 2: The URL identifies the deployment and schedule
    expect(input.value).toContain("/vault/15");
    expect(input.value).toContain("network=testnet");

    // AC 4: Payload contains no secrets or signing data
    expect(input.value).not.toMatch(/secret|private_key|seed|signature/i);
  });

  it("verifies stream and DCA schedule URLs identify their schedule types and deployment", () => {
    const { rerender } = render(
      <ShareScheduleDialog
        isOpen={true}
        onClose={vi.fn()}
        scheduleType="stream"
        scheduleId="stream-42"
        network="mainnet"
      />,
    );

    let input = screen.getByTestId("share-link-input") as HTMLInputElement;
    let qr = screen.getByTestId("share-qr-code");
    expect(input.value).toContain("/stream/stream-42");
    expect(input.value).toContain("network=mainnet");
    expect(qr.getAttribute("data-payload")).toBe(input.value);

    rerender(
      <ShareScheduleDialog
        isOpen={true}
        onClose={vi.fn()}
        scheduleType="dca"
        scheduleId={88}
        network="testnet"
      />,
    );

    input = screen.getByTestId("share-link-input") as HTMLInputElement;
    qr = screen.getByTestId("share-qr-code");
    expect(input.value).toContain("/dca/88");
    expect(input.value).toContain("network=testnet");
    expect(qr.getAttribute("data-payload")).toBe(input.value);
  });

  it("rejects payloads containing secret seeds or signing parameters", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(
        <ShareScheduleDialog
          isOpen={true}
          onClose={vi.fn()}
          scheduleType="vault"
          scheduleId={1}
          canonicalUrl="https://chronostar.io/vault/1?signature=secret123"
        />,
      );
    }).toThrow(/Payload contains forbidden secret or signing data/);

    consoleError.mockRestore();
  });

  it("supports keyboard navigation: closes on Escape and restores focus", async () => {
    const handleClose = vi.fn();

    // Create a mock trigger button in the document
    const trigger = document.createElement("button");
    trigger.textContent = "Open Dialog";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <ShareScheduleDialog
        isOpen={true}
        onClose={handleClose}
        scheduleType="vault"
        scheduleId={1}
      />,
    );

    // Escape closes the dialog
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Dialog unmounts / closes -> restores focus
    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("traps focus inside the dialog on Tab and Shift+Tab", () => {
    render(
      <ShareScheduleDialog isOpen={true} onClose={vi.fn()} scheduleType="vault" scheduleId={1} />,
    );

    const dialog = screen.getByRole("dialog");
    const closeBtn = screen.getByLabelText("Close dialog");
    const copyBtn = screen.getByTestId("share-copy-button");

    // Move focus to last element (copy button)
    copyBtn.focus();
    expect(document.activeElement).toBe(copyBtn);

    // Press Tab: should cycle to first element (close button)
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    // Press Shift+Tab on first element: should cycle to last element (copy button)
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(copyBtn);
  });

  it("copies link to clipboard and displays feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <ShareScheduleDialog isOpen={true} onClose={vi.fn()} scheduleType="vault" scheduleId={10} />,
    );

    const copyBtn = screen.getByTestId("share-copy-button");
    const input = screen.getByTestId("share-link-input") as HTMLInputElement;

    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(input.value);
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeDefined();
    });
  });

  it("ShareScheduleButton opens and closes the dialog cleanly and restores focus", async () => {
    render(
      <div>
        <ShareScheduleButton scheduleType="vault" scheduleId={77} label="My Vault" />
      </div>,
    );

    const button = screen.getByTestId("share-vault-button");
    expect(screen.queryByRole("dialog")).toBeNull();

    // Click button to open
    button.focus();
    fireEvent.click(button);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByRole("heading", { name: /Share Vault #77/i })).toBeDefined();

    // Close button
    const closeBtn = screen.getByLabelText("Close dialog");
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus should be restored to button
    expect(document.activeElement).toBe(button);
  });
});
