import crypto from 'node:crypto';
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function generateCorrelationId() {
  return crypto.randomUUID();
}
