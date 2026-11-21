import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";
import type { VaultEntry, StreamEntry, DCAEntry } from "@/types";

const mockUseWallet = vi.fn();

vi.mock("@/lib/store", () => ({
  useWallet: () => mockUseWallet(),
}));

const mockApi = {
  getSchedules: vi.fn(),
  getStreams: vi.fn(),
  getDCA: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  api: {
    getSchedules: (...args: any[]) => mockApi.getSchedules(...args),
    getStreams: (...args: any[]) => mockApi.getStreams(...args),
    getDCA: (...args: any[]) => mockApi.getDCA(...args),
  },
  getApiErrorMessage: (err: any) => err?.message || "An error occurred",
}));

describe("DashboardPage Role Filters (Issue #414)", () => {
  const currentAddress = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  const otherAddress = "GBBZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN8";

  const mockVaults: VaultEntry[] = [
    {
      id: 1,
      owner: currentAddress,
      recipient: otherAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      amount: "1000",
      release_ledger: 5000,
      created_ledger: 1000,
      label: "Outgoing Vault to Partner",
      status: "Active",
    },
    {
      id: 2,
      owner: otherAddress,
      recipient: currentAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      amount: "2500",
      release_ledger: 6000,
      created_ledger: 1100,
      label: "Incoming Vault from Client",
      status: "Active",
    },
    {
      id: 3,
      owner: currentAddress,
      recipient: currentAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      amount: "5000",
      release_ledger: 7000,
      created_ledger: 1200,
      label: "Self-Directed Lock",
      status: "Active",
    },
  ];

  const mockStreams: StreamEntry[] = [
    {
      id: 101,
      owner: currentAddress,
      recipient: otherAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      total_amount: "10000",
      claimed_amount: "2000",
      start_ledger: 2000,
      end_ledger: 12000,
      last_claimed_ledger: 3000,
      label: "Payroll Outgoing Stream",
      status: "Active",
    },
    {
      id: 102,
      owner: otherAddress,
      recipient: currentAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      total_amount: "5000",
      claimed_amount: "1000",
      start_ledger: 2500,
      end_ledger: 7500,
      last_claimed_ledger: 3500,
      label: "Grant Incoming Stream",
      status: "Active",
    },
    {
      id: 103,
      owner: currentAddress,
      recipient: currentAddress,
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      total_amount: "8000",
      claimed_amount: "0",
      start_ledger: 2500,
      end_ledger: 8000,
      last_claimed_ledger: 2500,
      label: "Self Stream Savings",
      status: "Active",
    },
  ];

  const mockDcas: DCAEntry[] = [
    {
      id: 201,
      owner: currentAddress,
      token_in: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      swap_receiver: currentAddress,
      total_budget: "10000",
      remaining_budget: "8000",
      amount_per_swap: "500",
      interval_ledgers: 100,
      last_executed_ledger: 4000,
      next_execution_ledger: 4100,
      executions_completed: 4,
      label: "My Weekly DCA",
      status: "Active",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWallet.mockReturnValue({
      address: currentAddress,
      isConnected: true,
      network: "testnet",
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    mockApi.getSchedules.mockResolvedValue(mockVaults);
    mockApi.getStreams.mockResolvedValue(mockStreams);
    mockApi.getDCA.mockResolvedValue(mockDcas);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders connect wallet message when disconnected", () => {
    mockUseWallet.mockReturnValue({
      address: null,
      isConnected: false,
    });

    render(<DashboardPage />);
    expect(screen.getByText("Connect Your Wallet")).toBeTruthy();
    expect(screen.getByText("Get Freighter")).toBeTruthy();
  });

  it("filters vaults by role and includes self-directed in both Sent and Received", async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    // In 'All Roles' mode (default)
    expect(screen.getByText("Vaults (3)")).toBeTruthy();
    expect(screen.getByText("Outgoing Vault to Partner")).toBeTruthy();
    expect(screen.getByText("Incoming Vault from Client")).toBeTruthy();
    expect(screen.getByText("Self-Directed Lock")).toBeTruthy();
    expect(screen.getByText("Self-directed")).toBeTruthy();
    expect(screen.getByText("Outgoing")).toBeTruthy();
    expect(screen.getByText("Incoming")).toBeTruthy();

    // Switch to 'Sent (Outgoing)'
    const sentFilterBtn = screen.getByTestId("role-filter-sent");
    await act(async () => {
      fireEvent.click(sentFilterBtn);
    });

    // Dynamic count update: 2 items (Outgoing + Self-directed)
    expect(screen.getByText("Vaults (2)")).toBeTruthy();
    expect(screen.getByText("Outgoing Vault to Partner")).toBeTruthy();
    expect(screen.getByText("Self-Directed Lock")).toBeTruthy();
    expect(screen.queryByText("Incoming Vault from Client")).toBeNull();

    // Switch to 'Received (Incoming)'
    const receivedFilterBtn = screen.getByTestId("role-filter-received");
    await act(async () => {
      fireEvent.click(receivedFilterBtn);
    });

    // Dynamic count update: 2 items (Incoming + Self-directed)
    expect(screen.getByText("Vaults (2)")).toBeTruthy();
    expect(screen.getByText("Incoming Vault from Client")).toBeTruthy();
    expect(screen.getByText("Self-Directed Lock")).toBeTruthy();
    expect(screen.queryByText("Outgoing Vault to Partner")).toBeNull();

    // Zero extra RPC calls made during filtering
    expect(mockApi.getSchedules).toHaveBeenCalledTimes(1);
    expect(mockApi.getStreams).toHaveBeenCalledTimes(1);
    expect(mockApi.getDCA).toHaveBeenCalledTimes(1);
  });

  it("filters streams by role and updates tab counts dynamically", async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    // Switch tab to Streams
    const streamsTab = screen.getByRole("button", { name: /Streams/i });
    await act(async () => {
      fireEvent.click(streamsTab);
    });

    // All roles: 3 streams
    expect(screen.getByText("Payroll Outgoing Stream")).toBeTruthy();
    expect(screen.getByText("Grant Incoming Stream")).toBeTruthy();
    expect(screen.getByText("Self Stream Savings")).toBeTruthy();

    // Filter by Received
    const receivedFilterBtn = screen.getByTestId("role-filter-received");
    await act(async () => {
      fireEvent.click(receivedFilterBtn);
    });

    // Should contain Grant Incoming Stream and Self Stream Savings
    expect(screen.getByText("Streams (2)")).toBeTruthy();
    expect(screen.getByText("Grant Incoming Stream")).toBeTruthy();
    expect(screen.getByText("Self Stream Savings")).toBeTruthy();
    expect(screen.queryByText("Payroll Outgoing Stream")).toBeNull();

    // Filter by Sent
    const sentFilterBtn = screen.getByTestId("role-filter-sent");
    await act(async () => {
      fireEvent.click(sentFilterBtn);
    });

    expect(screen.getByText("Streams (2)")).toBeTruthy();
    expect(screen.getByText("Payroll Outgoing Stream")).toBeTruthy();
    expect(screen.getByText("Self Stream Savings")).toBeTruthy();
    expect(screen.queryByText("Grant Incoming Stream")).toBeNull();
  });

  it("preserves explicit DCA owner semantics and shows notice on received filter", async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    // Switch tab to DCA
    const dcaTab = screen.getByRole("button", { name: /DCA/i });
    await act(async () => {
      fireEvent.click(dcaTab);
    });

    expect(screen.getByText("My Weekly DCA")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();

    // Filter by Received
    const receivedFilterBtn = screen.getByTestId("role-filter-received");
    await act(async () => {
      fireEvent.click(receivedFilterBtn);
    });

    // DCA tab count should be 0 when Received filter is selected
    expect(screen.getByText("DCA (0)")).toBeTruthy();
    expect(screen.getByText("No incoming DCA schedules")).toBeTruthy();
    expect(
      screen.getByText(
        "DCA schedules are owner-managed automated swap strategies and do not have incoming recipient roles."
      )
    ).toBeTruthy();
    expect(screen.queryByText("My Weekly DCA")).toBeNull();

    // Switch back to All Roles
    const allFilterBtn = screen.getByTestId("role-filter-all");
    await act(async () => {
      fireEvent.click(allFilterBtn);
    });

    expect(screen.getByText("DCA (1)")).toBeTruthy();
    expect(screen.getByText("My Weekly DCA")).toBeTruthy();
  });
});
