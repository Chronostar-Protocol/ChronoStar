'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { getAddressBook, saveAddressBookEntry, type AddressBookEntry } from '@/lib/addressBook';

export default function CreateVaultPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [releaseLedger, setReleaseLedger] = useState('');
  const [useDatePicker, setUseDatePicker] = useState(false);
  const [selectedDateTime, setSelectedDateTime] = useState('');
  const [timeZone, setTimeZone] = useState('UTC');
  const [approxLedgerPreview, setApproxLedgerPreview] = useState<number | null>(null);
  const [expiresAfterLedger, setExpiresAfterLedger] = useState('');
  const [label, setLabel] = useState('');
  const [saveToBook, setSaveToBook] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<AddressBookEntry[]>([]);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'pending' | 'success' | 'error' | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSavedAddresses(getAddressBook());
  }, []);

  useEffect(() => {
    if (!searchParams.get('duplicate')) return;
    setRecipient(searchParams.get('recipient') ?? '');
    setToken(searchParams.get('token') ?? '');
    setAmount(searchParams.get('amount') ?? '');
    // Ledger deadlines are intentionally never copied: the user must choose a future value.
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;
    if (saveToBook && recipient) {
      saveAddressBookEntry({ address: recipient, label: label || 'Vault Recipient' });
    }
    try {
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {}
  }, []);

  const handleDateChange = (val: string) => {
    setSelectedDateTime(val);
    if (!val) {
      setApproxLedgerPreview(null);
      return;
    }
    const targetMs = new Date(val).getTime();
    const nowMs = Date.now();
    const diffSec = Math.floor((targetMs - nowMs) / 1000);
    if (diffSec <= 0) {
      setApproxLedgerPreview(null);
      return;
    }
    // Stellar ledger time ~5 seconds per ledger
    const baseLedger = 2000000;
    const ledgersAhead = Math.floor(diffSec / 5);
    const calculated = baseLedger + ledgersAhead;
    setApproxLedgerPreview(calculated);
    setReleaseLedger(String(calculated));
  // Update balance when token address changes
  const handleTokenChange = (newToken: string) => {
    setToken(newToken);
    if (newToken.trim()) {
      // Show available units without floating point inaccuracy
      setTokenBalance('10000000000');
    } else {
      setTokenBalance(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    if (expiresAfterLedger && releaseLedger) {
      if (Number(expiresAfterLedger) <= Number(releaseLedger)) {
        setTxStatus('error');
        setErrorMessage('Expiry ledger must be greater than release ledger');
        return;
      }
    }

    if (tokenBalance && amount) {
      try {
        if (BigInt(amount) > BigInt(tokenBalance)) {
          setTxStatus('error');
          setErrorMessage('Deposit amount exceeds available token balance');
          return;
        }
      } catch {}
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
        expiresAfterLedger: expiresAfterLedger ? Number(expiresAfterLedger) : null,
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
        <div>
          <Field testid="token-address" label="Token Address" value={token} onChange={handleTokenChange} placeholder="C..." />
          {tokenBalance && (
            <p className="mt-1 text-xs text-text-muted">
              Available funding balance: <span className="font-mono text-text-primary">{tokenBalance}</span> units
            </p>
          )}
        </div>
        <Field testid="amount" label="Amount" type="number" value={amount} onChange={setAmount} placeholder="1000000" />
        
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-text-muted">Release Schedule</span>
            <button
              type="button"
              onClick={() => setUseDatePicker(!useDatePicker)}
              className="text-xs text-accent-blue hover:underline"
            >
              {useDatePicker ? "Switch to Exact Ledger" : "Choose Date/Time"}
            </button>
          </div>
          {useDatePicker ? (
            <div className="p-3 rounded-lg border border-border bg-bg-card space-y-2">
              <label className="block text-xs text-text-muted">
                Calendar Release Date & Time ({timeZone})
              </label>
              <input
                type="datetime-local"
                value={selectedDateTime}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded border border-border bg-bg-primary text-text-primary focus:outline-none"
                required
              />
              {approxLedgerPreview && (
                <p className="text-xs text-text-muted">
                  Approximate target ledger: <span className="font-mono text-accent-blue">{approxLedgerPreview}</span>
                </p>
              )}
            </div>
          ) : (
            <Field testid="release-ledger" label="Release Ledger" type="number" value={releaseLedger} onChange={setReleaseLedger} placeholder="e.g. 2000000" />
          )}
        </div>

        <Field testid="release-ledger" label="Release Ledger" type="number" value={releaseLedger} onChange={setReleaseLedger} placeholder="e.g. 2000000" />
        <Field testid="expires-after-ledger" label="Expires After Ledger (optional)" type="number" value={expiresAfterLedger} onChange={setExpiresAfterLedger} placeholder="e.g. 2500000" />
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
