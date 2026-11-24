'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/store';
import { TxToast } from '@/components/TxToast';
import { FormField } from '@/components/FormField';

interface DcaErrors {
  tokenIn?: string;
  swapReceiver?: string;
  totalBudget?: string;
  amountPerSwap?: string;
  intervalLedgers?: string;
}

export default function CreateDCAPage() {
  const { address, isConnected } = useWallet();
  const router = useRouter();
  const [tokenIn, setTokenIn] = useState('');
  const [swapReceiver, setSwapReceiver] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [amountPerSwap, setAmountPerSwap] = useState('');
  const [intervalLedgers, setIntervalLedgers] = useState('');
  const [label, setLabel] = useState('');
  const [fieldErrors, setFieldErrors] = useState<DcaErrors>({});
  const [txStatus, setTxStatus] = useState<null | 'pending' | 'success' | 'error'>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const validate = (): DcaErrors => {
    const errors: DcaErrors = {};
    if (!tokenIn.trim()) {
      errors.tokenIn = 'Token address is required';
    }
    if (!swapReceiver.trim()) {
      errors.swapReceiver = 'Swap receiver is required';
    }
    if (!totalBudget.trim() || Number(totalBudget) <= 0) {
      errors.totalBudget = 'Total budget must be greater than 0';
    }
    if (!amountPerSwap.trim() || Number(amountPerSwap) <= 0) {
      errors.amountPerSwap = 'Amount per swap must be greater than 0';
    }
    if (!intervalLedgers.trim() || Number(intervalLedgers) <= 0) {
      errors.intervalLedgers = 'Interval must be greater than 0';
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || txStatus === 'pending') return;

    const errors = validate();
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      if (errors.tokenIn) {
        document.getElementById('dca-token-in')?.focus();
      } else if (errors.swapReceiver) {
        document.getElementById('dca-swap-receiver')?.focus();
      } else if (errors.totalBudget) {
        document.getElementById('dca-total-budget')?.focus();
      } else if (errors.amountPerSwap) {
        document.getElementById('dca-amount-per-swap')?.focus();
      } else if (errors.intervalLedgers) {
        document.getElementById('dca-interval-ledgers')?.focus();
      }
      return;
    }

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
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="dca-token-in"
          label="Token Address"
          value={tokenIn}
          onChange={(e) => {
            setTokenIn(e.target.value);
            if (fieldErrors.tokenIn) setFieldErrors((prev) => ({ ...prev, tokenIn: undefined }));
          }}
          placeholder="C..."
          error={fieldErrors.tokenIn}
          accentColor="orange"
          required
        />
        <FormField
          id="dca-swap-receiver"
          label="Swap Receiver"
          value={swapReceiver}
          onChange={(e) => {
            setSwapReceiver(e.target.value);
            if (fieldErrors.swapReceiver) setFieldErrors((prev) => ({ ...prev, swapReceiver: undefined }));
          }}
          placeholder="Contract or wallet address"
          error={fieldErrors.swapReceiver}
          accentColor="orange"
          required
        />
        <FormField
          id="dca-total-budget"
          label="Total Budget"
          type="number"
          value={totalBudget}
          onChange={(e) => {
            setTotalBudget(e.target.value);
            if (fieldErrors.totalBudget) setFieldErrors((prev) => ({ ...prev, totalBudget: undefined }));
          }}
          placeholder="1000000"
          error={fieldErrors.totalBudget}
          accentColor="orange"
          required
        />
        <FormField
          id="dca-amount-per-swap"
          label="Amount Per Swap"
          type="number"
          value={amountPerSwap}
          onChange={(e) => {
            setAmountPerSwap(e.target.value);
            if (fieldErrors.amountPerSwap) setFieldErrors((prev) => ({ ...prev, amountPerSwap: undefined }));
          }}
          placeholder="100000"
          error={fieldErrors.amountPerSwap}
          accentColor="orange"
          required
        />
        <FormField
          id="dca-interval-ledgers"
          label="Interval (ledgers)"
          type="number"
          value={intervalLedgers}
          onChange={(e) => {
            setIntervalLedgers(e.target.value);
            if (fieldErrors.intervalLedgers) setFieldErrors((prev) => ({ ...prev, intervalLedgers: undefined }));
          }}
          placeholder="e.g. 1440"
          error={fieldErrors.intervalLedgers}
          accentColor="orange"
          required
        />
        <FormField
          id="dca-label"
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Weekly XLM DCA"
          maxLength={64}
          accentColor="orange"
        />
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
