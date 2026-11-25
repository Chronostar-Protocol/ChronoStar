'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@/lib/store';
import { api, getApiErrorMessage } from '@/lib/api';
import { DashboardSkeleton } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';
import type { VaultEntry, StreamEntry, DCAEntry } from '@/types';

type Tab = 'vaults' | 'streams' | 'dca';
type RoleFilter = 'all' | 'owner' | 'recipient';

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
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('vaults');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [dcas, setDcas] = useState<DCAEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (!address) { setLoading(false); return; }
    setError(null);
    setLoading(true);
    const options = { signal: controller.signal };
    Promise.all([
      api.getSchedules(address, options),
      api.getStreams(address, options),
      api.getDCA(address, options),
    ])
      .then(([v, s, d]) => {
        if (controller.signal.aborted) return;
        setVaults(v); setStreams(s); setDcas(d);
        setLastUpdated(new Date());
        setIsStale(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(err));
          setIsStale(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [address]);

  useEffect(() => {
    fetchData();
    return () => activeRequest.current?.abort();
  }, [fetchData]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'vaults' || requestedTab === 'streams' || requestedTab === 'dca') {
      setTab(requestedTab);
    }
  }, []);

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

  const filteredVaults = vaults.filter((v) => {
    if (roleFilter === 'owner') return v.owner === address;
    if (roleFilter === 'recipient') return v.recipient === address;
    return true;
  });
  const filteredStreams = streams.filter((s) => {
    if (roleFilter === 'owner') return s.owner === address;
    if (roleFilter === 'recipient') return s.recipient === address;
    return true;
  });
  const filteredDcas = dcas.filter((d) => {
    if (roleFilter === 'owner') return d.owner === address;
    if (roleFilter === 'recipient') return d.swap_receiver === address;
    return true;
  });

  const tabs: { key: Tab; label: string; count: number; newLink: string }[] = [
    { key: 'vaults', label: 'Vaults', count: filteredVaults.length, newLink: '/vault/new' },
    { key: 'streams', label: 'Streams', count: filteredStreams.length, newLink: '/stream/new' },
    { key: 'dca', label: 'DCA', count: filteredDcas.length, newLink: '/dca/new' },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-heading font-bold text-text-primary">{t.dashboard.title}</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-border rounded-lg p-0.5 bg-bg-card text-xs">
            <button
              onClick={() => setRoleFilter('all')}
              className={`px-3 py-1 rounded-md transition-colors ${
                roleFilter === 'all' ? 'bg-accent-blue text-white font-medium' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t.dashboard.allRoles}
            </button>
            <button
              onClick={() => setRoleFilter('owner')}
              className={`px-3 py-1 rounded-md transition-colors ${
                roleFilter === 'owner' ? 'bg-accent-blue text-white font-medium' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t.dashboard.ownerRole}
            </button>
            <button
              onClick={() => setRoleFilter('recipient')}
              className={`px-3 py-1 rounded-md transition-colors ${
                roleFilter === 'recipient' ? 'bg-accent-blue text-white font-medium' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t.dashboard.recipientRole}
            </button>
          </div>
          <Link
            href={tabs.find((t) => t.key === tab)?.newLink || '/vault/new'}
            className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            New {tab === 'vaults' ? 'Vault' : tab === 'streams' ? 'Stream' : 'DCA'}
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Dashboard</h1>
          {lastUpdated && (
            <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
              <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
              {isStale && <span className="text-accent-orange font-medium">(stale)</span>}
              <button
                onClick={fetchData}
                className="text-accent-blue hover:underline ml-1 cursor-pointer"
                title="Refresh dashboard"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
        <Link
          href={tabs.find(t => t.key === tab)?.newLink || '/vault/new'}
          className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          New {tab === 'vaults' ? 'Vault' : tab === 'streams' ? 'Stream' : 'DCA'}
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map((t) => (
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

      {tab === 'vaults' && <ItemList items={filteredVaults} type="vault" />}
      {tab === 'streams' && <ItemList items={filteredStreams} type="stream" />}
      {tab === 'dca' && <ItemList items={filteredDcas} type="dca" />}
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
    Paused: 'bg-accent-orange/10 text-accent-orange border-accent-orange/30',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[status] || ''}`}>
      {status}
    </span>
  );
}