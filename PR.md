# ChronoStar — Product Requirements Document

> **Version**: 1.0.0  
> **Organization**: Stellar-Ecosystem  
> **Repos**: `Stellar-Ecosystem/chronostar` (main) · `Stellar-Ecosystem/chronostar-docs` (documentation site)  
> **Stack**: Rust/Soroban · Node.js · Next.js 14 · Astro Starlight  
> **Network**: Stellar Testnet (mainnet-ready via env var swap)  
> **Deployments**: Vercel (frontend) · Render (keeper) · GitHub Pages (docs) · Stellar Testnet (contracts)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Problem Statement](#2-problem-statement)
3. [Solution Architecture](#3-solution-architecture)
4. [Repository Structure — `chronostar`](#4-repository-structure--chronostar)
5. [Repository Structure — `chronostar-docs`](#5-repository-structure--chronostar-docs)
6. [Smart Contracts (Rust/Soroban)](#6-smart-contracts-rustsoroban)
   - 6.1 ScheduleVault
   - 6.2 RecurringStream
   - 6.3 DCAPolicy
7. [Keeper Bot (Node.js)](#7-keeper-bot-nodejs)
8. [Backend API (Node.js/Express)](#8-backend-api-nodejsexpress)
9. [Frontend (Next.js 14)](#9-frontend-nextjs-14)
10. [Documentation Site (Astro Starlight)](#10-documentation-site-astro-starlight)
11. [Deployment Guide](#11-deployment-guide)
12. [Environment Variables](#12-environment-variables)
13. [Testing Requirements](#13-testing-requirements)
14. [Lodestar Integration](#14-lodestar-integration)
15. [OnlyDust Issue Breakdown](#15-onlydust-issue-breakdown)
16. [Design & Style Guide](#16-design--style-guide)
17. [README Files](#17-readme-files)

---

## 1. Project Overview

**ChronoStar** is a scheduled and recurring payments protocol built on Stellar's Soroban smart contract platform. It introduces three time-based payment primitives that do not exist natively on Stellar:

| Contract | Purpose |
|---|---|
| `ScheduleVault` | Lock funds and release them to a recipient at a specific future ledger/time |
| `RecurringStream` | Stream payments continuously, dripping funds per ledger interval |
| `DCAPolicy` | Automate Dollar-Cost Averaging — swap fixed USDC amounts into XLM on a recurring schedule |

ChronoStar is managed by a **Keeper Bot** — an always-on Node.js service that monitors active schedules and triggers on-chain releases/swaps when their time conditions are met. A **Next.js dashboard** gives users a clean interface to create, view, and cancel schedules. All payments move through Stellar's native asset layer (XLM and USDC issued on Stellar testnet).

ChronoStar integrates directly with **Lodestar** (`Stellar-Ecosystem/lodestar`): AI agents registered in Lodestar's credit scoring contract can create ChronoStar schedules to auto-pay for recurring service subscriptions, making ChronoStar the time-based payment layer of the Stellar agent economy.

---

## 2. Problem Statement

Stellar's payment rails are fast and cheap but fundamentally **synchronous and manual** — a payment only happens when a human (or a script) initiates it. There is no protocol-level primitive for:

- **Vesting**: Lock tokens and release them to a team member or investor on a cliff+vesting schedule
- **Subscriptions**: Charge a wallet monthly/weekly automatically without requiring the user to re-sign every time
- **Payroll**: Pay multiple employees in XLM or USDC on a fixed cadence
- **DCA**: Automatically convert a fixed amount of USDC into XLM every 24 hours
- **Recurring agent payments**: Let an AI agent pre-authorize a weekly payment to a Lodestar-registered service without human intervention

All of these exist on EVM chains (Sablier, Superfluid, Gelato) but not on Stellar. ChronoStar closes this gap using Soroban's persistent storage, TTL-extended ledger state, and an external keeper network for time-triggered execution.

---

## 3. Solution Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            CHRONOSTAR ARCHITECTURE                           │
│                                                                              │
│  USER / AGENT                                                                │
│    │                                                                         │
│    │  1. Create schedule (lock funds)                                        │
│    ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                     SOROBAN SMART CONTRACTS                          │    │
│  │                                                                      │    │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │    │
│  │  │  ScheduleVault  │  │ RecurringStream  │  │   DCAPolicy      │   │    │
│  │  │                 │  │                  │  │                  │   │    │
│  │  │ create_vault()  │  │ create_stream()  │  │ create_dca()     │   │    │
│  │  │ release()       │  │ tick()           │  │ execute_swap()   │   │    │
│  │  │ cancel()        │  │ cancel()         │  │ cancel()         │   │    │
│  │  │ get_vault()     │  │ get_stream()     │  │ get_dca()        │   │    │
│  │  └────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘   │    │
│  │           │                    │                      │             │    │
│  └───────────┼────────────────────┼──────────────────────┼─────────────┘    │
│              │                    │                      │                  │
│              └────────────────────┴──────────────────────┘                  │
│                                          │                                  │
│                                          │  2. Poll + trigger               │
│                                          ▼                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        KEEPER BOT (Node.js)                           │  │
│  │                                                                       │  │
│  │  - Polls all contracts every 30 seconds                               │  │
│  │  - Compares current ledger vs schedule trigger ledger                 │  │
│  │  - Calls release() / tick() / execute_swap() when conditions met      │  │
│  │  - Retries on failure with exponential backoff                        │  │
│  │  - Emits events to backend via HTTP POST                              │  │
│  │  - Exposes /healthz and /metrics endpoints                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                          │                                  │
│                                          │  3. Read state / log events      │
│                                          ▼                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       BACKEND API (Express)                           │  │
│  │                                                                       │  │
│  │  GET  /api/schedules/:address   - list all schedules for an address   │  │
│  │  GET  /api/schedule/:id         - get single schedule details         │  │
│  │  GET  /api/streams/:address     - list all streams                    │  │
│  │  GET  /api/dca/:address         - list all DCA policies               │  │
│  │  GET  /api/events               - recent keeper execution log         │  │
│  │  GET  /api/stats                - protocol-level stats                │  │
│  │  GET  /healthz                  - health check                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                          │                                  │
│                                          │  4. Display                      │
│                                          ▼                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       FRONTEND (Next.js 14)                           │  │
│  │                                                                       │  │
│  │  / (landing)        - hero, features, live stats                      │  │
│  │  /dashboard         - connect Freighter, view all user schedules      │  │
│  │  /vault/new         - create a ScheduleVault                          │  │
│  │  /stream/new        - create a RecurringStream                        │  │
│  │  /dca/new           - create a DCAPolicy                              │  │
│  │  /vault/:id         - view vault detail + release status              │  │
│  │  /stream/:id        - view stream progress + claimable amount         │  │
│  │  /dca/:id           - view DCA history + next execution               │  │
│  │  /explorer          - browse all active schedules (public)            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Keeper-based execution**: Soroban contracts cannot self-execute. The keeper bot monitors time conditions off-chain and submits the trigger transaction. This is the same pattern used by Gelato on EVM. The keeper's Stellar keypair is stored in env vars and it pays its own gas (XLM fees are ~0.00001 XLM per tx).
- **Persistent storage with TTL extension**: Every contract uses `env.storage().persistent()` with `extend_ttl()` called on every write to ensure data is never archived off-chain.
- **Ledger-based time**: All time comparisons use Stellar ledger numbers (not wall clock time). A Stellar ledger closes every ~5 seconds. 17,280 ledgers ≈ 24 hours. This makes time logic deterministic and manipulation-resistant.
- **Token transfer model**: Funds are held in the contract itself (using Stellar's `token::Client` to call `transfer_from`). The user approves the contract as a spender before creating a schedule.
- **No upgradeable contracts**: For simplicity and trust, contracts are immutable after deployment. A new version would be deployed to a new address.

---

## 4. Repository Structure — `chronostar`

```
chronostar/
│
├── contract/
│   ├── schedule-vault/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── lib.rs
│   ├── recurring-stream/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── lib.rs
│   ├── dca-policy/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── lib.rs
│   ├── Cargo.toml              (workspace)
│   └── DEPLOY.md
│
├── keeper/
│   ├── src/
│   │   ├── index.js            (entry point — starts all watchers)
│   │   ├── watchers/
│   │   │   ├── vault.js        (watches ScheduleVault)
│   │   │   ├── stream.js       (watches RecurringStream)
│   │   │   └── dca.js          (watches DCAPolicy)
│   │   ├── stellar.js          (Stellar SDK helpers — submit tx, get ledger)
│   │   ├── logger.js           (pino logger)
│   │   └── metrics.js          (simple in-memory counters)
│   ├── package.json
│   ├── .env.example
│   └── render.yaml
│
├── backend/
│   ├── src/
│   │   ├── index.js            (Express app entry)
│   │   ├── routes/
│   │   │   ├── schedules.js
│   │   │   ├── streams.js
│   │   │   ├── dca.js
│   │   │   ├── events.js
│   │   │   └── stats.js
│   │   ├── stellar.js          (contract read helpers)
│   │   ├── store.js            (in-memory event log — no DB required)
│   │   └── logger.js
│   ├── package.json
│   ├── .env.example
│   └── render.yaml
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  (landing)
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── vault/
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── stream/
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── dca/
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   └── explorer/
│   │   │       └── page.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Navbar.tsx
│   │   │   │   └── Footer.tsx
│   │   │   ├── wallet/
│   │   │   │   └── ConnectButton.tsx
│   │   │   ├── vault/
│   │   │   │   ├── VaultCard.tsx
│   │   │   │   ├── CreateVaultForm.tsx
│   │   │   │   └── VaultDetail.tsx
│   │   │   ├── stream/
│   │   │   │   ├── StreamCard.tsx
│   │   │   │   ├── CreateStreamForm.tsx
│   │   │   │   └── StreamDetail.tsx
│   │   │   ├── dca/
│   │   │   │   ├── DCACard.tsx
│   │   │   │   ├── CreateDCAForm.tsx
│   │   │   │   └── DCADetail.tsx
│   │   │   └── shared/
│   │   │       ├── StatsBar.tsx
│   │   │       ├── LedgerClock.tsx
│   │   │       ├── TxToast.tsx
│   │   │       └── EmptyState.tsx
│   │   ├── lib/
│   │   │   ├── stellar.ts          (SDK wrappers)
│   │   │   ├── contracts.ts        (contract invocation helpers)
│   │   │   ├── freighter.ts        (wallet integration)
│   │   │   └── utils.ts
│   │   └── styles/
│   │       └── globals.css
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── .env.local.example
│   └── vercel.json
│
├── scripts/
│   ├── deploy-all.sh           (deploy all 3 contracts to testnet)
│   ├── seed.js                 (create demo vault/stream/dca for testing)
│   └── check-contracts.js      (verify deployed contracts are live)
│
├── .github/
│   └── workflows/
│       ├── test-contracts.yml
│       ├── test-keeper.yml
│       └── deploy-frontend.yml
│
├── .gitignore
├── FUNDING.json
├── README.md
└── PRD.md
```

---

## 5. Repository Structure — `chronostar-docs`

This is a **separate repo** (`Stellar-Ecosystem/chronostar-docs`) that deploys to GitHub Pages at `https://stellar-ecosystem.github.io/chronostar-docs` (or a custom domain).

```
chronostar-docs/
│
├── src/
│   ├── content/
│   │   ├── config.ts
│   │   └── docs/
│   │       ├── index.mdx               (home)
│   │       ├── getting-started/
│   │       │   ├── overview.mdx
│   │       │   ├── installation.mdx
│   │       │   └── quickstart.mdx
│   │       ├── contracts/
│   │       │   ├── schedule-vault.mdx
│   │       │   ├── recurring-stream.mdx
│   │       │   └── dca-policy.mdx
│   │       ├── keeper/
│   │       │   ├── overview.mdx
│   │       │   └── self-hosting.mdx
│   │       ├── frontend/
│   │       │   └── using-the-dashboard.mdx
│   │       ├── api/
│   │       │   └── rest-api.mdx
│   │       ├── integration/
│   │       │   ├── lodestar.mdx
│   │       │   └── agents.mdx
│   │       └── reference/
│   │           ├── contract-addresses.mdx
│   │           └── error-codes.mdx
│   └── assets/
│       ├── chronostar-logo.svg
│       └── architecture.png
│
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── .github/
│   └── workflows/
│       └── deploy-docs.yml         (GitHub Actions → GitHub Pages)
└── README.md
```

---

## 6. Smart Contracts (Rust/Soroban)

### Prerequisites

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

### Workspace `contract/Cargo.toml`

```toml
[workspace]
members = [
  "schedule-vault",
  "recurring-stream",
  "dca-policy",
]
resolver = "2"

[workspace.dependencies]
soroban-sdk = { version = "22.0.0", features = ["testutils"] }
```

---

### 6.1 ScheduleVault Contract

**Purpose**: A user locks an amount of a Stellar token into this contract, specifies a recipient address, and a trigger ledger number. The keeper bot (or anyone) can call `release()` after the trigger ledger is reached, which transfers funds to the recipient. The sender can cancel before the trigger ledger and get funds back.

**File**: `contract/schedule-vault/src/lib.rs`

```rust
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Vault(u64),          // vault_id → VaultEntry
    Counter,             // global vault ID counter
    VaultsByOwner(Address), // owner → Vec<u64> of vault IDs
}

// ─── Data Types ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct VaultEntry {
    pub id: u64,
    pub owner: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,   // trigger ledger number
    pub created_ledger: u32,
    pub label: String,         // human-readable label e.g. "Team vesting Q1"
    pub status: VaultStatus,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum VaultStatus {
    Active,
    Released,
    Cancelled,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct ScheduleVault;

#[contractimpl]
impl ScheduleVault {
    // Create a new vault. Caller must have approved this contract as a spender
    // for `amount` of `token` before calling this function.
    //
    // Parameters:
    //   owner         - the wallet funding the vault (must auth this call)
    //   recipient     - who receives funds at release
    //   token         - Stellar token contract address (USDC or XLM)
    //   amount        - amount in stroops (XLM) or smallest unit (USDC 7 decimals)
    //   release_ledger - ledger number after which release() becomes callable
    //   label         - UTF-8 label up to 64 chars
    //
    // Returns: vault_id (u64)
    pub fn create_vault(
        env: Env,
        owner: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        release_ledger: u32,
        label: String,
    ) -> u64 {
        owner.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(
            release_ledger > env.ledger().sequence(),
            "release_ledger must be in the future"
        );
        assert!(label.len() <= 64, "label max 64 chars");

        // Transfer tokens from owner into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &amount,
        );

        // Increment counter
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::Counter, &id);

        let vault = VaultEntry {
            id,
            owner: owner.clone(),
            recipient,
            token,
            amount,
            release_ledger,
            created_ledger: env.ledger().sequence(),
            label,
            status: VaultStatus::Active,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Vault(id), &vault);

        // Extend TTL so storage persists long-term (approximately 1 year of ledgers)
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(id), 6_312_000, 6_312_000);

        // Track vault under owner
        let mut owner_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_vaults.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::VaultsByOwner(owner.clone()), &owner_vaults);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VaultsByOwner(owner), 6_312_000, 6_312_000);

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    // Release vault funds to recipient. Callable by anyone (typically the keeper).
    // Fails if: vault not Active, or current ledger < release_ledger.
    pub fn release(env: Env, vault_id: u64) {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        assert!(vault.status == VaultStatus::Active, "vault not active");
        assert!(
            env.ledger().sequence() >= vault.release_ledger,
            "too early to release"
        );

        vault.status = VaultStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(
            &env.current_contract_address(),
            &vault.recipient,
            &vault.amount,
        );

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(vault_id), 6_312_000, 6_312_000);
    }

    // Cancel vault and return funds to owner. Only callable by vault owner.
    // Fails if vault is not Active or release_ledger has already passed.
    pub fn cancel(env: Env, vault_id: u64) {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        assert!(vault.status == VaultStatus::Active, "vault not active");
        assert!(
            env.ledger().sequence() < vault.release_ledger,
            "cannot cancel after release ledger"
        );

        vault.status = VaultStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(
            &env.current_contract_address(),
            &vault.owner,
            &vault.amount,
        );
    }

    // Read a vault by ID. Returns None if not found.
    pub fn get_vault(env: Env, vault_id: u64) -> Option<VaultEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
    }

    // Get all vault IDs owned by an address.
    pub fn get_vaults_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    // Get the current ledger number (useful for frontend to compute offsets).
    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    // Get total vault count.
    pub fn vault_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }
}
```

**File**: `contract/schedule-vault/Cargo.toml`

```toml
[package]
name = "schedule-vault"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

---

### 6.2 RecurringStream Contract

**Purpose**: Streams a total amount of tokens to a recipient over a period of time, dripping it proportionally per ledger. At any point the recipient can call `claim()` to withdraw what has accrued since last claim. The owner can cancel, returning unclaimed and unstreamed remainder to themselves. The keeper bot calls `tick()` periodically to update the accrued amount (though claim() computes it lazily so tick() is optional — it mainly serves as a heartbeat for the keeper).

**File**: `contract/recurring-stream/src/lib.rs`

```rust
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

#[contracttype]
pub enum DataKey {
    Stream(u64),
    Counter,
    StreamsByOwner(Address),
    StreamsByRecipient(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct StreamEntry {
    pub id: u64,
    pub owner: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,       // total to stream over the full period
    pub claimed_amount: i128,     // total already claimed by recipient
    pub start_ledger: u32,
    pub end_ledger: u32,          // stream is fully vested at this ledger
    pub last_claimed_ledger: u32,
    pub created_ledger: u32,
    pub label: String,
    pub status: StreamStatus,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum StreamStatus {
    Active,
    Completed,
    Cancelled,
}

impl StreamEntry {
    // Compute how many tokens have accrued as of `current_ledger` that have
    // not yet been claimed. Uses linear vesting.
    pub fn claimable_amount(&self, current_ledger: u32) -> i128 {
        if self.status != StreamStatus::Active {
            return 0;
        }
        let effective_ledger = current_ledger.min(self.end_ledger);
        if effective_ledger <= self.last_claimed_ledger {
            return 0;
        }
        let total_duration = (self.end_ledger - self.start_ledger) as i128;
        if total_duration == 0 {
            return 0;
        }
        let elapsed = (effective_ledger - self.start_ledger) as i128;
        let vested = (self.total_amount * elapsed) / total_duration;
        let claimable = vested - self.claimed_amount;
        claimable.max(0)
    }
}

#[contract]
pub struct RecurringStream;

#[contractimpl]
impl RecurringStream {
    // Create a new stream. Owner must have pre-approved contract as token spender.
    //
    // Parameters:
    //   owner        - funder of the stream
    //   recipient    - who receives tokens
    //   token        - Stellar token address
    //   total_amount - total tokens to stream (transferred in immediately)
    //   duration_ledgers - how many ledgers until fully streamed
    //                      (17280 = ~1 day, 120960 = ~1 week, 524160 = ~1 month)
    //   label        - human label
    //
    // Returns: stream_id
    pub fn create_stream(
        env: Env,
        owner: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        duration_ledgers: u32,
        label: String,
    ) -> u64 {
        owner.require_auth();
        assert!(total_amount > 0, "amount must be positive");
        assert!(duration_ledgers >= 60, "minimum duration is 60 ledgers (~5 min)");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total_amount,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let current = env.ledger().sequence();
        let stream = StreamEntry {
            id,
            owner: owner.clone(),
            recipient: recipient.clone(),
            token,
            total_amount,
            claimed_amount: 0,
            start_ledger: current,
            end_ledger: current + duration_ledgers,
            last_claimed_ledger: current,
            created_ledger: current,
            label,
            status: StreamStatus::Active,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Stream(id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(id), 6_312_000, 6_312_000);

        // Index by owner
        let mut owner_streams: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_streams.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::StreamsByOwner(owner.clone()), &owner_streams);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::StreamsByOwner(owner), 6_312_000, 6_312_000);

        // Index by recipient
        let mut rec_streams: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamsByRecipient(recipient.clone()))
            .unwrap_or(Vec::new(&env));
        rec_streams.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::StreamsByRecipient(recipient.clone()), &rec_streams);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::StreamsByRecipient(recipient), 6_312_000, 6_312_000);

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    // Claim all accrued tokens for a stream. Callable by recipient only.
    // Transfers claimable amount to recipient and updates last_claimed_ledger.
    pub fn claim(env: Env, stream_id: u64) -> i128 {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.recipient.require_auth();
        assert!(stream.status == StreamStatus::Active, "stream not active");

        let current = env.ledger().sequence();
        let claimable = stream.claimable_amount(current);
        assert!(claimable > 0, "nothing to claim");

        stream.claimed_amount += claimable;
        stream.last_claimed_ledger = current;

        // Mark completed if fully streamed
        if stream.claimed_amount >= stream.total_amount
            || current >= stream.end_ledger
        {
            stream.status = StreamStatus::Completed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);

        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(
            &env.current_contract_address(),
            &stream.recipient,
            &claimable,
        );

        claimable
    }

    // Keeper heartbeat — updates stream state and checks for completion.
    // Anyone can call this. The keeper calls it every poll cycle.
    pub fn tick(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.status != StreamStatus::Active {
            return;
        }

        if env.ledger().sequence() >= stream.end_ledger
            && stream.claimed_amount >= stream.total_amount
        {
            stream.status = StreamStatus::Completed;
            env.storage()
                .persistent()
                .set(&DataKey::Stream(stream_id), &stream);
        }

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);
    }

    // Cancel stream. Owner only. Returns unclaimed remainder to owner.
    pub fn cancel(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(stream.status == StreamStatus::Active, "stream not active");

        let current = env.ledger().sequence();

        // Pay out any claimable amount to recipient first
        let claimable = stream.claimable_amount(current);
        let token_client = token::Client::new(&env, &stream.token);

        if claimable > 0 {
            stream.claimed_amount += claimable;
            token_client.transfer(
                &env.current_contract_address(),
                &stream.recipient,
                &claimable,
            );
        }

        // Return remainder to owner
        let remainder = stream.total_amount - stream.claimed_amount;
        if remainder > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.owner,
                &remainder,
            );
        }

        stream.status = StreamStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Option<StreamEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
    }

    pub fn get_claimable(env: Env, stream_id: u64) -> i128 {
        let stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");
        stream.claimable_amount(env.ledger().sequence())
    }

    pub fn get_streams_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::StreamsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_streams_by_recipient(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::StreamsByRecipient(recipient))
            .unwrap_or(Vec::new(&env))
    }

    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    pub fn stream_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }
}
```

---

### 6.3 DCAPolicy Contract

**Purpose**: User locks a total USDC budget into the contract and defines a recurring DCA interval (in ledgers) and a per-execution swap amount. At each interval the keeper calls `execute_swap()`, which transfers the USDC directly to a designated receiver address (in a real mainnet scenario this would be a DEX contract; for testnet we simulate by transferring to a designated "swap simulator" address and emitting a swap event). The pattern demonstrates the scheduling mechanism — a DEX integration can be wired in later.

**File**: `contract/dca-policy/src/lib.rs`

```rust
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

#[contracttype]
pub enum DataKey {
    DCA(u64),
    Counter,
    DCAsByOwner(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct DCAEntry {
    pub id: u64,
    pub owner: Address,
    pub token_in: Address,         // USDC address
    pub swap_receiver: Address,    // address to receive USDC on each execution (swap simulator / DEX)
    pub total_budget: i128,        // total USDC locked
    pub remaining_budget: i128,    // how much is left
    pub amount_per_swap: i128,     // USDC per execution
    pub interval_ledgers: u32,     // how many ledgers between swaps (e.g. 17280 = daily)
    pub last_executed_ledger: u32,
    pub next_execution_ledger: u32,
    pub executions_completed: u32,
    pub created_ledger: u32,
    pub label: String,
    pub status: DCAStatus,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DCAStatus {
    Active,
    Exhausted,    // budget fully used
    Cancelled,
}

#[contract]
pub struct DCAPolicy;

#[contractimpl]
impl DCAPolicy {
    // Create a DCA policy.
    //
    // Parameters:
    //   owner            - wallet funding the DCA
    //   token_in         - USDC token address
    //   swap_receiver    - where to send USDC each execution (DEX / simulator)
    //   total_budget     - total USDC to commit
    //   amount_per_swap  - USDC per execution
    //   interval_ledgers - ledgers between executions (minimum 120 = ~10 min)
    //   label            - human label
    //
    // total_budget must be an exact multiple of amount_per_swap.
    pub fn create_dca(
        env: Env,
        owner: Address,
        token_in: Address,
        swap_receiver: Address,
        total_budget: i128,
        amount_per_swap: i128,
        interval_ledgers: u32,
        label: String,
    ) -> u64 {
        owner.require_auth();
        assert!(total_budget > 0 && amount_per_swap > 0, "amounts must be positive");
        assert!(
            total_budget % amount_per_swap == 0,
            "total_budget must be exact multiple of amount_per_swap"
        );
        assert!(interval_ledgers >= 120, "minimum interval is 120 ledgers");

        let token_client = token::Client::new(&env, &token_in);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total_budget,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let current = env.ledger().sequence();
        let dca = DCAEntry {
            id,
            owner: owner.clone(),
            token_in,
            swap_receiver,
            total_budget,
            remaining_budget: total_budget,
            amount_per_swap,
            interval_ledgers,
            last_executed_ledger: current,
            next_execution_ledger: current + interval_ledgers,
            executions_completed: 0,
            created_ledger: current,
            label,
            status: DCAStatus::Active,
        };

        env.storage().persistent().set(&DataKey::DCA(id), &dca);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCA(id), 6_312_000, 6_312_000);

        let mut owner_dcas: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::DCAsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_dcas.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::DCAsByOwner(owner.clone()), &owner_dcas);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCAsByOwner(owner), 6_312_000, 6_312_000);

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    // Execute the next DCA swap. Callable by anyone (typically the keeper).
    // Fails if it is too early (current ledger < next_execution_ledger).
    pub fn execute_swap(env: Env, dca_id: u64) {
        let mut dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        assert!(dca.status == DCAStatus::Active, "DCA not active");
        assert!(
            env.ledger().sequence() >= dca.next_execution_ledger,
            "too early to execute"
        );
        assert!(
            dca.remaining_budget >= dca.amount_per_swap,
            "insufficient budget"
        );

        let token_client = token::Client::new(&env, &dca.token_in);
        token_client.transfer(
            &env.current_contract_address(),
            &dca.swap_receiver,
            &dca.amount_per_swap,
        );

        dca.remaining_budget -= dca.amount_per_swap;
        dca.executions_completed += 1;
        dca.last_executed_ledger = env.ledger().sequence();
        dca.next_execution_ledger = env.ledger().sequence() + dca.interval_ledgers;

        if dca.remaining_budget == 0 {
            dca.status = DCAStatus::Exhausted;
        }

        env.storage().persistent().set(&DataKey::DCA(dca_id), &dca);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCA(dca_id), 6_312_000, 6_312_000);
    }

    // Cancel DCA and return remaining budget to owner.
    pub fn cancel(env: Env, dca_id: u64) {
        let mut dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        dca.owner.require_auth();
        assert!(dca.status == DCAStatus::Active, "DCA not active");

        if dca.remaining_budget > 0 {
            let token_client = token::Client::new(&env, &dca.token_in);
            token_client.transfer(
                &env.current_contract_address(),
                &dca.owner,
                &dca.remaining_budget,
            );
        }

        dca.remaining_budget = 0;
        dca.status = DCAStatus::Cancelled;
        env.storage().persistent().set(&DataKey::DCA(dca_id), &dca);
    }

    pub fn get_dca(env: Env, dca_id: u64) -> Option<DCAEntry> {
        env.storage().persistent().get(&DataKey::DCA(dca_id))
    }

    pub fn get_dcas_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::DCAsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    pub fn dca_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }
}
```

---

## 7. Keeper Bot (Node.js)

The keeper bot is a Node.js v22 service that runs in an infinite poll loop. It reads active schedules from each contract and submits trigger transactions when conditions are met.

### `keeper/package.json`

```json
{
  "name": "chronostar-keeper",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^13.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^13.0.0"
  }
}
```

### `keeper/src/index.js`

```javascript
import { startVaultWatcher } from './watchers/vault.js';
import { startStreamWatcher } from './watchers/stream.js';
import { startDCAWatcher } from './watchers/dca.js';
import { logger } from './logger.js';
import http from 'http';
import { getMetrics, incrementMetric } from './metrics.js';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '30000');

// Health server — Render needs an HTTP port to mark service healthy
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getMetrics()));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(process.env.PORT ?? 3002, () => {
  logger.info(`Keeper health server running on port ${process.env.PORT ?? 3002}`);
});

logger.info({ poll_interval_ms: POLL_INTERVAL_MS }, 'ChronoStar Keeper starting');

// Validate required env vars
const required = [
  'KEEPER_SECRET',
  'VAULT_CONTRACT_ID',
  'STREAM_CONTRACT_ID',
  'DCA_CONTRACT_ID',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
];
for (const key of required) {
  if (!process.env[key]) {
    logger.error({ key }, 'Missing required env var');
    process.exit(1);
  }
}

async function runCycle() {
  logger.info('Starting poll cycle');
  await Promise.allSettled([
    startVaultWatcher(),
    startStreamWatcher(),
    startDCAWatcher(),
  ]);
  logger.info('Poll cycle complete');
}

// Run immediately on start, then every POLL_INTERVAL_MS
await runCycle();
setInterval(runCycle, POLL_INTERVAL_MS);
```

### `keeper/src/stellar.js`

```javascript
import * as StellarSdk from '@stellar/stellar-sdk';

const server = new StellarSdk.SorobanRpc.Server(process.env.STELLAR_RPC_URL);
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
const keeperKeypair = StellarSdk.Keypair.fromSecret(process.env.KEEPER_SECRET);

export async function getCurrentLedger() {
  const latestLedger = await server.getLatestLedger();
  return latestLedger.sequence;
}

// Generic function to call a contract function that mutates state
export async function invokeContract(contractId, method, args = []) {
  const account = await server.getAccount(keeperKeypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keeperKeypair);

  const result = await server.sendTransaction(preparedTx);

  if (result.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  // Poll for confirmation
  let attempts = 0;
  while (attempts < 10) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await server.getTransaction(result.hash);
    if (status.status === 'SUCCESS') {
      return { hash: result.hash, status: 'SUCCESS' };
    }
    if (status.status === 'FAILED') {
      throw new Error(`Transaction confirmed failed: ${result.hash}`);
    }
    attempts++;
  }
  throw new Error('Transaction did not confirm in time');
}

// Read-only contract call (simulation only, no fee)
export async function readContract(contractId, method, args = []) {
  const account = await server.getAccount(keeperKeypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error: ${result.error}`);
  }

  return StellarSdk.scValToNative(result.result.retval);
}
```

### `keeper/src/watchers/vault.js`

```javascript
import { logger } from '../logger.js';
import { getCurrentLedger, invokeContract, readContract } from '../stellar.js';
import { incrementMetric } from '../metrics.js';
import * as StellarSdk from '@stellar/stellar-sdk';

const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID;

export async function startVaultWatcher() {
  try {
    const currentLedger = await getCurrentLedger();
    const totalVaults = await readContract(VAULT_CONTRACT_ID, 'vault_count');

    if (totalVaults === 0n || totalVaults === 0) {
      logger.info('VaultWatcher: no vaults found');
      return;
    }

    const vaultCount = Number(totalVaults);
    logger.info({ vaultCount, currentLedger }, 'VaultWatcher: scanning vaults');

    for (let id = 1; id <= vaultCount; id++) {
      try {
        const vault = await readContract(
          VAULT_CONTRACT_ID,
          'get_vault',
          [StellarSdk.nativeToScVal(id, { type: 'u64' })]
        );

        if (!vault) continue;

        // Only process Active vaults
        if (vault.status?.toString() !== 'Active') continue;

        const releaseLedger = Number(vault.release_ledger ?? vault.releaseLedger);

        if (currentLedger >= releaseLedger) {
          logger.info({ vault_id: id, currentLedger, releaseLedger }, 'VaultWatcher: releasing vault');

          const result = await invokeContract(
            VAULT_CONTRACT_ID,
            'release',
            [StellarSdk.nativeToScVal(id, { type: 'u64' })]
          );

          logger.info({ vault_id: id, tx: result.hash }, 'VaultWatcher: vault released');
          incrementMetric('vaults_released');
        }
      } catch (err) {
        logger.warn({ vault_id: id, err: err.message }, 'VaultWatcher: error processing vault');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'VaultWatcher: fatal error in cycle');
  }
}
```

### `keeper/src/watchers/stream.js`

```javascript
import { logger } from '../logger.js';
import { getCurrentLedger, invokeContract, readContract } from '../stellar.js';
import { incrementMetric } from '../metrics.js';
import * as StellarSdk from '@stellar/stellar-sdk';

const STREAM_CONTRACT_ID = process.env.STREAM_CONTRACT_ID;

export async function startStreamWatcher() {
  try {
    const currentLedger = await getCurrentLedger();
    const totalStreams = await readContract(STREAM_CONTRACT_ID, 'stream_count');

    if (totalStreams === 0n || totalStreams === 0) {
      logger.info('StreamWatcher: no streams found');
      return;
    }

    const streamCount = Number(totalStreams);
    logger.info({ streamCount, currentLedger }, 'StreamWatcher: scanning streams');

    for (let id = 1; id <= streamCount; id++) {
      try {
        const stream = await readContract(
          STREAM_CONTRACT_ID,
          'get_stream',
          [StellarSdk.nativeToScVal(id, { type: 'u64' })]
        );

        if (!stream) continue;
        if (stream.status?.toString() !== 'Active') continue;

        // Tick the stream to update state and check for completion
        await invokeContract(
          STREAM_CONTRACT_ID,
          'tick',
          [StellarSdk.nativeToScVal(id, { type: 'u64' })]
        );

        incrementMetric('stream_ticks');
        logger.debug({ stream_id: id }, 'StreamWatcher: ticked stream');
      } catch (err) {
        logger.warn({ stream_id: id, err: err.message }, 'StreamWatcher: error processing stream');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'StreamWatcher: fatal error in cycle');
  }
}
```

### `keeper/src/watchers/dca.js`

```javascript
import { logger } from '../logger.js';
import { getCurrentLedger, invokeContract, readContract } from '../stellar.js';
import { incrementMetric } from '../metrics.js';
import * as StellarSdk from '@stellar/stellar-sdk';

const DCA_CONTRACT_ID = process.env.DCA_CONTRACT_ID;

export async function startDCAWatcher() {
  try {
    const currentLedger = await getCurrentLedger();
    const totalDCAs = await readContract(DCA_CONTRACT_ID, 'dca_count');

    if (totalDCAs === 0n || totalDCAs === 0) {
      logger.info('DCAWatcher: no DCAs found');
      return;
    }

    const dcaCount = Number(totalDCAs);
    logger.info({ dcaCount, currentLedger }, 'DCAWatcher: scanning DCA policies');

    for (let id = 1; id <= dcaCount; id++) {
      try {
        const dca = await readContract(
          DCA_CONTRACT_ID,
          'get_dca',
          [StellarSdk.nativeToScVal(id, { type: 'u64' })]
        );

        if (!dca) continue;
        if (dca.status?.toString() !== 'Active') continue;

        const nextExecution = Number(dca.next_execution_ledger ?? dca.nextExecutionLedger);

        if (currentLedger >= nextExecution) {
          logger.info({ dca_id: id, currentLedger, nextExecution }, 'DCAWatcher: executing swap');

          const result = await invokeContract(
            DCA_CONTRACT_ID,
            'execute_swap',
            [StellarSdk.nativeToScVal(id, { type: 'u64' })]
          );

          logger.info({ dca_id: id, tx: result.hash }, 'DCAWatcher: swap executed');
          incrementMetric('dca_swaps_executed');
        }
      } catch (err) {
        logger.warn({ dca_id: id, err: err.message }, 'DCAWatcher: error processing DCA');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'DCAWatcher: fatal error in cycle');
  }
}
```

### `keeper/src/metrics.js`

```javascript
const metrics = {
  vaults_released: 0,
  stream_ticks: 0,
  dca_swaps_executed: 0,
  errors: 0,
  poll_cycles: 0,
};

export function incrementMetric(key) {
  if (key in metrics) metrics[key]++;
}

export function getMetrics() {
  return { ...metrics, uptime_seconds: Math.floor(process.uptime()) };
}
```

### `keeper/src/logger.js`

```javascript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

### `keeper/render.yaml`

```yaml
services:
  - type: worker
    name: chronostar-keeper
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: KEEPER_SECRET
        sync: false
      - key: VAULT_CONTRACT_ID
        sync: false
      - key: STREAM_CONTRACT_ID
        sync: false
      - key: DCA_CONTRACT_ID
        sync: false
      - key: STELLAR_RPC_URL
        value: https://soroban-testnet.stellar.org
      - key: STELLAR_NETWORK_PASSPHRASE
        value: Test SDF Network ; September 2015
      - key: POLL_INTERVAL_MS
        value: "30000"
      - key: LOG_LEVEL
        value: info
      - key: PORT
        value: "3002"
```

### `keeper/.env.example`

```
KEEPER_SECRET=S...                          # Stellar secret key for keeper wallet (funded on testnet)
VAULT_CONTRACT_ID=C...                      # Deployed ScheduleVault contract address
STREAM_CONTRACT_ID=C...                     # Deployed RecurringStream contract address
DCA_CONTRACT_ID=C...                        # Deployed DCAPolicy contract address
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
POLL_INTERVAL_MS=30000
PORT=3002
LOG_LEVEL=info
```

---

## 8. Backend API (Node.js/Express)

The backend aggregates contract state and serves it to the frontend, and receives heartbeat events from the keeper.

### `backend/package.json`

```json
{
  "name": "chronostar-backend",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^13.0.0",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "pino": "^9.0.0",
    "pino-http": "^10.0.0",
    "pino-pretty": "^13.0.0"
  }
}
```

### `backend/src/index.js`

```javascript
import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import schedulesRouter from './routes/schedules.js';
import streamsRouter from './routes/streams.js';
import dcaRouter from './routes/dca.js';
import eventsRouter from './routes/events.js';
import statsRouter from './routes/stats.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', service: 'chronostar-backend' });
});

app.use('/api/schedules', schedulesRouter);
app.use('/api/streams', streamsRouter);
app.use('/api/dca', dcaRouter);
app.use('/api/events', eventsRouter);
app.use('/api/stats', statsRouter);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'ChronoStar backend started');
});
```

### `backend/src/stellar.js`

```javascript
import * as StellarSdk from '@stellar/stellar-sdk';

const server = new StellarSdk.SorobanRpc.Server(
  process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
);
const networkPassphrase =
  process.env.STELLAR_NETWORK_PASSPHRASE ??
  'Test SDF Network ; September 2015';

// Use a dummy keypair for read-only simulation (no auth needed)
const dummyKeypair = StellarSdk.Keypair.random();

export async function readContract(contractId, method, args = []) {
  const account = new StellarSdk.Account(dummyKeypair.publicKey(), '0');
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) {
    return null;
  }

  return StellarSdk.scValToNative(result.result.retval);
}

export async function getCurrentLedger() {
  const ledger = await server.getLatestLedger();
  return ledger.sequence;
}
```

### `backend/src/store.js`

```javascript
// Simple in-memory circular event log. No database required.
const MAX_EVENTS = 500;
const events = [];

export function addEvent(event) {
  events.unshift({ ...event, timestamp: Date.now() });
  if (events.length > MAX_EVENTS) events.pop();
}

export function getEvents(limit = 50) {
  return events.slice(0, limit);
}

export function getStats() {
  return {
    vaults_released: events.filter(e => e.type === 'vault_released').length,
    stream_ticks: events.filter(e => e.type === 'stream_tick').length,
    dca_swaps: events.filter(e => e.type === 'dca_swap').length,
    total_events: events.length,
  };
}
```

### `backend/src/routes/schedules.js`

```javascript
import { Router } from 'express';
import { readContract } from '../stellar.js';
import * as StellarSdk from '@stellar/stellar-sdk';

const router = Router();
const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID;

// GET /api/schedules/:address — get all vaults owned by address
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const ids = await readContract(
      VAULT_CONTRACT_ID,
      'get_vaults_by_owner',
      [new StellarSdk.Address(address).toScVal()]
    );

    if (!ids || ids.length === 0) {
      return res.json({ vaults: [] });
    }

    const vaults = await Promise.all(
      ids.map(id =>
        readContract(
          VAULT_CONTRACT_ID,
          'get_vault',
          [StellarSdk.nativeToScVal(id, { type: 'u64' })]
        )
      )
    );

    res.json({ vaults: vaults.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schedules/vault/:id — get single vault
router.get('/vault/:id', async (req, res) => {
  try {
    const vault = await readContract(
      VAULT_CONTRACT_ID,
      'get_vault',
      [StellarSdk.nativeToScVal(BigInt(req.params.id), { type: 'u64' })]
    );
    if (!vault) return res.status(404).json({ error: 'not found' });
    res.json({ vault });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

The routes for `streams.js`, `dca.js`, `events.js`, and `stats.js` follow the exact same pattern — swap contract IDs and method names accordingly.

### `backend/render.yaml`

```yaml
services:
  - type: web
    name: chronostar-backend
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: VAULT_CONTRACT_ID
        sync: false
      - key: STREAM_CONTRACT_ID
        sync: false
      - key: DCA_CONTRACT_ID
        sync: false
      - key: STELLAR_RPC_URL
        value: https://soroban-testnet.stellar.org
      - key: STELLAR_NETWORK_PASSPHRASE
        value: Test SDF Network ; September 2015
      - key: PORT
        value: "3001"
```

### `backend/.env.example`

```
VAULT_CONTRACT_ID=C...
STREAM_CONTRACT_ID=C...
DCA_CONTRACT_ID=C...
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
PORT=3001
```

---

## 9. Frontend (Next.js 14)

### Tech Stack
- Next.js 14 App Router with TypeScript strict mode
- Tailwind CSS for styling
- `@stellar/freighter-api` for wallet connection
- `@stellar/stellar-sdk` for contract invocations
- No Redux — React state + context only

### Color Palette & Design Language

ChronoStar's visual identity is **dark, space-time inspired**:

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#0a0b0f` | Page background |
| `--bg-card` | `#111318` | Cards, panels |
| `--bg-elevated` | `#1a1d25` | Hover states, inputs |
| `--accent-blue` | `#4f8ef7` | Primary CTA, links |
| `--accent-green` | `#22c55e` | Active/success states |
| `--accent-orange` | `#f97316` | Warnings, DCA accent |
| `--accent-purple` | `#a855f7` | Stream accent |
| `--text-primary` | `#f1f5f9` | Body text |
| `--text-muted` | `#64748b` | Secondary labels |
| `--border` | `#1e2330` | Card borders |

Fonts: `Space Grotesk` (headings) + `Inter` (body) — both from Google Fonts.

### `frontend/src/lib/freighter.ts`

```typescript
import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from '@stellar/freighter-api';

export async function connectWallet(): Promise<string> {
  const connected = await isConnected();
  if (!connected.isConnected) {
    await requestAccess();
  }
  const addressResult = await getAddress();
  if (addressResult.error) throw new Error(addressResult.error);
  return addressResult.address;
}

export async function getWalletAddress(): Promise<string | null> {
  try {
    const connected = await isConnected();
    if (!connected.isConnected) return null;
    const addressResult = await getAddress();
    if (addressResult.error) return null;
    return addressResult.address;
  } catch {
    return null;
  }
}

export async function signTx(xdr: string, networkPassphrase: string): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });
  if (result.error) throw new Error(result.error);
  return result.signedTxXdr;
}
```

### `frontend/src/lib/contracts.ts`

```typescript
import * as StellarSdk from '@stellar/stellar-sdk';
import { signTx } from './freighter';

const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  'Test SDF Network ; September 2015';

export const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID!;
export const STREAM_CONTRACT_ID = process.env.NEXT_PUBLIC_STREAM_CONTRACT_ID!;
export const DCA_CONTRACT_ID = process.env.NEXT_PUBLIC_DCA_CONTRACT_ID!;

const server = new StellarSdk.SorobanRpc.Server(STELLAR_RPC_URL);

// Build, simulate, sign (via Freighter), and submit a contract call
export async function invokeContract(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
  signerAddress: string
): Promise<string> {
  const account = await server.getAccount(signerAddress);
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  const signedXdr = await signTx(preparedTx.toXDR(), NETWORK_PASSPHRASE);

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  );
  const result = await server.sendTransaction(signedTx);

  if (result.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  return result.hash;
}

// Read-only contract simulation
export async function readContract(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[] = []
): Promise<unknown> {
  const dummyKeypair = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(dummyKeypair.publicKey(), '0');
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error: ${result.error}`);
  }

  return StellarSdk.scValToNative((result as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse).result!.retval);
}

// Helper: convert ledger offset to wall-clock estimate
export function ledgerToDate(currentLedger: number, targetLedger: number): Date {
  const LEDGER_CLOSE_SECONDS = 5;
  const secondsDiff = (targetLedger - currentLedger) * LEDGER_CLOSE_SECONDS;
  return new Date(Date.now() + secondsDiff * 1000);
}

// Helper: convert days to ledger count
export function daysToLedgers(days: number): number {
  return days * 17280;
}
```

### Page Specifications

#### `/` — Landing Page

A full-screen hero section with:
- Logo + "ChronoStar" wordmark in Space Grotesk
- Tagline: **"Scheduled & Recurring Payments on Stellar"**
- Three feature cards (ScheduleVault · RecurringStream · DCAPolicy) with icons and one-line descriptions
- Live stats bar showing: total vaults created, total streams active, total DCA swaps executed — fetched from the backend `/api/stats` endpoint on load
- A "Launch App" button → `/dashboard` and a "View Docs" button → docs site
- A minimal footer with GitHub link, docs link, and Stellar Explorer links for deployed contracts
- Dark background with subtle animated gradient (CSS only, no heavy animation libraries)

#### `/dashboard`

- Connects Freighter wallet via `ConnectButton` component
- Once connected, shows three tabbed sections: **Vaults** · **Streams** · **DCA**
- Each tab lists the user's schedules fetched from the backend
- Empty state with CTA to create one if none exist
- Each card shows: label, status badge (Active/Released/Cancelled), amount, recipient/owner, time remaining or completion date
- "Create New" button per tab routes to the appropriate creation page

#### `/vault/new`

Form fields:
- **Recipient address** (Stellar address, validated)
- **Token** (dropdown: XLM · USDC — USDC is the Stellar testnet USDC contract address)
- **Amount** (number input, min 1)
- **Release date** (date picker — converted to ledger offset on submit using `daysToLedgers`)
- **Label** (text, max 64 chars)
- Preview panel showing: "Funds release in ~X days (ledger XXXXXX)"
- Submit button calls `invokeContract` → `create_vault` → shows TX toast with Explorer link

#### `/stream/new`

Form fields:
- **Recipient address**
- **Token**
- **Total amount**
- **Duration** (select: 1 Day · 1 Week · 1 Month · 3 Months · Custom)
- **Label**
- Preview: shows per-ledger drip rate and completion date
- Submit calls `create_stream`

#### `/dca/new`

Form fields:
- **Token In** (USDC only for now)
- **Swap Receiver** (the address that receives USDC — defaults to a demo swap simulator address)
- **Total Budget** (USDC amount)
- **Amount Per Swap** (must divide evenly into Total Budget)
- **Interval** (select: Every Hour · Every Day · Every Week · Custom ledgers)
- **Label**
- Preview: "Will execute X swaps of Y USDC every Z"
- Submit calls `create_dca`

#### `/vault/:id` · `/stream/:id` · `/dca/:id`

Detail pages showing:
- Full schedule info from the contract
- Visual progress bar (for streams: % streamed; for DCA: % of budget used)
- Transaction history (from backend events log)
- For streams: a "Claim" button (recipient only) that calls `claim()`
- Cancel button (owner only)
- Link to Stellar Explorer for the contract

#### `/explorer`

Public page. Shows all active schedules across all three contract types:
- Paginated table with columns: Type · Label · Owner (truncated) · Amount · Status · Time Remaining
- Filter by type and status
- No auth required

### `frontend/src/components/shared/LedgerClock.tsx`

A small live display of the current Stellar ledger number. Polls the backend or Soroban RPC every 10 seconds and updates the displayed number. Used in the dashboard header to give users a sense of on-chain time.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { readContract, VAULT_CONTRACT_ID } from '@/lib/contracts';

export function LedgerClock() {
  const [ledger, setLedger] = useState<number | null>(null);

  useEffect(() => {
    const update = async () => {
      try {
        const l = await readContract(VAULT_CONTRACT_ID, 'current_ledger');
        setLedger(Number(l));
      } catch {}
    };
    update();
    const interval = setInterval(update, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-xs font-mono text-muted-foreground">
      Ledger {ledger?.toLocaleString() ?? '—'}
    </span>
  );
}
```

### `frontend/.env.local.example`

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=C...
NEXT_PUBLIC_STREAM_CONTRACT_ID=C...
NEXT_PUBLIC_DCA_CONTRACT_ID=C...
NEXT_PUBLIC_BACKEND_URL=https://chronostar-backend.onrender.com
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_STELLAR_EXPLORER=https://stellar.expert/explorer/testnet
NEXT_PUBLIC_USDC_CONTRACT_ID=C...   # Stellar testnet USDC contract address
```

### `frontend/vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs"
}
```

---

## 10. Documentation Site (Astro Starlight)

### Setup

```bash
npm create astro@latest -- --template starlight
cd chronostar-docs
npm install
```

### `astro.config.mjs`

```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'ChronoStar',
      description: 'Scheduled & Recurring Payments on Stellar',
      logo: {
        src: './src/assets/chronostar-logo.svg',
      },
      customCss: ['./src/styles/custom.css'],
      social: {
        github: 'https://github.com/Stellar-Ecosystem/chronostar',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'getting-started/overview' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
          ],
        },
        {
          label: 'Contracts',
          items: [
            { label: 'ScheduleVault', slug: 'contracts/schedule-vault' },
            { label: 'RecurringStream', slug: 'contracts/recurring-stream' },
            { label: 'DCAPolicy', slug: 'contracts/dca-policy' },
          ],
        },
        {
          label: 'Keeper Bot',
          items: [
            { label: 'Overview', slug: 'keeper/overview' },
            { label: 'Self-Hosting', slug: 'keeper/self-hosting' },
          ],
        },
        {
          label: 'Frontend',
          items: [
            { label: 'Using the Dashboard', slug: 'frontend/using-the-dashboard' },
          ],
        },
        {
          label: 'REST API',
          items: [
            { label: 'API Reference', slug: 'api/rest-api' },
          ],
        },
        {
          label: 'Integration',
          items: [
            { label: 'Lodestar Integration', slug: 'integration/lodestar' },
            { label: 'AI Agents', slug: 'integration/agents' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Contract Addresses', slug: 'reference/contract-addresses' },
            { label: 'Error Codes', slug: 'reference/error-codes' },
          ],
        },
      ],
    }),
  ],
  site: 'https://stellar-ecosystem.github.io',
  base: '/chronostar-docs',
});
```

### GitHub Actions — `.github/workflows/deploy-docs.yml`

```yaml
name: Deploy Docs to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

### Content Pages

#### `src/content/docs/index.mdx`

```mdx
---
title: ChronoStar Documentation
description: Scheduled & Recurring Payments on Stellar
template: splash
hero:
  tagline: Time-based payment primitives for the Stellar ecosystem.
  actions:
    - text: Get Started
      link: /chronostar-docs/getting-started/overview/
      icon: right-arrow
      variant: primary
    - text: View on GitHub
      link: https://github.com/Stellar-Ecosystem/chronostar
      icon: external
---

import { Card, CardGrid } from '@astrojs/starlight/components';

## What is ChronoStar?

ChronoStar brings scheduled and recurring payment primitives to Stellar's Soroban smart contract platform.
Three contracts — **ScheduleVault**, **RecurringStream**, and **DCAPolicy** — cover the most common time-based payment patterns.

<CardGrid>
  <Card title="ScheduleVault" icon="seti:clock">
    Lock tokens and release them to a recipient at a future ledger. Perfect for vesting, escrow, and deferred payroll.
  </Card>
  <Card title="RecurringStream" icon="seti:video">
    Stream tokens to a recipient continuously over a period. Recipients claim accrued tokens at any time.
  </Card>
  <Card title="DCAPolicy" icon="seti:chart">
    Automate Dollar-Cost Averaging. Commit a USDC budget and let ChronoStar execute fixed-size swaps on a schedule.
  </Card>
  <Card title="Keeper Bot" icon="seti:robot">
    An always-on Node.js service that monitors schedules and triggers on-chain execution when conditions are met.
  </Card>
</CardGrid>
```

#### `src/content/docs/getting-started/overview.mdx`

Full prose explaining: what problem ChronoStar solves, how it compares to Sablier/Superfluid on EVM, the keeper model, and the overall architecture diagram in ASCII (copy from Section 3 above).

#### `src/content/docs/contracts/schedule-vault.mdx`

Full contract reference page:
- Purpose paragraph
- Function table with signatures, parameters, return types, error conditions
- Code examples showing how to call each function via Stellar CLI and via the JavaScript SDK
- Notes on TTL extension and storage model

Repeat the same structure for `recurring-stream.mdx` and `dca-policy.mdx`.

#### `src/content/docs/keeper/self-hosting.mdx`

```mdx
---
title: Self-Hosting the Keeper Bot
---

The official keeper is deployed on Render, but anyone can run their own keeper pointed at the same contracts.
This allows the keeper network to be decentralized — if the official keeper is down, community keepers continue
triggering executions.

## Prerequisites

- Node.js v22+
- A funded Stellar testnet account for gas fees (XLM)

## Steps

1. Clone the repo: `git clone https://github.com/Stellar-Ecosystem/chronostar`
2. `cd keeper && cp .env.example .env`
3. Fill in `KEEPER_SECRET` with your Stellar secret key
4. Fill in all three contract IDs (see [Contract Addresses](/reference/contract-addresses/))
5. `npm install && npm start`

The keeper will start polling every 30 seconds (configurable via `POLL_INTERVAL_MS`).

## Security Notes

- The keeper wallet only needs to pay XLM gas fees (~0.00001 XLM per transaction)
- The keeper cannot withdraw any locked funds — only trigger pre-authorized releases
- Keep `KEEPER_SECRET` private — rotate it by starting a new funded keypair
```

#### `src/content/docs/api/rest-api.mdx`

Full REST API reference with every endpoint, example request, and example response JSON.

#### `src/content/docs/integration/lodestar.mdx`

```mdx
---
title: Lodestar Integration
---

ChronoStar and [Lodestar](https://github.com/Stellar-Ecosystem/lodestar) are designed to work together.
Lodestar handles service discovery and agent credit scoring. ChronoStar handles recurring payments.

## Use Case: Agent Subscription Auto-Pay

An AI agent registered in Lodestar wants to subscribe to a recurring weather data service.
Instead of paying each API call individually, the agent creates a ChronoStar `RecurringStream`
that drips USDC to the service provider's wallet over 30 days.

```javascript
// Agent creates a 30-day USDC stream to the weather service provider
const streamId = await invokeContract(
  STREAM_CONTRACT_ID,
  'create_stream',
  [
    agentAddress,
    serviceProviderAddress,
    USDC_CONTRACT_ID,
    30_000_000n, // 30 USDC (7 decimals)
    524160,      // ~30 days in ledgers
    'Weather API subscription'
  ],
  agentAddress
);
```

The service provider watches their incoming streams and validates subscription status before serving data.
```

---

## 11. Deployment Guide

### Step 1: Deploy Contracts

```bash
# Install Stellar CLI
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh

# Add wasm target
rustup target add wasm32-unknown-unknown

# Generate and fund a deployer keypair
stellar keys generate deployer --network testnet --fund

# Build all contracts
cd contract
stellar contract build

# Deploy ScheduleVault
stellar contract deploy \
  --wasm schedule-vault/target/wasm32-unknown-unknown/release/schedule_vault.wasm \
  --source deployer \
  --network testnet
# → Copy printed contract ID → VAULT_CONTRACT_ID

# Deploy RecurringStream
stellar contract deploy \
  --wasm recurring-stream/target/wasm32-unknown-unknown/release/recurring_stream.wasm \
  --source deployer \
  --network testnet
# → Copy printed contract ID → STREAM_CONTRACT_ID

# Deploy DCAPolicy
stellar contract deploy \
  --wasm dca-policy/target/wasm32-unknown-unknown/release/dca_policy.wasm \
  --source deployer \
  --network testnet
# → Copy printed contract ID → DCA_CONTRACT_ID
```

### Step 2: Fund Keeper Wallet and Seed Demo Data

```bash
# Generate keeper keypair
stellar keys generate keeper --network testnet --fund
stellar keys show keeper  # copy secret key → KEEPER_SECRET

# Run seed script (creates 1 demo vault, 1 demo stream, 1 demo DCA)
cd scripts
node seed.js
```

`scripts/seed.js`:
```javascript
import * as StellarSdk from '@stellar/stellar-sdk';

const server = new StellarSdk.SorobanRpc.Server('https://soroban-testnet.stellar.org');
const networkPassphrase = 'Test SDF Network ; September 2015';
const seedKeypair = StellarSdk.Keypair.fromSecret(process.env.DEPLOYER_SECRET);

// Creates 3 demo schedules:
// 1. A vault releasing in 1 day (17280 ledgers)
// 2. A stream over 7 days to a test recipient
// 3. A DCA policy executing daily with 5 USDC budget

// Full implementation: load contract IDs from env, build+sign+submit
// transactions for each contract's create function.
// Log each created ID.
```

### Step 3: Deploy Keeper on Render

1. Push `chronostar/keeper/` to GitHub
2. Create a new Render **Background Worker** service
3. Connect the `Stellar-Ecosystem/chronostar` repo, root directory `keeper`
4. Add all env vars from `render.yaml`
5. Deploy — the keeper will start polling immediately

### Step 4: Deploy Backend on Render

1. Create a new Render **Web Service**
2. Connect same repo, root directory `backend`
3. Add env vars (contract IDs, RPC URL)
4. Note the Render URL → `NEXT_PUBLIC_BACKEND_URL`

### Step 5: Deploy Frontend on Vercel

```bash
cd frontend
npx vercel --prod
```

Set all `NEXT_PUBLIC_*` env vars in the Vercel project settings.

### Step 6: Deploy Docs on GitHub Pages

1. Push `chronostar-docs/` to `Stellar-Ecosystem/chronostar-docs`
2. In repo Settings → Pages → Source: **GitHub Actions**
3. The `deploy-docs.yml` workflow triggers on every push to main
4. Docs go live at `https://stellar-ecosystem.github.io/chronostar-docs`

---

## 12. Environment Variables

### Complete `.env` Reference

| Variable | Used By | Description |
|---|---|---|
| `KEEPER_SECRET` | keeper | Stellar secret key for keeper wallet |
| `VAULT_CONTRACT_ID` | keeper, backend, frontend | Deployed ScheduleVault contract C... address |
| `STREAM_CONTRACT_ID` | keeper, backend, frontend | Deployed RecurringStream contract C... address |
| `DCA_CONTRACT_ID` | keeper, backend, frontend | Deployed DCAPolicy contract C... address |
| `STELLAR_RPC_URL` | keeper, backend | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | keeper, backend, frontend | Network passphrase |
| `POLL_INTERVAL_MS` | keeper | How often keeper polls (default 30000) |
| `PORT` | keeper, backend | HTTP port |
| `NEXT_PUBLIC_VAULT_CONTRACT_ID` | frontend | Same as VAULT_CONTRACT_ID (client-side) |
| `NEXT_PUBLIC_STREAM_CONTRACT_ID` | frontend | Same as STREAM_CONTRACT_ID |
| `NEXT_PUBLIC_DCA_CONTRACT_ID` | frontend | Same as DCA_CONTRACT_ID |
| `NEXT_PUBLIC_BACKEND_URL` | frontend | Backend base URL |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | frontend | Soroban RPC (client-side) |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | frontend | Network passphrase (client-side) |
| `NEXT_PUBLIC_STELLAR_EXPLORER` | frontend | `https://stellar.expert/explorer/testnet` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | frontend | Stellar testnet USDC contract address |

---

## 13. Testing Requirements

### Contract Tests (Rust)

Each contract must have a `#[cfg(test)]` module in `src/lib.rs` using `soroban_sdk::testutils`.

Required test cases per contract:

**ScheduleVault:**
- `test_create_vault` — create vault, verify storage
- `test_release_on_time` — advance ledger past release, call release, verify token transfer
- `test_release_too_early` — call release before trigger ledger, expect panic
- `test_cancel_before_release` — cancel vault, verify refund
- `test_cancel_after_release_ledger` — should panic
- `test_get_vaults_by_owner` — create 3 vaults, verify list

**RecurringStream:**
- `test_create_stream` — verify stream storage
- `test_claim_partial` — advance to midpoint, claim, verify partial amount
- `test_claim_full` — advance to end, claim everything
- `test_claim_nothing` — claim at start, expect panic
- `test_cancel_returns_remainder` — cancel midstream, verify both parties receive correct amounts
- `test_tick_marks_completed` — advance past end, tick, verify status

**DCAPolicy:**
- `test_create_dca` — verify DCA storage
- `test_execute_swap` — advance ledger, execute, verify receiver got USDC
- `test_execute_too_early` — expect panic
- `test_execute_exhausts_budget` — run all swaps, verify Exhausted status
- `test_cancel_returns_remaining` — cancel with remaining budget, verify refund

### Keeper Tests (Node.js)

Use `node:test` built-in test runner (Node v22).

- `test_vault_watcher_triggers` — mock `readContract` and `invokeContract`, verify vault watcher calls `release` for a due vault
- `test_vault_watcher_skips_early` — verify non-due vaults are skipped
- `test_stream_watcher_ticks` — verify tick is called for active streams
- `test_dca_watcher_executes` — verify execute_swap called when due

### Frontend Tests

Use Playwright for E2E tests (optional but recommended for OnlyDust):

- `test_landing_loads` — page renders, stats bar visible
- `test_connect_wallet_flow` — mock Freighter, verify address displays
- `test_create_vault_form_validates` — test form validation before submit

---

## 14. Lodestar Integration

ChronoStar is designed as a sibling project within the `Stellar-Ecosystem` org. The integration points are:

### Shared Org Patterns

ChronoStar follows the exact same structural conventions as Lodestar:
- `contract/` · `backend/` · `frontend/` top-level dirs
- Same `render.yaml` deployment pattern
- Same Soroban SDK version (22.0.0)
- Same `@stellar/stellar-sdk` version
- Same `.env.example` conventions
- Same `FUNDING.json` for OnlyDust bounties

### Agent Auto-Pay Pattern

AI agents registered in Lodestar that wish to subscribe to recurring services should:

1. Call `RecurringStream.create_stream()` with the service provider's address as recipient
2. Store the `stream_id` in the agent's local state
3. Before each service call, check the stream's `remaining_budget` — if low, top up or create a new stream
4. Service providers can optionally verify subscription by calling `RecurringStream.get_stream(stream_id)` and checking `status == Active` and `remaining_budget > 0`

This pattern is documented in `chronostar-docs/src/content/docs/integration/lodestar.mdx`.

---

## 15. OnlyDust Issue Breakdown

Create these issues in the `Stellar-Ecosystem/chronostar` GitHub repo before submitting to OnlyDust.

### Contract Issues (Rust/Soroban)
1. `[Contract] Implement ScheduleVault — create_vault, release, cancel, get_vault`
2. `[Contract] Add unit tests for ScheduleVault (all 6 test cases)`
3. `[Contract] Implement RecurringStream — create_stream, claim, tick, cancel`
4. `[Contract] Add unit tests for RecurringStream (all 6 test cases)`
5. `[Contract] Implement DCAPolicy — create_dca, execute_swap, cancel`
6. `[Contract] Add unit tests for DCAPolicy (all 5 test cases)`
7. `[Contract] Write DEPLOY.md with step-by-step testnet deployment instructions`

### Keeper Issues (Node.js)
8. `[Keeper] Implement VaultWatcher — poll, detect due vaults, call release()`
9. `[Keeper] Implement StreamWatcher — poll active streams, call tick()`
10. `[Keeper] Implement DCAWatcher — poll DCA policies, call execute_swap()`
11. `[Keeper] Add exponential backoff retry logic to invokeContract()`
12. `[Keeper] Add /healthz and /metrics HTTP endpoints`
13. `[Keeper] Write keeper unit tests using node:test`

### Backend Issues (Node.js)
14. `[Backend] Implement GET /api/schedules/:address route`
15. `[Backend] Implement GET /api/streams/:address and GET /api/dca/:address routes`
16. `[Backend] Implement GET /api/events and GET /api/stats routes`
17. `[Backend] Add CORS, pino logging, and input validation middleware`

### Frontend Issues (Next.js)
18. `[Frontend] Build landing page with hero, feature cards, and live stats`
19. `[Frontend] Build ConnectButton component with Freighter integration`
20. `[Frontend] Build /dashboard with tabbed Vault/Stream/DCA lists`
21. `[Frontend] Build /vault/new form with CreateVaultForm component`
22. `[Frontend] Build /stream/new form with CreateStreamForm component`
23. `[Frontend] Build /dca/new form with CreateDCAForm component`
24. `[Frontend] Build /vault/:id detail page with progress and cancel`
25. `[Frontend] Build /stream/:id detail page with claim button`
26. `[Frontend] Build /dca/:id detail page with execution history`
27. `[Frontend] Build /explorer public page with all active schedules`
28. `[Frontend] Implement LedgerClock component`
29. `[Frontend] Add TxToast component for transaction feedback`

### Docs Issues (Astro Starlight)
30. `[Docs] Bootstrap Astro Starlight site with sidebar and custom theme`
31. `[Docs] Write Getting Started: Overview and Quickstart pages`
32. `[Docs] Write contract reference pages for all 3 contracts`
33. `[Docs] Write Keeper self-hosting guide`
34. `[Docs] Write REST API reference`
35. `[Docs] Write Lodestar integration guide`
36. `[Docs] Set up GitHub Actions deploy to GitHub Pages`
37. `[Docs] Add architecture diagram image to docs`

---

## 16. Design 
& Style Guide

### Typography

```css
/* globals.css */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');

:root {
  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;

  --bg-primary: #0a0b0f;
  --bg-card: #111318;
  --bg-elevated: #1a1d25;

  --accent-blue: #4f8ef7;
  --accent-green: #22c55e;
  --accent-orange: #f97316;
  --accent-purple: #a855f7;
  --accent-red: #ef4444;

  --text-primary: #f1f5f9;
  --text-muted: #64748b;

  --border: #1e2330;
  --border-accent: #2a3045;

  --radius: 8px;
  --radius-lg: 12px;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
}

h1, h2, h3, h4, h5 {
  font-family: var(--font-heading);
}
```

### `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0b0f',
          card: '#111318',
          elevated: '#1a1d25',
        },
        accent: {
          blue: '#4f8ef7',
          green: '#22c55e',
          orange: '#f97316',
          purple: '#a855f7',
          red: '#ef4444',
        },
        border: {
          DEFAULT: '#1e2330',
          accent: '#2a3045',
        },
        text: {
          primary: '#f1f5f9',
          muted: '#64748b',
        },
      },
      fontFamily: {
        heading: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
```

### Component Conventions

- All client components use `'use client'` directive
- All server components are `async` and fetch data directly
- No default exports for components — named exports only
- Props interfaces defined inline with `interface`
- No `any` types — use `unknown` and narrow
- Status badges: Active → green, Released/Completed → blue, Cancelled → red, Exhausted → orange
- Card component pattern: `bg-bg-card border border-border rounded-lg p-5`

---

## 17. README Files

### `chronostar/README.md`

```markdown
# ChronoStar

### Time-based payment primitives for the Stellar ecosystem.

ChronoStar brings scheduled and recurring payment contracts to Stellar's Soroban platform:

- **ScheduleVault** — Lock funds, release them at a future ledger (vesting, escrow, deferred payroll)
- **RecurringStream** — Stream tokens continuously, let recipients claim accrued amounts at any time
- **DCAPolicy** — Commit a USDC budget and auto-execute fixed-size swaps on a recurring schedule

A **Keeper Bot** monitors all active schedules and triggers on-chain execution when time conditions are met.

---

## Live Deployments

| | |
|---|---|
| **Frontend** | https://chronostar.vercel.app |
| **Backend API** | https://chronostar-backend.onrender.com |
| **ScheduleVault Contract** | `C...` |
| **RecurringStream Contract** | `C...` |
| **DCAPolicy Contract** | `C...` |
| **Docs** | https://stellar-ecosystem.github.io/chronostar-docs |

---

## Tech Stack

- **Smart Contracts**: Rust + soroban-sdk 22 on Stellar Testnet
- **Keeper Bot**: Node.js v22 (ES modules)
- **Backend**: Node.js v22 + Express
- **Frontend**: Next.js 14 App Router + TypeScript + Tailwind CSS
- **Wallet**: Freighter (@stellar/freighter-api)
- **Docs**: Astro Starlight → GitHub Pages

---

## Quick Start

See [contract/DEPLOY.md](./contract/DEPLOY.md) for contract deployment.

```bash
# Keeper
cd keeper && cp .env.example .env
npm install && npm start

# Backend
cd backend && cp .env.example .env
npm install && npm start

# Frontend
cd frontend && cp .env.local.example .env.local
npm install && npm run dev
```

---

## Part of the Stellar Ecosystem Org

ChronoStar is built alongside [Lodestar](https://github.com/Stellar-Ecosystem/lodestar), the discovery and credit scoring layer for AI agents on Stellar. Together they form the payments infrastructure for the Stellar agent economy.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All open issues are tagged for [OnlyDust](https://app.onlydust.com).

## License

MIT
```

### `chronostar-docs/README.md`

```markdown
# ChronoStar Docs

Documentation site for [ChronoStar](https://github.com/Stellar-Ecosystem/chronostar) — built with Astro Starlight.

**Live**: https://stellar-ecosystem.github.io/chronostar-docs

## Development

```bash
npm install
npm run dev
```

## Deployment

Automatically deploys to GitHub Pages on every push to `main` via GitHub Actions.
```

---

*End of PRD — ChronoStar v1.0.0*