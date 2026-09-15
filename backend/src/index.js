import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { SorobanClient } from './soroban-client.js';
import { genReqId, globalLimiter } from './middleware.js';
import { createSchedulesRouter } from './routes/schedules.js';
import { createStreamsRouter, createDCARouter } from './routes/streams.js';
import { createEventsRouter } from './routes/events.js';
import { createStatsRouter } from './routes/stats.js';

const client = new SorobanClient();

const clients = {
  vault: { client, contractId: config.vaultContractId },
  stream: { client, contractId: config.streamContractId },
  dca: { client, contractId: config.dcaContractId },
};

const app = express();

app.use(cors());
app.use(pinoHttp({
  logger,
  genReqId,
}));
app.use(express.json());
app.use(globalLimiter);

app.use('/api/schedules', createSchedulesRouter(client, config.vaultContractId));
app.use('/api/streams', createStreamsRouter(client, config.streamContractId));
app.use('/api/dca', createDCARouter(client, config.dcaContractId));
app.use('/api/events', createEventsRouter(clients, logger));
app.use('/api/stats', createStatsRouter(clients));

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  logger.error({ err: err.message });
  res.status(500).json({ error: 'internal server error' });
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'backend listening');
});
