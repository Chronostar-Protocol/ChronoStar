import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateVaultPage from './vault/new/page';
import CreateStreamPage from './stream/new/page';
import CreateDCAPage from './dca/new/page';

vi.mock('@/lib/store', () => ({
  useWallet: () => ({
    address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    isConnected: true,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/contracts', () => ({
  createVaultTx: vi.fn(),
  createStreamTx: vi.fn(),
  createDcaTx: vi.fn(),
}));

describe('Accessible Create Forms (#398)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('CreateVaultPage accessibility and validation', () => {
    it('associates all visible labels with input IDs', () => {
      render(<CreateVaultPage />);

      expect(screen.getByLabelText('Recipient Address').getAttribute('id')).toBe('vault-recipient');
      expect(screen.getByLabelText('Token Address').getAttribute('id')).toBe('vault-token');
      expect(screen.getByLabelText('Amount').getAttribute('id')).toBe('vault-amount');
      expect(screen.getByLabelText('Release Ledger').getAttribute('id')).toBe('vault-release-ledger');
      expect(screen.getByLabelText('Label').getAttribute('id')).toBe('vault-label');
    });

    it('focuses the first invalid field upon invalid submission', () => {
      render(<CreateVaultPage />);

      const submitBtn = screen.getByTestId('create-vault-submit');
      fireEvent.click(submitBtn);

      const recipientInput = screen.getByLabelText('Recipient Address');
      expect(document.activeElement).toBe(recipientInput);
      expect(recipientInput.getAttribute('aria-invalid')).toBe('true');
      expect(recipientInput.getAttribute('aria-describedby')).toBe('vault-recipient-error');

      const errorMsg = screen.getByText('Recipient address is required');
      expect(errorMsg.getAttribute('role')).toBe('alert');
      expect(errorMsg.getAttribute('id')).toBe('vault-recipient-error');
    });

    it('focuses the second invalid field when the first field is valid', () => {
      render(<CreateVaultPage />);

      const recipientInput = screen.getByLabelText('Recipient Address');
      fireEvent.change(recipientInput, {
        target: { value: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' },
      });

      const submitBtn = screen.getByTestId('create-vault-submit');
      fireEvent.click(submitBtn);

      const tokenInput = screen.getByLabelText('Token Address');
      expect(document.activeElement).toBe(tokenInput);
      expect(tokenInput.getAttribute('aria-invalid')).toBe('true');
      expect(tokenInput.getAttribute('aria-describedby')).toBe('vault-token-error');
    });
  });

  describe('CreateStreamPage accessibility and validation', () => {
    it('associates all visible labels with input IDs', () => {
      render(<CreateStreamPage />);

      expect(screen.getByLabelText('Recipient Address').getAttribute('id')).toBe('stream-recipient');
      expect(screen.getByLabelText('Token Address').getAttribute('id')).toBe('stream-token');
      expect(screen.getByLabelText('Total Amount').getAttribute('id')).toBe('stream-total-amount');
      expect(screen.getByLabelText('Duration (ledgers)').getAttribute('id')).toBe('stream-duration');
      expect(screen.getByLabelText('Label').getAttribute('id')).toBe('stream-label');
    });

    it('focuses the first invalid field on empty submission', () => {
      render(<CreateStreamPage />);

      const submitBtn = screen.getByRole('button', { name: 'Create Stream' });
      fireEvent.click(submitBtn);

      const recipientInput = screen.getByLabelText('Recipient Address');
      expect(document.activeElement).toBe(recipientInput);
      expect(recipientInput.getAttribute('aria-invalid')).toBe('true');
      expect(recipientInput.getAttribute('aria-describedby')).toBe('stream-recipient-error');
    });
  });

  describe('CreateDCAPage accessibility and validation', () => {
    it('associates all visible labels with input IDs', () => {
      render(<CreateDCAPage />);

      expect(screen.getByLabelText('Token Address').getAttribute('id')).toBe('dca-token-in');
      expect(screen.getByLabelText('Swap Receiver').getAttribute('id')).toBe('dca-swap-receiver');
      expect(screen.getByLabelText('Total Budget').getAttribute('id')).toBe('dca-total-budget');
      expect(screen.getByLabelText('Amount Per Swap').getAttribute('id')).toBe('dca-amount-per-swap');
      expect(screen.getByLabelText('Interval (ledgers)').getAttribute('id')).toBe('dca-interval-ledgers');
      expect(screen.getByLabelText('Label').getAttribute('id')).toBe('dca-label');
    });

    it('focuses the first invalid field on empty submission', () => {
      render(<CreateDCAPage />);

      const submitBtn = screen.getByRole('button', { name: 'Create DCA Policy' });
      fireEvent.click(submitBtn);

      const tokenInput = screen.getByLabelText('Token Address');
      expect(document.activeElement).toBe(tokenInput);
      expect(tokenInput.getAttribute('aria-invalid')).toBe('true');
      expect(tokenInput.getAttribute('aria-describedby')).toBe('dca-token-in-error');
    });
  });
});
