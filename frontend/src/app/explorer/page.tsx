'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { api, getApiErrorMessage } from '@/lib/api';
import { LedgerClock } from '@/components/LedgerClock';
import { ExplorerSkeleton } from '@/components/Skeleton';
import { ledgersToHuman } from '@/lib/utils';
import type { ScheduleEvent } from '@/types';

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3" aria-hidden="true">&#9888;</div>
      <h2 className="text-lg font-heading font-bold text-text-primary mb-2">
        Something went wrong
      </h2>
      <p className="text-text-muted text-sm mb-6">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Try again
      </button>
    </div>
  );
}

export default function ExplorerPage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const fetchEvents = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    api.getEvents(100, { signal: controller.signal })
      .then((items) => { if (!controller.signal.aborted) setEvents(items); })
      .catch((err) => { if (!controller.signal.aborted) setError(getApiErrorMessage(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    fetchEvents();
    return () => activeRequest.current?.abort();
  }, [fetchEvents]);

  if (loading) {
    return <ExplorerSkeleton />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchEvents} />;
  }

  return (
    <div>
      <h1 className="text-2xl font-heading font-bold text-text-primary mb-6">Explorer</h1>
      <p className="text-sm text-text-muted mb-6">Upcoming schedule events across all contracts.</p>

      {events.length === 0 ? (
        <p className="text-text-muted text-center py-12">No upcoming events.</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev, i) => (
            <Link
              key={`${ev.type}-${ev.id}-${i}`}
              href={`/${ev.type}/${ev.id}`}
              className="block p-3 rounded-lg border border-border bg-bg-card hover:bg-bg-elevated transition-colors"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <TypeBadge type={ev.type} />
                  <span className="text-sm font-mono text-text-muted">#{ev.id}</span>
                  <span className="text-sm text-text-primary">
                    {ev.type === 'vault' ? 'Release' : ev.type === 'stream' ? 'Complete' : 'Swap'} in <strong>{ev.remainingLedgers}</strong> ledgers ({ledgersToHuman(ev.remainingLedgers)})
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <LedgerClock targetLedger={ev.targetLedger} currentLedger={ev.targetLedger - ev.remainingLedgers} />
                  <span className="text-xs text-text-muted font-mono">Ledger {ev.targetLedger}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    vault: 'bg-accent-blue/10 text-accent-blue',
    stream: 'bg-accent-green/10 text-accent-green',
    dca: 'bg-accent-orange/10 text-accent-orange',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type] || ''}`}>
      {type}
    </span>
  );
}
