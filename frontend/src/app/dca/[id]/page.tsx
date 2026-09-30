'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { DetailPageSkeleton } from '@/components/Skeleton';
import type { DCAEntry, DCAExecution } from '@/types';

const HISTORY_PAGE_SIZE = 10;

export default function DCADetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const [dca, setDca] = useState<DCAEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [history, setHistory] = useState<DCAExecution[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchDCA = useCallback(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    api.getDCA(address)
      .then(dcas => {
        const found = dcas.find(d => d.id === Number(id));
        if (found) setDca(found);
        else setError('DCA policy not found. It may have been removed.');
      })
      .catch(() => setError('Failed to load DCA details. Please check your connection and try again.'))
      .finally(() => setLoading(false));
  }, [address, id]);

  useEffect(() => {
    fetchDCA();
  }, [fetchDCA]);

  useEffect(() => {
    if (!address || !id) return;
    let cancelled = false;
    setHistoryError(null);

    api
      .getDCAHistory(address, Number(id), (historyPage - 1) * HISTORY_PAGE_SIZE + 1, HISTORY_PAGE_SIZE)
      .then(res => {
        if (!cancelled) setHistory(res.executions || []);
      })
      .catch(() => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError('Failed to load execution history.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, id, historyPage]);

  if (loading) {
    return <DetailPageSkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3" aria-hidden="true">&#9888;</div>
        <h2 className="text-lg font-heading font-bold text-text-primary mb-2">Something went wrong</h2>
        <p className="text-text-muted text-sm mb-6">{error}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={fetchDCA}
            className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors"
          >
            &larr; Dashboard
          </Link>
        </div>
      </div>
    );
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

      <ExecutionHistory
        executions={history}
        total={completed}
        page={historyPage}
        pageSize={HISTORY_PAGE_SIZE}
        error={historyError}
        onPageChange={setHistoryPage}
      />

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

function ExecutionHistory({
  executions,
  total,
  page,
  pageSize,
  error,
  onPageChange,
}: {
  executions: DCAExecution[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.ceil(total / pageSize);

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-heading font-bold text-text-primary">Execution History</h2>
        {pageCount > 1 && (
          <span className="text-xs text-text-muted font-mono">
            Page {page} of {pageCount}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-accent-red mb-3">{error}</p>}

      {!error && executions.length === 0 && (
        <p className="text-sm text-text-muted py-4 text-center border border-border rounded-lg bg-bg-card">
          No executions recorded yet.
        </p>
      )}

      {executions.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated">
              <tr className="text-left text-text-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Ledger</th>
                <th className="px-3 py-2 font-medium text-right">In</th>
                <th className="px-3 py-2 font-medium text-right">Out</th>
                <th className="px-3 py-2 font-medium text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {executions.map(record => (
                <tr key={record.index} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-text-primary">{record.index}</td>
                  <td className="px-3 py-2 font-mono text-text-muted">{record.ledger}</td>
                  <td className="px-3 py-2 font-mono text-text-primary text-right">
                    {record.amount_in}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-primary text-right">
                    {record.amount_out}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-muted text-right">
                    {record.remaining_budget}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex justify-between items-center mt-3">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:text-text-muted"
          >
            &larr; Newer
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:text-text-muted"
          >
            Older &rarr;
          </button>
        </div>
      )}
    </section>
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