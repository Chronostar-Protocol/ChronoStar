'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/store';

export default function DashboardPage() {
  const { isConnected } = useWallet();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 flex items-center justify-center mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-accent-blue"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
          </svg>
        </div>
        <h1 className="text-2xl font-heading font-bold text-text-primary mb-2">
          Connect Your Wallet
        </h1>
        <p className="text-text-muted max-w-sm mb-6">
          Link your Freighter wallet to view your vaults, streams, and DCA policies on the Stellar network.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <a
            href="https://www.freighter.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Get Freighter
          </a>
          <Link
            href="/explorer"
            className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors"
          >
            Browse Explorer Instead
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-20">
      <h1 className="text-2xl font-heading font-bold text-text-primary">Dashboard</h1>
      <p className="mt-2 text-text-muted">Your wallet is connected. Loading your data...</p>
    </div>
  );
}
