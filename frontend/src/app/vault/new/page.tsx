'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';

export default function CreateVaultPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [releaseLedger, setReleaseLedger] = useState('');
  const [label, setLabel] = useState('');
  const [txStatus, setTxStatus] = useState<'pending' | 'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;
    setTxStatus('pending');
    setErrorMessage(undefined);

    try {
      const { createVaultTx } = await import('@/lib/contracts');
      const { hash } = await createVaultTx(address, {
        recipient,
        token,
        amount,
        releaseLedger,
        label,
      });
      setTxStatus('success');
      setTxHash(hash);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err: any) {
      setTxStatus('error');
      setErrorMessage(err?.message || 'Transaction failed');
    }
  };

  if (!isConnected) {
    return <p className="text-text-muted text-center py-20">Connect your wallet to create a vault.</p>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-heading font-bold text-text-primary mb-6">Create Vault</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field testid="recipient-address" label="Recipient Address" value={recipient} onChange={setRecipient} placeholder="G..." />
        <Field testid="token-address" label="Token Address" value={token} onChange={setToken} placeholder="C..." />
        <Field testid="amount" label="Amount" type="number" value={amount} onChange={setAmount} placeholder="1000000" />
        <Field testid="release-ledger" label="Release Ledger" type="number" value={releaseLedger} onChange={setReleaseLedger} placeholder="e.g. 2000000" />
        <Field testid="label" label="Label" value={label} onChange={setLabel} placeholder="My vault" maxLength={64} showCounter />
        <button
          type="submit"
          disabled={txStatus === 'pending'}
          data-testid="create-vault-submit"
          className="w-full py-3 rounded-lg bg-accent-blue text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {txStatus === 'pending' ? 'Submitting...' : 'Create Vault'}
        </button>
      </form>
      <TxToast status={txStatus} hash={txHash} message={txStatus === 'success' ? 'Vault created!' : errorMessage} onClose={() => setTxStatus(null)} />
    </div>
  );
}

function Field({ label, type = 'text', value, onChange, placeholder, maxLength, testid, showCounter }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; testid?: string; showCounter?: boolean;
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
        data-testid={testid}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-blue transition-colors"
        required
      />
    </div>
  );
}
