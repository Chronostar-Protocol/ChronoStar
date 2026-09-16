'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@/lib/store';
import { api } from '@/lib/api';
import { DashboardSkeleton } from '@/components/Skeleton';
import type { VaultEntry, StreamEntry, DCAEntry } from '@/types';

type Tab = 'vaults' | 'streams' | 'dca';

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

export default function DashboardPage() {
  const { address, isConnected } = useWallet();
  const [tab, setTab] = useState<Tab>('vaults');
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [dcas, setDcas] = useState<DCAEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    if (!address) return;
    setError(null);
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
      .catch(() => {
        setError('Failed to load dashboard data. Please check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 flex items-center justify-center mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-accent-blue"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
          </svg>
        </div>
        <h1 className="text-2xl font-heading font-bold text-text-primary mb-2">
          Connect Your Wallet
        </h1>
        <p className="text-text-muted max-w-sm mb-6">
          Link your Freighter wallet to view your vaults, streams, and DCA policies on the Stellar network.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <a
            href="https://www.freighter.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Get Freighter
          </a>
          <Link
            href="/explorer"
            className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors"
          >
            Browse Explorer Instead
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchData} />;
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