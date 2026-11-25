'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';

export default function CreateDCAPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tokenIn, setTokenIn] = useState('');
  const [swapReceiver, setSwapReceiver] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [amountPerSwap, setAmountPerSwap] = useState('');
  const [intervalLedgers, setIntervalLedgers] = useState('');
  const [label, setLabel] = useState('');
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!searchParams.get('duplicate')) return;
    setTokenIn(searchParams.get('tokenIn') ?? '');
    setSwapReceiver(searchParams.get('swapReceiver') ?? '');
    setTotalBudget(searchParams.get('totalBudget') ?? '');
    setAmountPerSwap(searchParams.get('amountPerSwap') ?? '');
    setIntervalLedgers(searchParams.get('intervalLedgers') ?? '');
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    setTxStatus('pending');
    setTxHash(null);
    setErrorMessage(undefined);

    try {
      const { createDcaTx } = await import('@/lib/contracts');
      const { hash } = await createDcaTx(address, {
        tokenIn,
        swapReceiver,
        totalBudget,
        amountPerSwap,
        intervalLedgers,
        label,
      });
      if (!hash) throw new Error('Transaction submission did not return a hash');
      setTxHash(hash);
      setTxStatus('success');
      setTimeout(() => router.push('/dashboard?tab=dca'), 1500);
    } catch (error: unknown) {
      setTxStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Transaction failed');
    }
  };

  if (!isConnected) {
    return <p className="text-text-muted text-center py-20">Connect your wallet to create a DCA policy.</p>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-heading font-bold text-text-primary mb-6">Create DCA Policy</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Token Address" value={tokenIn} onChange={setTokenIn} placeholder="C..." />
        <Field label="Swap Receiver" value={swapReceiver} onChange={setSwapReceiver} placeholder="Contract or wallet address" />
        <Field label="Total Budget" type="number" value={totalBudget} onChange={setTotalBudget} placeholder="1000000" />
        <Field label="Amount Per Swap" type="number" value={amountPerSwap} onChange={setAmountPerSwap} placeholder="100000" />
        <Field label="Interval (ledgers)" type="number" value={intervalLedgers} onChange={setIntervalLedgers} placeholder="e.g. 1440" />
        <Field label="Label" value={label} onChange={setLabel} placeholder="Weekly XLM DCA" maxLength={64} />
        {errorMessage && (
          <p role="alert" className="text-sm text-accent-red">{errorMessage}</p>
        )}
        <button
          type="submit"
          disabled={txStatus === 'pending'}
          className="w-full py-3 rounded-lg bg-accent-orange text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {txStatus === 'pending' ? 'Submitting...' : 'Create DCA Policy'}
        </button>
      </form>
      <TxToast
        status={txStatus}
        hash={txHash}
        message={txStatus === 'success' ? 'DCA policy created!' : errorMessage}
        onClose={() => setTxStatus(null)}
      />
    </div>
  );
}

function Field({ label, type = 'text', value, onChange, placeholder, maxLength }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-sm text-text-muted mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-orange transition-colors"
        required
      />
    </div>
  );
}
