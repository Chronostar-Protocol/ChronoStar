'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';

export default function CreateStreamPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [label, setLabel] = useState('');
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    setTxStatus('pending');
    setTxHash(null);
    setErrorMessage(undefined);

    try {
      const { createStreamTx } = await import('@/lib/contracts');
      const { hash } = await createStreamTx(address, {
        recipient,
        token,
        totalAmount,
        durationLedgers: duration,
        label,
      });
      if (!hash) throw new Error('Transaction submission did not return a hash');
      setTxHash(hash);
      setTxStatus('success');
      setTimeout(() => router.push('/dashboard?tab=streams'), 1500);
    } catch (error: unknown) {
      setTxStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Transaction failed');
    }
  };

  if (!isConnected) {
    return <p className="text-text-muted text-center py-20">Connect your wallet to create a stream.</p>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-heading font-bold text-text-primary mb-6">Create Stream</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Recipient Address" value={recipient} onChange={setRecipient} placeholder="G..." />
        <Field label="Token Address" value={token} onChange={setToken} placeholder="C..." />
        <Field label="Total Amount" type="number" value={totalAmount} onChange={setTotalAmount} placeholder="1000000" />
        <Field label="Duration (ledgers)" type="number" value={duration} onChange={setDuration} placeholder="e.g. 1440 (~2 hrs)" />
        <Field label="Label" value={label} onChange={setLabel} placeholder="Salary stream" maxLength={64} showCounter />
        {errorMessage && (
          <p role="alert" className="text-sm text-accent-red">{errorMessage}</p>
        )}
        <button
          type="submit"
          disabled={txStatus === 'pending'}
          className="w-full py-3 rounded-lg bg-accent-green text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {txStatus === 'pending' ? 'Submitting...' : 'Create Stream'}
        </button>
      </form>
      <TxToast
        status={txStatus}
        hash={txHash}
        message={txStatus === 'success' ? 'Stream created!' : errorMessage}
        onClose={() => setTxStatus(null)}
      />
    </div>
  );
}

function Field({ label, type = 'text', value, onChange, placeholder, maxLength, showCounter }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; showCounter?: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="block text-sm text-text-muted">{label}</label>
        {showCounter && maxLength && (
          <span className="text-xs text-text-muted">{value.length}/{maxLength}</span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-green transition-colors"
        required
      />
    </div>
  );
}
