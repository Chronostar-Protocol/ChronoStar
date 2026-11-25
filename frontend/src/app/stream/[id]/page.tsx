'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, getApiErrorMessage } from '@/lib/api';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { DetailPageSkeleton } from '@/components/Skeleton';
import { ShareModal } from '@/components/ShareModal';
import { scheduleDuplicateHref, type StreamEntry } from '@/types';

export default function StreamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const [stream, setStream] = useState<StreamEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handlePause = async () => {
    if (!address || !stream) return;
    setTxStatus('pending');
    setActionError(null);
    try {
      const { pauseStreamTx } = await import('@/lib/contracts');
      await pauseStreamTx(address, stream.id);
      setTxStatus('success');
      fetchStream();
    } catch (err: any) {
      setTxStatus('error');
      setActionError(err?.message || 'Failed to pause stream');
    }
  };

  const handleResume = async () => {
    if (!address || !stream) return;
    setTxStatus('pending');
    setActionError(null);
    try {
      const { resumeStreamTx } = await import('@/lib/contracts');
      await resumeStreamTx(address, stream.id);
      setTxStatus('success');
      fetchStream();
    } catch (err: any) {
      setTxStatus('error');
      setActionError(err?.message || 'Failed to resume stream');
    }
  };

  const activeRequest = useRef<AbortController | null>(null);

  const fetchStream = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (!address) {
      setLoading(false);
      setStream(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.getStreams(address, { signal: controller.signal })
      .then(streams => {
        if (controller.signal.aborted) return;
        const found = streams.find(item => item.id === Number(id));
        if (found) setStream(found);
        else {
          setStream(null);
          setError('Stream not found. It may have been removed.');
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [address, id]);

  useEffect(() => {
    fetchStream();
    return () => activeRequest.current?.abort();
  }, [fetchStream]);

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
            onClick={fetchStream}
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

  if (!stream) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Stream not found.</p>
        <Link href="/dashboard" className="text-sm text-accent-blue hover:underline mt-2 inline-block">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  const claimed = Number(stream.claimed_amount);
  const total = Number(stream.total_amount);
  const progress = total > 0 ? (claimed / total) * 100 : 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-accent-blue hover:underline">&larr; Dashboard</Link>
        <div className="flex gap-2">
          <Link href={scheduleDuplicateHref(stream)} className="text-xs px-3 py-1 rounded border border-border hover:bg-bg-card transition-colors text-text-muted">
            Duplicate
          </Link>
          <button onClick={() => setShareOpen(true)} className="text-xs px-3 py-1 rounded border border-border hover:bg-bg-card transition-colors text-text-muted">
            Share QR
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-heading font-bold text-text-primary mt-4 mb-6">Stream #{stream.id}</h1>

      <div className="space-y-3 p-4 rounded-lg border border-border bg-bg-card">
        <DetailRow label="Label" value={stream.label} />
        <DetailRow label="Recipient" value={stream.recipient} />
        <DetailRow label="Total Amount" value={stream.total_amount} />
        <DetailRow label="Claimed" value={stream.claimed_amount} />
        {stream.status === 'Active' && stream.claimable_amount && (
          <DetailRow label="Claimable Now" value={stream.claimable_amount} />
        )}
        <DetailRow label="Progress" value={`${progress.toFixed(1)}%`} />
        <DetailRow label="End Ledger" value={String(stream.end_ledger)} />
        <DetailRow label="Status" value={stream.status} />
      </div>

      {stream.status === 'Active' && (
        <button
          onClick={() => setTxStatus('pending')}
          className="mt-6 w-full py-3 rounded-lg bg-accent-green text-white font-medium hover:opacity-90"
        >
          Claim
        </button>
      )}

      <ShareModal
        title={`Stream #${stream.id}`}
        url={typeof window !== 'undefined' ? window.location.href : ''}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      <TxToast status={txStatus} onClose={() => setTxStatus(null)} />
      {address && stream.owner === address && (
        <div className="mt-4 flex gap-3">
          {stream.status === 'Active' && (
            <button
              onClick={handlePause}
              disabled={txStatus === 'pending'}
              className="flex-1 py-2.5 rounded-lg border border-accent-orange text-accent-orange font-medium hover:bg-accent-orange/10 transition-colors disabled:opacity-50"
            >
              Pause Stream
            </button>
          )}
          {stream.status === 'Paused' && (
            <button
              onClick={handleResume}
              disabled={txStatus === 'pending'}
              className="flex-1 py-2.5 rounded-lg bg-accent-blue text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Resume Stream
            </button>
          )}
        </div>
      )}

      <TxToast status={txStatus} message={actionError || undefined} onClose={() => { setTxStatus(null); setActionError(null); }} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value}</span>
    </div>
  );
}
