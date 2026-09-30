export interface VaultEntry {
  id: number;
  owner: string;
  recipient: string;
  token: string;
  amount: string;
  release_ledger: number;
  created_ledger: number;
  label: string;
  status: 'Active' | 'Released' | 'Cancelled';
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
  label: string;
  status: 'Active' | 'Completed' | 'Cancelled';
  claimable_amount?: string;
}

export interface DCAEntry {
  id: number;
  owner: string;
  token_in: string;
  swap_receiver: string;
  total_budget: string;
  remaining_budget: string;
  amount_per_swap: string;
  interval_ledgers: number;
  last_executed_ledger: number;
  next_execution_ledger: number;
  executions_completed: number;
  label: string;
  status: 'Active' | 'Exhausted' | 'Cancelled';
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
  type: 'vault' | 'stream' | 'dca';
  id: number;
  targetLedger: number;
  remainingLedgers: number;
}

export interface Stats {
  vaults: { total: number; active: number; released: number };
  streams: { total: number; active: number; completed: number };
  dca: { total: number; active: number; exhausted: number };
  totalValueLocked: string;
}
