import { STELLAR_RPC_URL } from "./network";

export interface LedgerUpdate {
  ledger: number | null;
  failed: boolean;
}

type LedgerListener = (update: LedgerUpdate) => void;

const ledgerListeners = new Set<LedgerListener>();
let ledgerPoller: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<void> | null = null;
const DEFAULT_LEDGER_POLL_MS = 5_000;

function publishLedgerUpdate(update: LedgerUpdate): void {
  ledgerListeners.forEach((listener) => {
    try {
      listener(update);
    } catch (error) {
      console.error("Ledger subscriber failed", error);
    }
  });
}

async function refreshSharedLedger(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = fetchLatestLedger()
    .then((ledger) => {
      publishLedgerUpdate({ ledger, failed: false });
    })
    .catch(() => {
      publishLedgerUpdate({ ledger: null, failed: true });
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * Subscribes to a browser-wide current-ledger poller. The first subscriber
 * starts polling; the last one stops it, so multiple dashboard widgets do not
 * create duplicate RPC requests.
 */
export function subscribeToLatestLedger(listener: LedgerListener): () => void {
  ledgerListeners.add(listener);
  if (ledgerListeners.size === 1) {
    void refreshSharedLedger();
    ledgerPoller = setInterval(() => void refreshSharedLedger(), DEFAULT_LEDGER_POLL_MS);
  }

  return () => {
    ledgerListeners.delete(listener);
    if (ledgerListeners.size === 0 && ledgerPoller) {
      clearInterval(ledgerPoller);
      ledgerPoller = null;
    }
  };
}

/**
 * Reads the latest closed ledger sequence from a Soroban RPC endpoint.
 * Throws when the endpoint is unreachable or answers with something that is
 * not a positive ledger number, so callers never display a guessed value.
 */
export async function fetchLatestLedger(
  rpcUrl: string = STELLAR_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });
  if (!res.ok) throw new Error(`getLatestLedger failed with status ${res.status}`);
  const body = await res.json();
  const sequence = Number(body?.result?.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("getLatestLedger returned no ledger sequence");
  }
  return sequence;
}
