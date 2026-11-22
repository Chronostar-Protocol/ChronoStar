export type VaultStatusName = "Active" | "Released" | "Cancelled" | "Paused" | "Reclaimed";
export type VaultStatusOrdinal = 0 | 1 | 2 | 3 | 4;
export type VaultStatus = VaultStatusName | VaultStatusOrdinal;

export type StreamStatusName = "Active" | "Paused" | "Completed" | "Cancelled";
export type StreamStatusOrdinal = 0 | 1 | 2 | 3;
export type StreamStatus = StreamStatusName | StreamStatusOrdinal;

export type DCAStatusName = "Active" | "Exhausted" | "Cancelled";
export type DCAStatusOrdinal = 0 | 1 | 2;
export type DCAStatus = DCAStatusName | DCAStatusOrdinal;

export const VAULT_STATUS_NAMES: Record<VaultStatusOrdinal, VaultStatusName> = {
  0: "Active",
  1: "Released",
  2: "Cancelled",
  3: "Paused",
  4: "Reclaimed",
};

export const STREAM_STATUS_NAMES: Record<StreamStatusOrdinal, StreamStatusName> = {
  0: "Active",
  1: "Paused",
  2: "Completed",
  3: "Cancelled",
};

export const DCA_STATUS_NAMES: Record<DCAStatusOrdinal, DCAStatusName> = {
  0: "Active",
  1: "Exhausted",
  2: "Cancelled",
};

export function formatVaultStatus(status: VaultStatus): VaultStatusName {
  if (typeof status === "number") {
    return VAULT_STATUS_NAMES[status as VaultStatusOrdinal] || "Active";
  }
  return status;
}

export function formatStreamStatus(status: StreamStatus): StreamStatusName {
  if (typeof status === "number") {
    return STREAM_STATUS_NAMES[status as StreamStatusOrdinal] || "Active";
  }
  return status;
}

export function formatDCAStatus(status: DCAStatus): DCAStatusName {
  if (typeof status === "number") {
    return DCA_STATUS_NAMES[status as DCAStatusOrdinal] || "Active";
  }
  return status;
}

export interface VaultEntry {
  id: number;
  owner: string;
  recipient: string;
  token: string;
  amount: string;
  release_ledger: number;
  created_ledger: number;
  label: string;
  status: VaultStatus;
  paused_at_ledger?: number | null;
  expires_after_ledger?: number | null;
}

export interface StreamEntry {
  id: number;
  owner: string;
  recipient: string;
  token: string;
  total_amount: string;
  claimed_amount: string;
  start_ledger: number;
  end_ledger: number;
  last_claimed_ledger: number;
  created_ledger?: number;
  label: string;
  grace_period_ledgers?: number;
  status: StreamStatus;
  paused_at_ledger?: number;
  paused_ledgers?: number;
  claimable_amount?: string;
}

export interface DCAEntry {
  id: number;
  owner: string;
  token_in: string;
  token_out?: string | null;
  router?: string | null;
  swap_receiver: string;
  total_budget: string;
  remaining_budget: string;
  amount_per_swap: string;
  min_output_per_swap?: string | bigint;
  last_swap_output?: string | bigint;
  interval_ledgers: number;
  last_executed_ledger: number;
  next_execution_ledger: number;
  executions_completed: number;
  created_ledger?: number;
  label: string;
  status: DCAStatus;
}

export interface DCAExecution {
  index: number;
  dca_id: number;
  ledger: number;
  amount_in: string;
  amount_out: string;
  remaining_budget: string;
  next_execution_ledger: number;
  swapped: boolean;
}

export interface DCAExecutionHistory {
  dcaId: number;
  start: number;
  limit: number;
  executions: DCAExecution[];
}

export interface ScheduleEvent {
  type: "vault" | "stream" | "dca";
  id: number;
  targetLedger: number;
  remainingLedgers: number;
}

export interface Stats {
  vaults: { total: number; active: number; released: number; paused?: number; reclaimed?: number };
  streams: { total: number; active: number; completed: number; paused?: number };
  dca: { total: number; active: number; exhausted: number };
  totalValueLocked: string;
}

export interface TransactionReceipt {
  network: string;
  contractId: string;
  method: string;
  hash: string;
  ledger?: number | bigint | string;
  timestamp: string;
  status: "SUCCESS";
  parameters: Record<string, string | number | boolean | null | undefined>;
}
