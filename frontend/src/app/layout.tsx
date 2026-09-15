import type { Metadata } from 'next';
import '@/styles/globals.css';
import { WalletProvider } from '@/lib/store';
import { Navbar } from '@/components/Navbar';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://chronostar.io'),
  title: 'ChronoStar — Scheduled Payments on Stellar',
  description: 'Time-based payment primitives for the Stellar ecosystem: ScheduleVault, RecurringStream, DCAPolicy.',
  icons: {
    icon: [
      { url: '/chronostar-logo-mark.svg', type: 'image/svg+xml' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/chronostar-logo-mark.svg',
    apple: '/chronostar-logo-mark.svg',
  },
  openGraph: {
    title: 'ChronoStar — Scheduled Payments on Stellar',
    description: 'Time-based payment primitives for the Stellar ecosystem: ScheduleVault, RecurringStream, DCAPolicy.',
    url: 'https://chronostar.io',
    siteName: 'ChronoStar',
    images: [
      {
        url: '/chronostar-logo-mark.svg',
        width: 200,
        height: 200,
        alt: 'ChronoStar Logo',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ChronoStar — Scheduled Payments on Stellar',
    description: 'Time-based payment primitives for the Stellar ecosystem: ScheduleVault, RecurringStream, DCAPolicy.',
    images: ['/chronostar-logo-mark.svg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <WalletProvider>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-8">
            {children}
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
