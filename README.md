# ChronoStar

![ChronoStar](docs/assets/chronostar-logo-lockup.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Test Contracts](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/test-contracts.yml/badge.svg)](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/test-contracts.yml)
[![Test Keeper](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/test-keeper.yml/badge.svg)](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/test-keeper.yml)
[![Deploy Docs](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/Chronostar-Protocol/ChronoStar/actions/workflows/deploy-docs.yml)

Time-based payment primitives for the Stellar ecosystem: time-locked vaults, recurring payment streams, and on-chain DCA policies.

## Deployed Contracts (Testnet)

| Contract         | Address                                                    |
| ---------------- | ---------------------------------------------------------- |
| Schedule Vault   | `CAAD4GP5VBJTL3AWKJCQSIMZ4ZDSOTDN6AAUQONOSI6QYGLFYYSHEP3T` |
| Recurring Stream | `CDFKO7H2VAPXZFQN6OF5KSJQXG7CO2JAGV5ZPQTQSYMT4Y6QLFG7A2FG` |
| DCA Policy       | `CDFOXEG73Y47FWTVOT7I34RECW32LX6Y7H5VYU6NXWHFQ4BK52ELB7EM` |

## Deployed Services

| Service       | URL                                                   |
| ------------- | ----------------------------------------------------- |
| Frontend      | https://chrono-star.vercel.app                        |
| Backend API   | https://chronostar-backend-s905.onrender.com          |
| Documentation | https://chronostar-protocol.github.io/ChronoStar      |
| Keeper Bot    | Private service (monitored via internal health check) |

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │────▶│ Frontend │────▶│  Backend │
│ (Freighter)│   │ (Vercel) │     │ (Render) │
└──────────┘     └──────────┘     └────┬─────┘  
                                       │
                              ┌────────▼────────┐
                              │  Soroban RPC     │
                              │ (Stellar Testnet)│
                              └────────┬─────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
             ┌──────────┐     ┌──────────┐     ┌──────────┐
             │Schedule   │     │Recurring │     │   DCA    │
             │Vault      │     │Stream    │     │ Policy   │
             └──────────┘     └──────────┘     └──────────┘
                                       │
                              ┌────────▼────────┐
                              │  Keeper Bot     │
                              │  (optional)     │
                              └─────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 22+
- Rust 1.80.0+ (MSRV) with `wasm32-unknown-unknown` target
- Soroban CLI (`stellar` or `soroban`)

### Local Development

```bash
# Install contract dependencies
cd contract
cargo build --target wasm32-unknown-unknown --release

# Run contract tests
cargo test

# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
cp .env.local.example .env.local   # fill in addresses
npm install
npm run dev

# Keeper (optional)
cd keeper
cp .env.example .env                # fill in secret + addresses
npm install
npm start
```

## Running the Keeper

The keeper bot watches for vaults, streams, and DCA policies that become due for execution on-chain, then submits the transactions. To run it locally:

```bash
cd keeper
cp .env.example .env
# Edit .env with KEEPER_SECRET (Stellar testnet secret key)
npm install
npm start
```

The keeper and backend services can be deployed on Render using the root blueprint [`render.yaml`](./render.yaml) (`chronostar-backend` web service and `chronostar-keeper` background worker).

## API Endpoints 

Base URL: `https://chronostar-backend-s905.onrender.com`

A machine-readable OpenAPI 3.0.3 specification is available at [`backend/openapi.yaml`](./backend/openapi.yaml).

| Endpoint                      | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `GET /healthz`                | Health check                                        |
| `GET /api/docs`               | Interactive Swagger UI documentation                |
| `GET /api/openapi.json`       | OpenAPI 3.0.3 specification JSON                    |
| `GET /api/stream`             | Server-Sent Events stream for live schedule updates |
| `GET /api/stats`              | Aggregated stats across all contracts               |
| `GET /api/events`             | Upcoming executable events                          |
| `GET /api/schedules/:address` | Vaults for an address                               |
| `GET /api/streams/:address`   | Streams for an address                              |
| `GET /api/dca/:address`       | DCA policies for an address                         |

## Tech Stack

- **Contracts:** Soroban (Rust) on Stellar Testnet
- **Backend:** Node.js, Express, @stellar/stellar-sdk v13
- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, Freighter Wallet
- **Keeper:** Node.js worker with exponential backoff retry
- **Docs:** Astro Starlight, hosted on GitHub Pages
- **Infra:** Render (backend), Vercel (frontend), GitHub Pages (docs)

## Project Structure

```
chronostar/
├── contract/              # Soroban smart contracts
│   ├── schedule-vault/    # Time-locked token vault
│   ├── recurring-stream/  # Continuous payment streams
│   ├── dca-policy/        # Dollar-cost averaging
│   └── DEPLOY.md          # Contract deployment guide
├── backend/               # REST API (Express)
├── frontend/              # Web UI (Next.js)
├── keeper/                # Automated execution bot
├── docs/                  # Documentation site (Starlight)
└── .github/workflows/     # CI/CD pipelines
```

## Contributing

New to the project? Start with a [`good-first-issue`](https://github.com/Chronostar-Protocol/ChronoStar/labels/good-first-issue) — see [CONTRIBUTING.md](./CONTRIBUTING.md) and our [Good-First-Issue Onboarding Curriculum](./docs/src/content/docs/getting-started/onboarding-curriculum.md) for setup checklists, conventions, curated starter tasks, and the review process. Everyone participating is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Release history lives in [CHANGELOG.md](./CHANGELOG.md) and upcoming milestones in [ROADMAP.md](./ROADMAP.md).

## License


MIT — see [LICENSE](./LICENSE)

## Security

Please report suspected vulnerabilities privately through the [ChronoStar security policy](SECURITY.md) rather than opening a public issue.
# API documentation

> **Last verified:** 2026-09-30 against commit `a5154c2f0deb9d75b689c13a4f5a092891b89702` on `main`.

The HTTP API (versioning, envelopes, and endpoint overview) lives in the repository root:

**[API.md](../API.md)**

## Contract error codes

When the backend invokes the on-chain Soroban contract, failures surface as numeric
error codes. The canonical mapping between contract error codes and HTTP API error
responses is maintained in:

**[CONTRACT_ABI.md → Canonical Error Mapping](../contracts/CONTRACT_ABI.md#canonical-error-mapping-contract--api)**

## Operational endpoints

These unversioned endpoints support health checks and monitoring:

| Endpoint           | Purpose                                                       |
|--------------------|--------------------------------------------------------------|
| `GET /health`      | Plain-text `200 ok` liveness probe for load balancers.       |
| `GET /api/health`  | JSON `{ status, timestamp }` API health.                     |
| `GET /ready`, `GET /readiness` | Deep readiness probe (DB, Redis/queues, workers, indexer); returns `503` until ready. |
| `GET /metrics`     | Prometheus metrics exposition.                               |

To probe these surfaces across environments, use the health smoke script (`npm run smoke`). See **[OPERATIONS.md](OPERATIONS.md#health-smoke-test)** for usage and the health-vs-readiness distinction.

### Worked example: confirm a local backend is serving

The most common case for a first-time contributor is "is the API up and healthy?". The backend listens on port `3001` by default (`PORT` overrides it), so probe `http://localhost:3001` and read the result.

The response bodies, statuses, and key names below come from the route handlers in `backend/src/index.ts` and `backend/src/api/ops.routes.ts`, and the smoke transcript is the output format of `scripts/health-smoke.sh`. Per-request timings are representative and will differ on your machine.

**Step 1 — confirm the process is bound.** Start the API from `backend/` (`npm run dev`). The bind is logged as JSON and contains:

```text
[SERVER] Listening on port 3001
```

**Step 2 — probe liveness.** This is the plain-text surface a load balancer uses:

```bash
curl -i http://localhost:3001/health
```

Expected response:

```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8

ok
```

`GET /health` never calls the database, Redis, Horizon, or Soroban. A body other than `ok`, or any status other than `200`, means something other than this API is listening on port 3001.

**Step 3 — probe dependencies.** Unlike `/health`, this endpoint runs live checks and names what it found:

```bash
curl -s http://localhost:3001/api/health | jq
```

Expected response when every dependency is reachable:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-30T10:31:04.882Z",
  "dependencies": {
    "database": { "status": "ok", "latency_ms": 2, "last_checked": "2026-09-30T10:31:04.880Z" },
    "redis": { "status": "ok", "latency_ms": 1, "last_checked": "2026-09-30T10:31:04.881Z" },
    "stellar_horizon": { "status": "ok", "latency_ms": 84, "last_checked": "2026-09-30T10:31:04.882Z" },
    "reflector_oracle": { "status": "ok", "latency_ms": 57, "last_checked": "2026-09-30T10:31:04.882Z" }
  }
}
```

Each dependency reports `ok`, `degraded`, or `down`. A `degraded` dependency still answers `200` with `"status": "healthy"`; only a `down` dependency flips the response to `503` with `"status": "unhealthy"`, so this object is where you find out which one broke.

**Step 4 — probe all four surfaces at once.** From the repository root:

```bash
npm run smoke
```

Expected output:

```text
Health smoke test → http://localhost:3001  (target: local, timeout: 10s)
-------------------------------------------------------------------------
  ✓ liveness    /health       200 (0.003s)
  ✓ api-health  /api/health   200 (0.041s)
  ✓ readiness   /ready        200 (0.012s)
  ✓ api-root    /             200 (0.004s)
  ✓ api-docs    /api-docs     200 (0.006s)
  ✓ metrics     /metrics      200 (0.009s)
-------------------------------------------------------------------------
Summary: 6 passed, 0 failed, 0 warning(s)
✓ Health smoke test passed for http://localhost:3001
```

Exit code `0`. `/metrics` answers `200` here because the probe comes from loopback (or because `NODE_ENV` is `development`), either of which is allowed by the metrics allowlist.

**Step 5 — read a non-zero result.** Only `liveness` and `api-health` are required, so the other four degrade to warnings and the run still exits `0`:

```text
  ⚠ readiness   /ready        WARN — expected HTTP 200, got 503
```

A warning does not gate a deploy. A `✗` on a required check does — this run exits `1`:

```text
  ✗ api-health  /api/health   FAIL — expected HTTP 200, got 503
```

The Backtest service simulates portfolio threshold rebalancing over historical price windows. It replays real daily closing prices and applies the same drift-based rebalancing trigger used by the live threshold strategy:

Rebalance back to target weights whenever any asset's drift exceeds the configured percentage-point threshold.
Compare simulation results against a baseline buy-and-hold strategy across the exact same historical timeline.
Rely strictly on verified historical market data without falling back to synthetic/mock prices.


That is the same `503` as step 3, and the `dependencies` object from `curl` is what tells you whether it was Redis, the database, Horizon, or the oracle.

On a fresh start with no Redis, `/ready` and `/readiness` legitimately return `503` with `"status": "not_ready"` — they are the same handler, and they aggregate the database, Redis/queues, queue backlog, workers, the contract event indexer, and the auto-rebalancer. That is the warning in step 5, not a failure.

## Backtest endpoints

Historical price window evaluation and state persistence for portfolio rebalancing:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/backtest` | Run historical backtest across a date window or days lookback. |
| `GET` | `/api/v1/backtest/:id` | Fetch persisted backtest record by ID with verified state consistency. |
| `GET` | `/api/v1/backtest` | List persisted backtests with filters (`portfolioId`, `status`, `limit`, `offset`). |
| `POST` | `/api/portfolio/:id/backtest` | Run backtest using portfolio's target allocations and threshold. |
| `GET` | `/api/portfolio/:id/backtests` | List backtest history for a specific portfolio. |

For calendar window mechanics, leap-year boundary handling, and concurrency guarantees, see **[BACKTEST.md](BACKTEST.md)**.
