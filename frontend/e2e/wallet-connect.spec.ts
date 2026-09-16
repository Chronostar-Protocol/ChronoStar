import { test, expect } from '@playwright/test';
import { freighterMock, DEFAULT_PUBLIC_KEY, mockApi } from './support/freighter';

test('shows the connect-wallet empty state when no wallet is connected', async ({ page }) => {
  await page.addInitScript(freighterMock({ connected: false }));

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Connect Your Wallet' })).toBeVisible();
  await expect(
    page.getByText('Link your Freighter wallet to view your vaults, streams, and DCA policies on the Stellar network.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Freighter' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse Explorer Instead' })).toBeVisible();
});

test('shows the connected wallet address in the navbar', async ({ page }) => {
  await page.addInitScript(freighterMock({ connected: true, publicKey: DEFAULT_PUBLIC_KEY }));
  await mockApi(page, { vaults: [] });

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('No vault found.')).toBeVisible();

  const shortAddress = `${DEFAULT_PUBLIC_KEY.slice(0, 4)}...${DEFAULT_PUBLIC_KEY.slice(-4)}`;
  await expect(page.getByText(shortAddress, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: shortAddress }).click();
  await expect(page.getByRole('heading', { name: 'Connect Your Wallet' })).toBeVisible();
});