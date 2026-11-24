"use client";

import { useEffect, useState } from "react";
import { fetchLatestLedger } from "@/lib/ledger";
import { SECONDS_PER_LEDGER } from "@/lib/network";

interface CurrentLedgerProps {
  /** How often to refresh the ledger number, in milliseconds. */
  pollMs?: number;
  /** Injectable for tests; defaults to a Soroban RPC `getLatestLedger` call. */
  loadLedger?: () => Promise<number>;
  className?: string;
}

/**
 * Shows the network's current ledger. While the value is loading, or when the
 * RPC cannot be reached, it says so instead of showing a placeholder number.
 */
export function CurrentLedger({
  pollMs = SECONDS_PER_LEDGER * 1000,
  loadLedger = () => fetchLatestLedger(),
  className = "",
}: CurrentLedgerProps) {
  const [ledger, setLedger] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadLedger();
        if (cancelled) return;
        setLedger(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // loadLedger is expected to be stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  const text = ledger !== null ? ledger.toLocaleString("en-US") : failed ? "unavailable" : "…";

  return (
    <div
      data-testid="current-ledger"
      data-state={ledger !== null ? (failed ? "stale" : "live") : failed ? "error" : "loading"}
      className={`inline-flex flex-col text-xs font-mono bg-bg-card border border-border rounded px-2.5 py-1 ${className}`}
      title={
        failed && ledger !== null
          ? "Showing the last known ledger; the RPC is not responding"
          : "Current network ledger"
      }
    >
      <span className="text-text-muted text-[10px]">Ledger</span>
      <span
        className={
          failed && ledger === null
            ? "text-accent-red font-semibold"
            : "text-accent-blue font-semibold"
        }
      >
        {text}
      </span>
    </div>
  );
}
