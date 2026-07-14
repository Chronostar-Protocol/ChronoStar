import { config } from './config.js';
import { logger } from './logger.js';
import { SorobanClient } from './soroban-client.js';
import { VaultWatcher, StreamWatcher, DCAWatcher } from './watchers/index.js';
import { createServer } from './http.js';

async function main() {
  logger.info('ChronoStar Keeper starting');

  const client = new SorobanClient();
  await client.init();

  const watchers = {
    vault: new VaultWatcher(client, config.vaultContractId),
    stream: new StreamWatcher(client, config.streamContractId),
    dca: new DCAWatcher(client, config.dcaContractId),
  };

  for (const [, w] of Object.entries(watchers)) {
    w.start(config.pollIntervalMs);
  }

  const server = createServer(watchers);

  function shutdown() {
    logger.info('shutting down');
    for (const w of Object.values(watchers)) w.stop();
    server.close();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.fatal({ err: err.message }, 'keeper failed to start');
  process.exit(1);
});
