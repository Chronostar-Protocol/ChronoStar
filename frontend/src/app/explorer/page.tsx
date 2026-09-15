'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ExplorerSkeleton } from '@/components/Skeleton';
import type { ScheduleEvent } from '@/types';

export default function ExplorerPage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEvents(100).then(setEvents).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <ExplorerSkeleton />;
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TypeBadge type={ev.type} />
                  <span className="text-sm font-mono text-text-muted">#{ev.id}</span>
                  <span className="text-sm text-text-primary">{ev.type === 'vault' ? 'Release' : ev.type === 'stream' ? 'Complete' : 'Swap'} in <strong>{ev.remainingLedgers}</strong> ledgers</span>
                </div>
                <span className="text-xs text-text-muted">Ledger {ev.targetLedger}</span>
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
