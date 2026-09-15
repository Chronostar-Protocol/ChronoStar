'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { DetailPageSkeleton } from '@/components/Skeleton';
import type { DCAEntry } from '@/types';

export default function DCADetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const [dca, setDca] = useState<DCAEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);

  useEffect(() => {
    if (!address) return;
    api.getDCA(address).then(dcas => {
      const found = dcas.find(d => d.id === Number(id));
      if (found) setDca(found);
    }).finally(() => setLoading(false));
  }, [address, id]);

  if (loading) {
    return <DetailPageSkeleton />;
  }

  if (!dca) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">DCA policy not found.</p>
        <Link href="/dashboard" className="text-sm text-accent-blue hover:underline mt-2 inline-block">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  const completed = dca.executions_completed;
  const totalExecs = dca.total_budget && dca.amount_per_swap
    ? Math.floor(Number(dca.total_budget) / Number(dca.amount_per_swap))
    : 0;

  return (
    <div className="max-w-lg mx-auto">
      <Link href="/dashboard" className="text-sm text-accent-blue hover:underline">&larr; Dashboard</Link>
      <h1 className="text-2xl font-heading font-bold text-text-primary mt-4 mb-6">DCA Policy #{dca.id}</h1>

      <div className="space-y-3 p-4 rounded-lg border border-border bg-bg-card">
        <DetailRow label="Label" value={dca.label} />
        <DetailRow label="Total Budget" value={dca.total_budget} />
        <DetailRow label="Remaining" value={dca.remaining_budget} />
        <DetailRow label="Per Swap" value={dca.amount_per_swap} />
        <DetailRow label="Executions" value={`${completed} / ${totalExecs}`} />
        <DetailRow label="Next Execution" value={String(dca.next_execution_ledger)} />
        <DetailRow label="Status" value={dca.status} />
      </div>

      {dca.status === 'Active' && (
        <button
          onClick={() => setTxStatus('pending')}
          className="mt-6 w-full py-3 rounded-lg bg-accent-red text-white font-medium hover:opacity-90"
        >
          Cancel DCA
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
