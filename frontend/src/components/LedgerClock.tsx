'use client';

import { useState, useEffect } from 'react';

interface LedgerClockProps {
  targetLedger: number;
  currentLedger?: number;
  secondsPerLedger?: number; 
  className?: string;
}

export function LedgerClock({
  targetLedger,
  currentLedger = 1000,
  secondsPerLedger = 5,
  className = '',
}: LedgerClockProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingLedgers = targetLedger - currentLedger;
  const targetSecondsFromNow = remainingLedgers * secondsPerLedger;
  const targetTime = new Date(now.getTime() + targetSecondsFromNow * 1000);
  const isOverdue = remainingLedgers < 0;

  const formattedAbsolute = targetTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let countdownText = '';
  if (isOverdue) {
    countdownText = `Overdue by ${Math.abs(remainingLedgers)} ledgers`;
  } else if (targetSecondsFromNow <= 0) {
    countdownText = 'Due now';
  } else {
    const totalSec = Math.floor(targetSecondsFromNow);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (days > 0) countdownText = `${days}d ${hours}h remaining`;
    else if (hours > 0) countdownText = `${hours}h ${mins}m remaining`;
    else if (mins > 0) countdownText = `${mins}m ${secs}s remaining`;
    else countdownText = `${secs}s remaining`;
  }

  return (
    <div
      data-testid="ledger-clock"
      className={`inline-flex flex-wrap items-center gap-2 text-xs ${
        isOverdue ? 'text-red-500 font-medium' : 'text-text-muted'
      } ${className}`}
    >
      <span className="font-semibold">{countdownText}</span>
      <span className="opacity-70">({formattedAbsolute})</span>
    </div>
  );
}
