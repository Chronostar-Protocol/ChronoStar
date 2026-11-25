'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';

export default function CreateStreamPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isMulti, setIsMulti] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [recipients, setRecipients] = useState([{ address: '', amount: '' }]);
  const [token, setToken] = useState('');
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [totalAmount, setTotalAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [label, setLabel] = useState('');
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!searchParams.get('duplicate')) return;
    setRecipient(searchParams.get('recipient') ?? '');
    setToken(searchParams.get('token') ?? '');
    setTotalAmount(searchParams.get('totalAmount') ?? '');
    // Duration is deliberately blank so a duplicated stream cannot inherit an expired end ledger.
  }, [searchParams]);

  const handleTokenChange = (t: string) => {
    setToken(t);
    if (t.trim()) {
      setTokenBalance('10000000000');
    } else {
      setTokenBalance(null);
    }
  };

  const addRecipientRow = () => {
    setRecipients([...recipients, { address: '', amount: '' }]);
  };

  const updateRecipientRow = (index: number, field: 'address' | 'amount', val: string) => {
    const updated = [...recipients];
    updated[index][field] = val;
    setRecipients(updated);
    const sum = updated.reduce((acc, curr) => {
      try {
        return acc + BigInt(curr.amount || 0);
      } catch {
        return acc;
      }
    }, 0n);
    setTotalAmount(sum.toString());
  };

  const removeRecipientRow = (index: number) => {
    if (recipients.length <= 1) return;
    const updated = recipients.filter((_, i) => i !== index);
    setRecipients(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    if (tokenBalance && totalAmount) {
      try {
        if (BigInt(totalAmount) > BigInt(tokenBalance)) {
          setTxStatus('error');
          setErrorMessage('Total amount exceeds available token balance');
          return;
        }
      } catch {}
    }

    setTxStatus('pending');
    setTxHash(null);
    setErrorMessage(undefined);

    try {
      const { createStreamTx } = await import('@/lib/contracts');
      const targetRecipient = isMulti ? recipients[0].address : recipient;
      const targetAmount = isMulti ? recipients[0].amount : totalAmount;
      const { hash } = await createStreamTx(address, {
        recipient: targetRecipient,
        token,
        totalAmount: targetAmount,
        durationLedgers: duration,
        label: label || (isMulti ? 'Multi-Stream' : 'Stream'),
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-heading font-bold text-text-primary">Create Stream</h1>
        <button
          type="button"
          onClick={() => setIsMulti(!isMulti)}
          className="text-xs px-3 py-1.5 rounded border border-border hover:bg-bg-card transition-colors text-text-muted"
        >
          {isMulti ? "Single Recipient Mode" : "Multi-Recipient Mode"}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {!isMulti ? (
          <Field label="Recipient Address" value={recipient} onChange={setRecipient} placeholder="G..." />
        ) : (
          <div className="space-y-3 p-3 rounded-lg border border-border bg-bg-card">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">Recipients</span>
              <button
                type="button"
                onClick={addRecipientRow}
                className="text-xs text-accent-blue hover:underline"
              >
                + Add Recipient
              </button>
            </div>
            {recipients.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Recipient (G...)"
                  value={r.address}
                  onChange={(e) => updateRecipientRow(idx, 'address', e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs rounded border border-border bg-bg-primary text-text-primary focus:outline-none"
                  required
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={r.amount}
                  onChange={(e) => updateRecipientRow(idx, 'amount', e.target.value)}
                  className="w-28 px-3 py-1.5 text-xs rounded border border-border bg-bg-primary text-text-primary focus:outline-none"
                  required
                />
                {recipients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRecipientRow(idx)}
                    className="text-accent-red text-xs px-1"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div>
          <Field label="Token Address" value={token} onChange={handleTokenChange} placeholder="C..." />
          {tokenBalance && (
            <p className="mt-1 text-xs text-text-muted">
              Available funding balance: <span className="font-mono text-text-primary">{tokenBalance}</span> units
            </p>
          )}
        </div>

        <Field
          label={isMulti ? "Total Amount (Calculated)" : "Total Amount"}
          type="number"
          value={totalAmount}
          onChange={setTotalAmount}
          placeholder="1000000"
        />
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
