'use client';

import { create } from 'zustand';

export type Locale = 'en' | 'es';

export interface Dictionary {
  nav: {
    dashboard: string;
    explorer: string;
    connect: string;
    disconnect: string;
  };
  dashboard: {
    title: string;
    newVault: string;
    newStream: string;
    newDca: string;
    allRoles: string;
    ownerRole: string;
    recipientRole: string;
    noItems: string;
  };
  toast: {
    pending: string;
    success: string;
    error: string;
    viewExplorer: string;
    downloadReceipt: string;
  };
}

export const dictionaries: Record<Locale, Dictionary> = {
  en: {
    nav: {
      dashboard: 'Dashboard',
      explorer: 'Explorer',
      connect: 'Connect Wallet',
      disconnect: 'Disconnect',
    },
    dashboard: {
      title: 'Dashboard',
      newVault: 'New Vault',
      newStream: 'New Stream',
      newDca: 'New DCA',
      allRoles: 'All',
      ownerRole: 'Owner',
      recipientRole: 'Recipient',
      noItems: 'No items found.',
    },
    toast: {
      pending: 'Transaction pending...',
      success: 'Transaction successful!',
      error: 'Transaction failed',
      viewExplorer: 'View on explorer',
      downloadReceipt: 'Download receipt',
    },
  },
  es: {
    nav: {
      dashboard: 'Panel',
      explorer: 'Explorador',
      connect: 'Conectar Billetera',
      disconnect: 'Desconectar',
    },
    dashboard: {
      title: 'Panel Principal',
      newVault: 'Nueva Bóveda',
      newStream: 'Nuevo Flujo',
      newDca: 'Nuevo DCA',
      allRoles: 'Todos',
      ownerRole: 'Propietario',
      recipientRole: 'Destinatario',
      noItems: 'No se encontraron elementos.',
    },
    toast: {
      pending: 'Transacción pendiente...',
      success: '¡Transacción exitosa!',
      error: 'Transacción fallida',
      viewExplorer: 'Ver en explorador',
      downloadReceipt: 'Descargar recibo',
    },
  },
};

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
}

export const useI18n = create<I18nStore>((set) => {
  let initialLocale: Locale = 'en';
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('chronostar_locale') as Locale;
    if (saved === 'en' || saved === 'es') initialLocale = saved;
  }
  return {
    locale: initialLocale,
    t: dictionaries[initialLocale],
    setLocale: (locale: Locale) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('chronostar_locale', locale);
      }
      set({ locale, t: dictionaries[locale] });
    },
  };
});
