# ChronoStar

Time-based payment primitives for the Stellar ecosystem — scheduled vaults, recurring streams, and DCA policies.

## Deployed Contracts (Testnet)

| Contract | Address |
|----------|---------|
| Schedule Vault | `CAAD4GP5VBJTL3AWKJCQSIMZ4ZDSOTDN6AAUQONOSI6QYGLFYYSHEP3T` |
| Recurring Stream | `CDFKO7H2VAPXZFQN6OF5KSJQXG7CO2JAGV5ZPQTQSYMT4Y6QLFG7A2FG` |
| DCA Policy | `CDFOXEG73Y47FWTVOT7I34RECW32LX6Y7H5VYU6NXWHFQ4BK52ELB7EM` |

## Deployed Services

| Service | URL |
|---------|-----|
| Frontend | https://chrono-star.vercel.app |
| Backend API | https://chronostar-backend-s905.onrender.com |
| Documentation | https://stellar-program.github.io/ChronoStar |
| Keeper Bot | _(not deployed — see below)_ |

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
- Rust 1.79+ with `wasm32-unknown-unknown` target
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

The keeper bot periodically checks for vaults/streams/DCA policies that are due for execution on-chain. To run it:

```bash
cd keeper
cp .env.example .env
# Edit .env with KEEPER_SECRET (Stellar testnet secret key)
npm install
npm start
```

The keeper can be deployed on Render as a Background Worker using `keeper/render.yaml`.

## API Endpoints

Base URL: `https://chronostar-backend-s905.onrender.com`

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Health check |
| `GET /api/stats` | Aggregated stats across all contracts |
| `GET /api/events` | Upcoming executable events |
| `GET /api/schedules/:address` | Vaults for an address |
| `GET /api/streams/:address` | Streams for an address |
| `GET /api/dca/:address` | DCA policies for an address |

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, and how to pick up a `good-first-issue`. All contributors must follow the [Code of Conduct](./CODE_OF_CONDUCT.md). See [CHANGELOG.md](./CHANGELOG.md) for release history and [ROADMAP.md](./ROADMAP.md) for upcoming milestones.

## License

MIT — see [LICENSE](./LICENSE)
