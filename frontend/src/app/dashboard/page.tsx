'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useWallet } from '@/lib/store';
import { api } from '@/lib/api';
import { DashboardSkeleton } from '@/components/Skeleton';
import type { VaultEntry, StreamEntry, DCAEntry } from '@/types';

type Tab = 'vaults' | 'streams' | 'dca';

export default function DashboardPage() {
  const { address, isConnected } = useWallet();
  const [tab, setTab] = useState<Tab>('vaults');
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [dcas, setDcas] = useState<DCAEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    Promise.all([
      api.getSchedules(address).catch(() => []),
      api.getStreams(address).catch(() => []),
      api.getDCA(address).catch(() => []),
    ])
      .then(([v, s, d]) => {
        setVaults(v);
        setStreams(s);
        setDcas(d);
      })
      .finally(() => setLoading(false));
  }, [address]);

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-heading font-bold text-text-primary">Connect your wallet</h1>
        <p className="mt-2 text-text-muted">Connect Freighter to view your schedules.</p>
      </div>
    );
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  const tabs: { key: Tab; label: string; count: number; newLink: string }[] = [
    { key: 'vaults', label: 'Vaults', count: vaults.length, newLink: '/vault/new' },
    { key: 'streams', label: 'Streams', count: streams.length, newLink: '/stream/new' },
    { key: 'dca', label: 'DCA', count: dcas.length, newLink: '/dca/new' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-heading font-bold text-text-primary">Dashboard</h1>
        <Link
          href={tabs.find(t => t.key === tab)?.newLink || '/vault/new'}
          className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          New {tab === 'vaults' ? 'Vault' : tab === 'streams' ? 'Stream' : 'DCA'}
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === 'vaults' && <ItemList items={vaults} type="vault" />}
      {tab === 'streams' && <ItemList items={streams} type="stream" />}
      {tab === 'dca' && <ItemList items={dcas} type="dca" />}
    </div>
  );
}

function ItemList({ items, type }: { items: any[]; type: string }) {
  if (items.length === 0) {
    return <p className="text-text-muted py-8 text-center">No {type} found.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/${type}/${item.id}`}
          className="block p-4 rounded-lg border border-border bg-bg-card hover:bg-bg-elevated transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-mono text-text-muted">#{item.id}</span>
              <span className="ml-3 text-text-primary font-medium">{item.label}</span>
            </div>
            <StatusBadge status={item.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active: 'bg-accent-green/10 text-accent-green border-accent-green/30',
    Released: 'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
    Completed: 'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
    Cancelled: 'bg-accent-red/10 text-accent-red border-accent-red/30',
    Exhausted: 'bg-accent-orange/10 text-accent-orange border-accent-orange/30',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[status] || ''}`}>
      {status}
    </span>
  );
}
