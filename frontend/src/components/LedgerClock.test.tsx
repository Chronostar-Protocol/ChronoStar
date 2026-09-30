import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LedgerClock } from './LedgerClock';
import { ledgersToHuman } from '../lib/utils';

describe('ledgersToHuman', () => {
 
});

describe('LedgerClock', () => {
  it('renders countdown and absolute UTC timestamp', () => {
    render(<LedgerClock targetLedger={2000} currentLedger={1000} secondsPerLedger={5} />);
    const clock = screen.getByTestId('ledger-clock');
    expect(clock.textContent).toContain('remaining');
    expect(clock.textContent).toContain('UTC');
  });

  it('renders overdue state when current ledger exceeds target', () => {
    render(<LedgerClock targetLedger={1000} currentLedger={1200} secondsPerLedger={5} />);
    const clock = screen.getByTestId('ledger-clock');
    expect(clock.textContent).toContain('Overdue by 200 ledgers');
  });
});
