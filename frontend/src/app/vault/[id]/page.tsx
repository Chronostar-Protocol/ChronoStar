'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { DetailPageSkeleton } from '@/components/Skeleton';
import type { VaultEntry } from '@/types';

export default function VaultDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const [vault, setVault] = useState<VaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);

  useEffect(() => {
    if (!address) return;
    api.getSchedules(address).then(vaults => {
      const found = vaults.find(v => v.id === Number(id));
      if (found) setVault(found);
    }).finally(() => setLoading(false));
  }, [address, id]);

  if (loading) {
    return <DetailPageSkeleton />;
  }

  if (!vault) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Vault not found.</p>
        <Link href="/dashboard" className="text-sm text-accent-blue hover:underline mt-2 inline-block">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <Link href="/dashboard" className="text-sm text-accent-blue hover:underline">&larr; Dashboard</Link>
      <h1 className="text-2xl font-heading font-bold text-text-primary mt-4 mb-6">Vault #{vault.id}</h1>

      <div className="space-y-3 p-4 rounded-lg border border-border bg-bg-card">
        <DetailRow label="Label" value={vault.label} />
        <DetailRow label="Recipient" value={vault.recipient} />
        <DetailRow label="Amount" value={vault.amount} />
        <DetailRow label="Release Ledger" value={String(vault.release_ledger)} />
        <DetailRow label="Status" value={vault.status} />
      </div>

      {vault.status === 'Active' && (
        <button
          onClick={() => setTxStatus('pending')}
          className="mt-6 w-full py-3 rounded-lg bg-accent-red text-white font-medium hover:opacity-90"
        >
          Cancel Vault
        </button>
      )}

      <TxToast status={txStatus} onClose={() => setTxStatus(null)} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value}</span>
    </div>
  );
}
