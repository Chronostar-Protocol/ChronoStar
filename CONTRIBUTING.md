# Contributing to ChronoStar

Thanks for your interest in contributing. ChronoStar is a Stellar Soroban protocol for scheduled and recurring payments.

## Prerequisites

- **Node.js** 22+
- **Rust** 1.79+ with the `wasm32-unknown-unknown` target
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Soroban CLI** (`stellar` or `soroban`)
  ```bash
  cargo install --locked stellar-cli --features opt
  ```

## Running Locally

### Contracts

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in required vars
npm run dev
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in contract addresses
npm install
npm run dev
```

### Keeper

```bash
cd keeper
cp .env.example .env   # fill in KEEPER_SECRET and contract addresses
npm install
npm start
```

## Troubleshooting

- **"wasm32 target not found"** — run `rustup target add wasm32-unknown-unknown`.
- **"stellar command not found"** — ensure `~/.cargo/bin` is in your `$PATH`.
- **Frontend fails to connect wallet** — make sure Freighter browser extension is installed and set to Testnet.
- **Keeper fails with "simulation error"** — verify contract addresses in `.env` match the current Testnet deployment.

## Running Tests

```bash
# Contracts (all three in workspace)
cd contract && cargo test

# Backend
cd backend && npm test

# Keeper
cd keeper && npm test

# Frontend (Next.js build checks types + lint)
cd frontend && npm run build && npm run lint
```

## Branch & Commit Conventions

- **Branch naming:** `feature/short-description`, `fix/short-description`, `docs/short-description`
- **PR base:** `master` (do not open PRs against other branches)
- **Commit messages:** Use [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — new feature
  - `fix:` — bug fix
  - `docs:` — documentation
  - `ci:` — CI/CD changes
  - `refactor:` — code restructuring without behavior change
  - `test:` — adding or updating tests

## Issue Labels & Drips Wave Points

Issues are labeled by complexity for the Drips Network Stellar Wave Program:

| Label | Estimated effort | Points |
|-------|-----------------|--------|
| `light` | < 4 hours | 1–2 |
| `medium` | 4–16 hours | 3–5 |
| `heavy` | > 16 hours | 6–10 |

**`good-first-issue`** marks tasks suitable for first-time contributors:
well-scoped, self-contained, and achievable without deep Stellar/Soroban knowledge.

## Getting Help

Open a GitHub Discussion or comment on an issue. We respond within 2–3 business days.
