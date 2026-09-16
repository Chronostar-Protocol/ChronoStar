import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';

export class DCAWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.interval = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'DCAWatcher started');
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
    cycleLogger.info('DCAWatcher poll cycle started');
    try {
      const dcaCount = await this.client.readContract(
        this.contractId,
        'dca_count',
        [],
      );
      if (!dcaCount) return;

      const numDcas = Number(dcaCount);
      for (let i = 1; i <= numDcas; i++) {
        const dca = await this.client.readContract(
          this.contractId,
          'get_dca',
          [xdr.ScVal.scvU64(BigInt(i))],
        );
        if (!Array.isArray(dca) || dca.length === 0) continue;
        const entry = dca[0];
        if (entry.status?.[0] !== 'Active') continue;

        const currentSeq = Number(await this.client.readContract(this.contractId, 'current_ledger', []));
        const nextExec = Number(entry.next_execution_ledger);

        if (currentSeq >= nextExec) {
          cycleLogger.info({ dcaId: i }, 'executing DCA swap');
          await this.client.invokeContract(this.contractId, 'execute_swap', [
            xdr.ScVal.scvU64(BigInt(i)),
          ]);
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'DCAWatcher poll error');
    }
  }
}
