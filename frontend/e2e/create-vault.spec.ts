import { test, expect } from '@playwright/test';
import { freighterMock, DEFAULT_PUBLIC_KEY, mockApi } from './support/freighter';
import type { VaultEntry } from '../src/types';

test('connects a wallet and creates a vault that appears on the dashboard', async ({ page }) => {
  const vaults: VaultEntry[] = [];
  await page.addInitScript(freighterMock({ connected: false }));
  await mockApi(page, { vaults });

  const recipient = 'GBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGXBXGX';
  const token = 'CCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCXCCX';
  const amount = '1000000';
  const releaseLedger = '2000000';
  const label = 'E2E Test Vault';

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Connect Your Wallet' })).toBeVisible();

  await page.getByRole('button', { name: 'Connect Wallet' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const newVaultButton = page.getByRole('link', { name: 'New Vault' });
  await expect(newVaultButton).toBeVisible();
  await newVaultButton.click();

  await expect(page.getByRole('heading', { name: 'Create Vault' })).toBeVisible();

  await page.getByTestId('recipient-address').fill(recipient);
  await page.getByTestId('token-address').fill(token);
  await page.getByTestId('amount').fill(amount);
  await page.getByTestId('release-ledger').fill(releaseLedger);
  await page.getByTestId('label').fill(label);

  await page.getByTestId('create-vault-submit').click();

  await expect(page.getByText('Vault created!')).toBeVisible();

  vaults.push({
    id: 1,
    owner: DEFAULT_PUBLIC_KEY,
    recipient,
    token,
    amount,
    release_ledger: Number(releaseLedger),
    created_ledger: 1,
    label,
    status: 'Active',
  });

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('#1', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: new RegExp(label) }).click();
  await expect(page.getByRole('heading', { name: 'Vault #1' })).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toBeVisible();
  await expect(page.getByText(amount, { exact: true })).toBeVisible();
});