---
title: Self-Hosting
description: Run your own ChronoStar keeper bot.
---

## Overview

The keeper is a Node.js service that polls contract state and triggers on-chain execution. It runs as a background worker with an HTTP server for health checks and metrics.

## Deployment Options

### Local

```bash
cd keeper
cp .env.example .env
npm install
npm start
```

### Render

The `render.yaml` in `keeper/` is pre-configured for Render's worker service:

1. Create a new **Worker** service on Render
2. Connect your GitHub repo
3. Set the environment variables
4. Deploy

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY keeper/ .
RUN npm install
CMD ["node", "src/index.js"]
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `KEEPER_SECRET` | — | Stellar secret key for signing transactions |
| `VAULT_CONTRACT_ID` | — | Deployed ScheduleVault contract ID |
| `STREAM_CONTRACT_ID` | — | Deployed RecurringStream contract ID |
| `DCA_CONTRACT_ID` | — | Deployed DCAPolicy contract ID |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `POLL_INTERVAL_MS` | `30000` | How often to poll contracts |
| `MAX_LEDGER_STALL_MS` | `120000` | Suspend writes when the observed RPC ledger does not advance for this long |
| `PORT` | `3002` | HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `RETRY_MAX_ATTEMPTS` | `5` | Max retries for failed invocations |
| `RETRY_BASE_DELAY_MS` | `1000` | Base delay for exponential backoff |

## HTTP Endpoints

### `GET /healthz`

Returns `status`, the observed `ledger`, and a `ledgerStall` state. The endpoint
returns `503` while the observed ledger has not advanced within
`MAX_LEDGER_STALL_MS`; polling continues so writes resume after progress.

---

## Uptime & Health Monitoring

Both the backend and keeper services expose `GET /healthz` endpoints for status polling.

### Vendor-Neutral Configuration

A vendor-agnostic monitor config is available at `monitoring/uptime-config.json`. You can import this specification into tools like Uptime Kuma, Better Uptime, or Datadog:
- **Interval**: 60 seconds
- **Expected Status**: 200 OK (`{ "status": "ok" }`)
- **Alert Channels**: Webhook & Email notifications on failure and recovery

### GitHub Actions Fallback Monitor

For self-hosted deployments without dedicated external monitoring, ChronoStar provides a fallback GitHub Actions workflow (`.github/workflows/uptime-monitor.yml`) that polls both endpoints every 15 minutes and alerts on failure.


### `GET /metrics`

Returns watcher state and process info.

## How It Works

Each watcher runs on an interval (`POLL_INTERVAL_MS`):

1. **VaultWatcher**: Reads `vault_count` and `get_vault` for each vault. If `current_ledger >= release_ledger` and status is Active, calls `release()`.
2. **StreamWatcher**: Reads `stream_count` and `get_stream` for each stream. If `current_ledger >= end_ledger`, calls `tick()`.
3. **DCAWatcher**: Reads `dca_count` and `get_dca` for each DCA. If `current_ledger >= next_execution_ledger`, calls `execute_swap()`.

All contract invocations use exponential backoff retry (2^attempt base delay) and automatically re-fetch the keeper source account sequence on `tx_bad_seq` / submission failure, preventing stale sequence lockouts when multiple transactions occur.
