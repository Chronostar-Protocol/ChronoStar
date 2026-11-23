'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { getAddressBook, saveAddressBookEntry, type AddressBookEntry } from '@/lib/addressBook';

export default function CreateVaultPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [releaseLedger, setReleaseLedger] = useState('');
  const [label, setLabel] = useState('');
  const [saveToBook, setSaveToBook] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<AddressBookEntry[]>([]);
  const [txStatus, setTxStatus] = useState<'pending' | 'success' | 'error' | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSavedAddresses(getAddressBook());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;
    if (saveToBook && recipient) {
      saveAddressBookEntry({ address: recipient, label: label || 'Vault Recipient' });
    }
    setTxStatus('pending');
    setTxHash(null);
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
        {savedAddresses.length > 0 && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-text-muted">Address book:</span>
            <select
              className="text-xs bg-bg-card border border-border rounded px-2 py-1 text-text-primary focus:outline-none"
              onChange={(e) => {
                if (e.target.value) setRecipient(e.target.value);
              }}
              defaultValue=""
            >
              <option value="" disabled>Pick saved recipient</option>
              {savedAddresses.map((entry) => (
                <option key={entry.address} value={entry.address}>
                  {entry.label} ({entry.address.slice(0, 4)}...{entry.address.slice(-4)})
                </option>
              ))}
            </select>
          </div>
        )}
        <Field testid="recipient-address" label="Recipient Address" value={recipient} onChange={setRecipient} placeholder="G..." />
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={saveToBook}
            onChange={(e) => setSaveToBook(e.target.checked)}
            className="rounded border-border"
          />
          Save recipient to address book
        </label>
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
