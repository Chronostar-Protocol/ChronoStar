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
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [label, setLabel] = useState('');
  const [fieldErrors, setFieldErrors] = useState<StreamErrors>({});
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const validate = (): StreamErrors => {
    const errors: StreamErrors = {};
    if (!recipient.trim()) {
      errors.recipient = 'Recipient address is required';
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
      if (errors.recipient) {
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
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
        <FormField
          id="stream-token"
          label="Token Address"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            if (fieldErrors.token) setFieldErrors((prev) => ({ ...prev, token: undefined }));
          }}
          placeholder="C..."
          error={fieldErrors.token}
          accentColor="green"
          required
        />
        <FormField
          id="stream-total-amount"
          label="Total Amount"
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
