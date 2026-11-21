import { config, validateConfig } from './config.js';
import { logger } from './logger.js';
import { SorobanClient } from './soroban-client.js';
import { VaultWatcher, StreamWatcher, DCAWatcher } from './watchers/index.js';
import { createServer } from './http.js';
import { registerKeeper, unregisterKeeper } from './registration.js';

async function main() {
  logger.info('ChronoStar Keeper starting');

  // #101 — fail fast on invalid config instead of crashing later deep inside
  // a watcher/RPC call.
  try {
    validateConfig();
  } catch (err) {
    logger.error({ err }, 'Invalid keeper configuration');
    process.exit(1);
  }

  const client = new SorobanClient();
  await client.init();

  // #267 — register with the coordinator before any watcher starts polling.
  await registerKeeper(client, config);

  const watchers = {
    vault: new VaultWatcher(client, config.vaultContractId),
    stream: new StreamWatcher(client, config.streamContractId),
    dca: new DCAWatcher(client, config.dcaContractId),
  };

  for (const [, w] of Object.entries(watchers)) {
    w.start(config.pollIntervalMs);
  }

  const server = createServer(watchers, client);

  async function shutdown() {
    logger.info('shutting down');
    for (const w of Object.values(watchers)) w.stop();
    server.close();
    // Release the registration so another keeper takes over immediately; never block exit for long.
    await Promise.race([
      unregisterKeeper(client, config),
      new Promise(resolve => setTimeout(resolve, 10_000)),
    ]);
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.fatal({ err: err.message }, 'keeper failed to start');
  process.exit(1);
});
