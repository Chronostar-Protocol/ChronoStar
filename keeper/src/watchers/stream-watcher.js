import { xdr } from '@stellar/stellar-sdk';
import { logger, generateCorrelationId } from '../logger.js';
import { withJitter } from '../poll-jitter.js';

export class StreamWatcher {
  constructor(sorobanClient, contractId, parentLogger = logger) {
    this.client = sorobanClient;
    this.contractId = contractId;
    this.timer = null;
    this.logger = parentLogger;
  }

  start(pollIntervalMs) {
    this.logger.info({ contractId: this.contractId }, 'StreamWatcher started');
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
          await this.client.invokeContract(
            this.contractId,
            'tick',
            [xdr.ScVal.scvU64(BigInt(i))],
            correlationId,
          );
        }
      }
    } catch (err) {
      cycleLogger.error({ err: err.message }, 'StreamWatcher poll error');
    }
  }
}
