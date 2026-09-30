import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';
import { withJitter } from '../poll-jitter.js';
import { runCoordinated } from '../coordination.js';

export class DCAWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.timer = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'DCAWatcher started');
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
    cycleLogger.info('DCAWatcher poll cycle started');
    try {
      const dcaCount = await this.client.readContract(
        this.contractId,
        'dca_count',
        [],
      );
      if (!dcaCount) return;

      const numDcas = Number(dcaCount);
      const currentSeq = Number(
        await this.client.readContract(this.contractId, 'current_ledger', []),
      );
      for (let i = 1; i <= numDcas; i++) {
        const dca = await this.client.readContract(
          this.contractId,
          'get_dca',
          [xdr.ScVal.scvU64(BigInt(i))],
        );
        if (!Array.isArray(dca) || dca.length === 0) continue;
        const entry = dca[0];
        if (entry.status?.[0] !== 'Active') continue;

        const nextExec = Number(entry.next_execution_ledger);

        if (currentSeq >= nextExec) {
          cycleLogger.info({ dcaId: i }, 'executing DCA swap');
          await runCoordinated(this.client, 'dca', i, () => this.client.invokeContract(
            this.contractId,
            'execute_swap',
            [xdr.ScVal.scvU64(BigInt(i))],
            correlationId,
          ));
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'DCAWatcher poll error');
    }
  }
}
