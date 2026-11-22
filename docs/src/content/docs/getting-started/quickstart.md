---
title: Quickstart
description: Deploy contracts, run the keeper, and open the dashboard.
---

## Prerequisites

- Node.js >=22.0.0 (see `.nvmrc`)
- Rust 1.84.0 with `wasm32-unknown-unknown` target
- Stellar Testnet account with some tokens
- Freighter wallet (browser extension)

## 1. Deploy Contracts

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release

# Install Stellar CLI
cargo install --locked stellar-cli

# Deploy each contract
stellar contract deploy \
  --wasm schedule-vault/target/wasm32-unknown-unknown/release/schedule_vault.wasm \
  --source <SECRET> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

Note the returned contract IDs. Set them in `.env` files.

## 2. Configure Environment

```bash
# Keeper
cd keeper
cp .env.example .env
# Edit .env with your secret key and contract IDs

# Backend
cd backend
cp .env.example .env
# Edit .env with contract IDs
```

## 3. Run the Keeper

```bash
cd keeper
npm install
npm start
```

The keeper will poll every 30 seconds and trigger on-chain actions.

## 4. Start the Backend

```bash
cd backend
npm install
npm start
```

## 5. Open the Dashboard

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000` and connect your Freighter wallet.

## Periodic Testnet Resets

The Stellar Development Foundation (SDF) periodically resets the Stellar Testnet, which removes all deployed contracts and ledger state. If you encounter contract missing errors or a freshly reset ledger sequence, follow the [Testnet Reset Recovery Runbook](../../operations/testnet-reset-recovery.md) to rebuild and re-synchronize your deployment.
