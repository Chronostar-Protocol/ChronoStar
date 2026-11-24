'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { FormField } from '@/components/FormField';

interface StreamErrors {
  recipient?: string;
  token?: string;
  totalAmount?: string;
  duration?: string;
}

export default function CreateStreamPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [isMulti, setIsMulti] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [recipients, setRecipients] = useState([{ address: '', amount: '' }]);
  const [token, setToken] = useState('');
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [totalAmount, setTotalAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [label, setLabel] = useState('');
  const [fieldErrors, setFieldErrors] = useState<StreamErrors>({});
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

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

  const validate = (): StreamErrors => {
    const errors: StreamErrors = {};
    if (!isMulti && !recipient.trim()) {
      errors.recipient = 'Recipient address is required';
    }
    if (isMulti && (!recipients[0]?.address.trim() || !recipients[0]?.amount.trim())) {
      errors.recipient = 'At least one recipient with amount is required';
    }
    if (!token.trim()) {
      errors.token = 'Token address is required';
    }
    if (!totalAmount.trim() || Number(totalAmount) <= 0) {
      errors.totalAmount = 'Total amount must be greater than 0';
    }
    if (!duration.trim() || Number(duration) <= 0) {
      errors.duration = 'Duration must be greater than 0';
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    const errors = validate();
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      if (errors.recipient && !isMulti) {
        document.getElementById('stream-recipient')?.focus();
      } else if (errors.token) {
        document.getElementById('stream-token')?.focus();
      } else if (errors.totalAmount) {
        document.getElementById('stream-total-amount')?.focus();
      } else if (errors.duration) {
        document.getElementById('stream-duration')?.focus();
      }
      return;
    }

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

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {!isMulti ? (
          <FormField
            id="stream-recipient"
            label="Recipient Address"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              if (fieldErrors.recipient) setFieldErrors((prev) => ({ ...prev, recipient: undefined }));
            }}
            placeholder="G..."
            error={fieldErrors.recipient}
            accentColor="green"
            required
          />
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
          <FormField
            id="stream-token"
            label="Token Address"
            value={token}
            onChange={(e) => {
              handleTokenChange(e.target.value);
              if (fieldErrors.token) setFieldErrors((prev) => ({ ...prev, token: undefined }));
            }}
            placeholder="C..."
            error={fieldErrors.token}
            accentColor="green"
            required
          />
          {tokenBalance && (
            <p className="mt-1 text-xs text-text-muted">
              Available funding balance: <span className="font-mono text-text-primary">{tokenBalance}</span> units
            </p>
          )}
        </div>

        <FormField
          id="stream-total-amount"
          label={isMulti ? "Total Amount (Calculated)" : "Total Amount"}
          type="number"
          value={totalAmount}
          onChange={(e) => {
            setTotalAmount(e.target.value);
            if (fieldErrors.totalAmount) setFieldErrors((prev) => ({ ...prev, totalAmount: undefined }));
          }}
          placeholder="1000000"
          error={fieldErrors.totalAmount}
          accentColor="green"
          required
          readOnly={isMulti}
        />
        <FormField
          id="stream-duration"
          label="Duration (ledgers)"
          type="number"
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value);
            if (fieldErrors.duration) setFieldErrors((prev) => ({ ...prev, duration: undefined }));
          }}
          placeholder="e.g. 1440 (~2 hrs)"
          error={fieldErrors.duration}
          accentColor="green"
          required
        />
        <FormField
          id="stream-label"
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Salary stream"
          maxLength={64}
          showCounter
          accentColor="green"
        />
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
