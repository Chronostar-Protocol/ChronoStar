import type { Page } from '@playwright/test';
import type { VaultEntry } from '../../src/types';

export const DEFAULT_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

export interface FreighterMockOptions {
  connected?: boolean;
  publicKey?: string;
}

export function freighterMock({ connected = true, publicKey = DEFAULT_PUBLIC_KEY }: FreighterMockOptions = {}) {
  return `(() => {
    const state = { connected: ${connected}, publicKey: ${JSON.stringify(publicKey)} };
    window.__freighterMock = state;

    window.addEventListener('message', (event) => {
      const req = event.data;
      if (!req || req.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

      const response = { messagedId: req.messageId };
      switch (req.type) {
        case 'REQUEST_CONNECTION_STATUS':
          response.isConnected = state.connected;
          break;
        case 'REQUEST_PUBLIC_KEY':
          response.publicKey = state.publicKey;
          response.error = '';
          break;
        case 'REQUEST_ALLOWED_STATUS':
          response.isAllowed = state.connected;
          break;
        default:
          return;
      }

      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', ...response },
      }));
    });
  })();`;
}

export function setWalletConnected(page: Page, connected: boolean) {
  return page.evaluate((value) => {
    window.__freighterMock.connected = value;
  }, connected);
}

interface ApiState {
  vaults: VaultEntry[];
}

export async function mockApi(page: Page, state: ApiState) {
  await page.route('**/api/schedules/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.vaults) }),
  );
  await page.route('**/api/streams/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/dca/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
}