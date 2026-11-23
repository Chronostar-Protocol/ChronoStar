import Link from 'next/link';
import { ConnectButton } from './ConnectButton';
import { CurrentLedger } from './CurrentLedger';
import { useI18n } from '@/lib/i18n';

export function Navbar() {
  const { locale, setLocale, t } = useI18n();

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-bg-primary/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-heading text-xl font-bold text-text-primary">
            ChronoStar
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-text-muted">
            <Link href="/dashboard" className="hover:text-text-primary transition-colors">{t.nav.dashboard}</Link>
            <Link href="/explorer" className="hover:text-text-primary transition-colors">{t.nav.explorer}</Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
            className="px-2 py-1 text-xs font-mono font-medium border border-border rounded hover:bg-bg-card transition-colors text-text-muted"
            title="Toggle language"
          >
            {locale.toUpperCase()}
          </button>
          <CurrentLedger />
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
