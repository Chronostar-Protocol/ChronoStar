import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { genReqId, globalLimiter } from './middleware.js';
import { createSchedulesRouter } from './routes/schedules.js';
import { createStreamsRouter, createDCARouter } from './routes/streams.js';
import { createEventsRouter } from './routes/events.js';
import { createStatsRouter } from './routes/stats.js';

export function createApp(clients, log = logger) {
  const app = express();

  app.use(cors());
  app.use(pinoHttp({
    logger: log,
    genReqId,
  }));
  app.use(express.json());
  app.use(globalLimiter);

  app.use('/api/schedules', createSchedulesRouter(clients.vault.client, clients.vault.contractId));
  app.use('/api/streams', createStreamsRouter(clients.stream.client, clients.stream.contractId));
  app.use('/api/dca', createDCARouter(clients.dca.client, clients.dca.contractId));
  app.use('/api/events', createEventsRouter(clients, log));
  app.use('/api/stats', createStatsRouter(clients));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  app.use((err, _req, res, _next) => {
    log.error({ err: err.message });
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}