import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';
import { withJitter } from '../poll-jitter.js';
import { runCoordinated } from '../coordination.js';

export class VaultWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.timer = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'VaultWatcher started');
    this.pollIntervalMs = pollIntervalMs;
    this.poll();
    this.scheduleNext();
  }

  // Randomized jitter (#103) instead of a fixed setInterval so multiple
  // watcher/keeper instances don't all hit the RPC endpoint in lockstep.
  scheduleNext() {
    this.timer = setTimeout(() => {
      this.poll().finally(() => this.scheduleNext());
    }, withJitter(this.pollIntervalMs));
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
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
          await runCoordinated(this.client, 'vault', i, () => this.client.invokeContract(
            this.contractId,
            'release',
            [xdr.ScVal.scvU64(BigInt(i))],
            correlationId,
          ));
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'VaultWatcher poll error');
    }
  }
}
