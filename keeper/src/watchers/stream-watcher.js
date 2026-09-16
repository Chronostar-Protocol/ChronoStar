import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';

export class StreamWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.interval = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'StreamWatcher started');
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
    cycleLogger.info('StreamWatcher poll cycle started');
    try {
      const streamCount = await this.client.readContract(
        this.contractId,
        'stream_count',
        [],
      );
      if (!streamCount) return;

      const numStreams = Number(streamCount);
      for (let i = 1; i <= numStreams; i++) {
        const stream = await this.client.readContract(
          this.contractId,
          'get_stream',
          [xdr.ScVal.scvU64(BigInt(i))],
        );
        if (!Array.isArray(stream) || stream.length === 0) continue;
        const entry = stream[0];
        if (entry.status?.[0] !== 'Active') continue;

        const currentSeq = Number(await this.client.readContract(this.contractId, 'current_ledger', []));
        const endLedger = Number(entry.end_ledger);

        if (currentSeq >= endLedger) {
          cycleLogger.info({ streamId: i }, 'ticking completed stream');
          await this.client.invokeContract(this.contractId, 'tick', [
            xdr.ScVal.scvU64(BigInt(i)),
          ]);
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'StreamWatcher poll error');
    }
  }
}
