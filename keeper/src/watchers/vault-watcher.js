import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';

export class VaultWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.interval = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'VaultWatcher started');
    this.poll();
    this.interval = setInterval(() => this.poll(), pollIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll() {
    const correlationId = generateCorrelationId();
    const cycleLogger = this.logger.child({ correlationId });
    cycleLogger.info('VaultWatcher poll cycle started');
    try {
      const currentLedger = await this.client.readContract(
        this.contractId,
        'current_ledger',
        [],
      );
      if (!currentLedger) return;

      const vaultCount = await this.client.readContract(
        this.contractId,
        'vault_count',
        [],
      );
      if (!vaultCount) return;

      const numVaults = Number(vaultCount);
      for (let i = 1; i <= numVaults; i++) {
        const vault = await this.client.readContract(
          this.contractId,
          'get_vault',
          [xdr.ScVal.scvU64(BigInt(i))],
        );
        if (!Array.isArray(vault) || vault.length === 0) continue;
        const entry = vault[0];
        if (entry.status?.[0] !== 'Active') continue;

        const releaseLedger = Number(entry.release_ledger);
        const currentSeq = Number(currentLedger);
        if (currentSeq >= releaseLedger) {
          cycleLogger.info({ vaultId: i }, 'releasing vault');
          await this.client.invokeContract(this.contractId, 'release', [
            xdr.ScVal.scvU64(BigInt(i)),
          ]);
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'VaultWatcher poll error');
    }
  }
}
