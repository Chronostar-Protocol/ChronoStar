'use client';

export interface AddressBookEntry {
  address: string;
  label: string;
}

const STORAGE_KEY = 'chronostar_address_book';

export function getAddressBook(): AddressBookEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAddressBookEntry(entry: AddressBookEntry): void {
  if (typeof window === 'undefined') return;
  const current = getAddressBook().filter((e) => e.address !== entry.address);
  current.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function removeAddressBookEntry(address: string): void {
  if (typeof window === 'undefined') return;
  const current = getAddressBook().filter((e) => e.address !== address);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}
