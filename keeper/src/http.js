import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';

export function createServer(watchers, client, port = config.port) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/healthz') {
      const stale = Object.values(watchers).filter((w) => w.lastPoll && Date.now() - w.lastPoll > 5 * 60_000);
      const ledgerStall = client?.ledgerStatus() ?? null;
      const degraded = stale.length > 0 || ledgerStall?.stalled === true || ledgerStall?.status === 'transport_error';
      res.writeHead(degraded ? 503 : 200);
      res.end(JSON.stringify({
        status: degraded ? 'degraded' : 'ok',
        ledger: ledgerStall?.observedLedger ?? watchers.__ledger ?? null,
        ledgerStall,
        staleWatchers: stale.length,
      }));
      return;
    }

    if (req.url === '/metrics') {
      const metrics = {
        watchers: Object.fromEntries(
          Object.entries(watchers).map(([name, w]) => [
            name,
            { running: w.timer !== null },
          ]),
        ),
        ledgerStall: client?.ledgerStatus() ?? null,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
      };
      res.writeHead(200);
      res.end(JSON.stringify(metrics));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, () => {
    logger.info({ port }, 'HTTP server listening');
  });

  return server;
}
