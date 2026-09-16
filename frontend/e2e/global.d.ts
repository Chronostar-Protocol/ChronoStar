interface FreighterMockState {
  connected: boolean;
  publicKey: string;
}

declare global {
  interface Window {
    __freighterMock: FreighterMockState;
  }
}

export {};