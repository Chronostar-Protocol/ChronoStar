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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTxStatus('pending');
    setTxStatus('success');
    setTimeout(() => router.push('/dashboard'), 1500);
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
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-accent-green text-white font-medium hover:opacity-90 transition-opacity"
        >
          Create Stream
        </button>
      </form>
      <TxToast status={txStatus} message={txStatus === 'success' ? 'Stream created!' : undefined} onClose={() => setTxStatus(null)} />
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
