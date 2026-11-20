import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateStreamPage from "./stream/new/page";
import CreateDCAPage from "./dca/new/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createStreamTx: vi.fn(),
  createDcaTx: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  useWallet: () => ({
    address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    isConnected: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/contracts", () => ({
  createStreamTx: mocks.createStreamTx,
  createDcaTx: mocks.createDcaTx,
}));

describe("create transaction forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits stream form values through createStreamTx and shows success with its hash", async () => {
    const hash = "ab".repeat(32);
    mocks.createStreamTx.mockResolvedValue({ hash });

    render(<CreateStreamPage />);
    fireEvent.change(screen.getByPlaceholderText("G..."), {
      target: { value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" },
    });
    fireEvent.change(screen.getByPlaceholderText("C..."), {
      target: { value: "CA3D5KRYMCMCZVAC7OHQHGNO2QQ74YOGJGXRO2CX6PYYBCR4ACMO5SC6" },
    });
    fireEvent.change(screen.getByPlaceholderText("1000000"), {
      target: { value: "250000" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 1440 (~2 hrs)"), {
      target: { value: "1440" },
    });
    fireEvent.change(screen.getByPlaceholderText("Salary stream"), {
      target: { value: "Monthly stream" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Stream" }));

    await waitFor(() => {
      expect(mocks.createStreamTx).toHaveBeenCalledWith(
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        {
          recipient: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
          token: "CA3D5KRYMCMCZVAC7OHQHGNO2QQ74YOGJGXRO2CX6PYYBCR4ACMO5SC6",
          totalAmount: "250000",
          durationLedgers: "1440",
          label: "Monthly stream",
        },
      );
      expect(screen.getByText("Stream created!")).toBeTruthy();
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps the DCA form visible and reports an error when submission returns no hash", async () => {
    mocks.createDcaTx.mockResolvedValue({ hash: "" });

    render(<CreateDCAPage />);
    fireEvent.change(screen.getByPlaceholderText("C..."), {
      target: { value: "CA3D5KRYMCMCZVAC7OHQHGNO2QQ74YOGJGXRO2CX6PYYBCR4ACMO5SC6" },
    });
    fireEvent.change(screen.getByPlaceholderText("Contract or wallet address"), {
      target: { value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" },
    });
    fireEvent.change(screen.getByPlaceholderText("1000000"), {
      target: { value: "250000" },
    });
    fireEvent.change(screen.getByPlaceholderText("100000"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 1440"), {
      target: { value: "1440" },
    });
    fireEvent.change(screen.getByPlaceholderText("Weekly XLM DCA"), {
      target: { value: "Weekly DCA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create DCA Policy" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Transaction submission did not return a hash",
    );
    expect(screen.getByRole("button", { name: "Create DCA Policy" })).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
