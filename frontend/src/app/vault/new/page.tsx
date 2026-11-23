'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { FormField } from '@/components/FormField';

interface FormErrors {
  recipient?: string;
  token?: string;
  amount?: string;
  releaseLedger?: string;
}

export default function CreateVaultPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [recipient, setRecipient] = useState('');
  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [releaseLedger, setReleaseLedger] = useState('');
  const [label, setLabel] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [txStatus, setTxStatus] = useState<'pending' | 'success' | 'error' | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const validate = (): FormErrors => {
    const errors: FormErrors = {};
    if (!recipient.trim()) {
      errors.recipient = 'Recipient address is required';
    }
    if (!token.trim()) {
      errors.token = 'Token address is required';
    }
    if (!amount.trim() || Number(amount) <= 0) {
      errors.amount = 'Amount must be greater than 0';
    }
    if (!releaseLedger.trim() || Number(releaseLedger) <= 0) {
      errors.releaseLedger = 'Release ledger must be greater than 0';
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
        document.getElementById('vault-recipient')?.focus();
      } else if (errors.token) {
        document.getElementById('vault-token')?.focus();
      } else if (errors.amount) {
        document.getElementById('vault-amount')?.focus();
      } else if (errors.releaseLedger) {
        document.getElementById('vault-release-ledger')?.focus();
      }
      return;
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
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="vault-recipient"
          testid="recipient-address"
          label="Recipient Address"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            if (fieldErrors.recipient) setFieldErrors((prev) => ({ ...prev, recipient: undefined }));
          }}
          placeholder="G..."
          error={fieldErrors.recipient}
          accentColor="blue"
          required
        />
        <FormField
          id="vault-token"
          testid="token-address"
          label="Token Address"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            if (fieldErrors.token) setFieldErrors((prev) => ({ ...prev, token: undefined }));
          }}
          placeholder="C..."
          error={fieldErrors.token}
          accentColor="blue"
          required
        />
        <FormField
          id="vault-amount"
          testid="amount"
          label="Amount"
          type="number"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          placeholder="1000000"
          error={fieldErrors.amount}
          accentColor="blue"
          required
        />
        <FormField
          id="vault-release-ledger"
          testid="release-ledger"
          label="Release Ledger"
          type="number"
          value={releaseLedger}
          onChange={(e) => {
            setReleaseLedger(e.target.value);
            if (fieldErrors.releaseLedger) setFieldErrors((prev) => ({ ...prev, releaseLedger: undefined }));
          }}
          placeholder="e.g. 2000000"
          error={fieldErrors.releaseLedger}
          accentColor="blue"
          required
        />
        <FormField
          id="vault-label"
          testid="label"
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My vault"
          maxLength={64}
          showCounter
          accentColor="blue"
        />
        <button
          type="submit"
          disabled={txStatus === 'pending'}
          data-testid="create-vault-submit"
          className="w-full py-3 rounded-lg bg-accent-blue text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {txStatus === 'pending' ? 'Submitting...' : 'Create Vault'}
        </button>
      </form>
      <TxToast
        status={txStatus}
        hash={txHash}
        message={txStatus === 'success' ? 'Vault created!' : errorMessage}
        onClose={() => setTxStatus(null)}
      />
    </div>
  );
}
