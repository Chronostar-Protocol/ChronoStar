---
title: Testnet Reset Recovery Runbook
description: Comprehensive operational procedure for recovering ChronoStar deployments after a Stellar testnet reset.
---

The Stellar Development Foundation (SDF) periodically resets the Stellar Testnet (typically on a quarterly schedule or major protocol upgrades). When a reset occurs, **all ledger state, accounts, balances, deployed Soroban smart contracts, and event streams are permanently erased**, and the ledger sequence restarts from ledger 1.

This runbook guides operators and developers through distinguishing a genuine testnet reset from temporary RPC downtime, rebuilding the deployment from scratch, synchronizing all service configurations, and handling legacy event store state.

---

## 1. Distinguishing Testnet Reset from RPC Outage

Before taking destructive recovery actions (such as purging databases or redeploying contracts), diagnose the root cause:

| Symptom / Check | Genuine Testnet Reset | Temporary RPC Outage |
| :--- | :--- | :--- |
| **Current Ledger Sequence** | Restarts near `1` (or `< 10,000`) | High ledger sequence (e.g., `> 1,500,000`) |
| **Existing Accounts / Balances** | `404 Not Found` (account does not exist) | Account found or RPC returns `502/503/504` |
| **Deployed Contract IDs** | `404 Not Found` (WASM / instance missing) | Simulation fails with RPC transport error |
| **Friendbot Funding** | Friendbot responds and creates fresh account | Friendbot may return 500 or timeout |
| **SDF Incident Dashboard** | Announced on [status.stellar.org](https://status.stellar.org) | Incident noted as RPC latency / downtime |

### Quick Diagnostic CLI Commands

```bash
# 1. Query the latest ledger sequence from Soroban RPC
curl -s -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .

# 2. Check if your previous keeper or deployer account exists
curl -s "https://horizon-testnet.stellar.org/accounts/<YOUR_PUBLIC_KEY>" | jq .
```

- **If the account is not found and the ledger is near 1**: A testnet reset has occurred. Proceed with this recovery procedure.
- **If the account exists or RPC returns gateway errors**: Do not redeploy. Treat as transient downtime.

---

## 2. Step-by-Step Rebuild Procedure

### Phase A: Re-funding Keypairs & Identities

Every testnet account must be recreated and re-funded via Friendbot:

```bash
# 1. Fund Deployer / Admin Keypair
curl -s "https://friendbot.stellar.org?addr=<DEPLOYER_PUBLIC_KEY>"

# 2. Fund Keeper Keypair
curl -s "https://friendbot.stellar.org?addr=<KEEPER_PUBLIC_KEY>"

# 3. Fund Test User / Demo Wallets
curl -s "https://friendbot.stellar.org?addr=<USER_PUBLIC_KEY>"
```

Verify initial balances (Friendbot deposits 10,000 test XLM per account):
```bash
stellar keys fund deployer --network testnet
stellar keys fund keeper --network testnet
```

---

### Phase B: Redeploy Smart Contracts

Deploy all four protocol contracts in dependency order using the pinned toolchain:

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release

# 1. ScheduleVault
stellar contract deploy \
  --wasm schedule-vault/target/wasm32-unknown-unknown/release/schedule_vault.wasm \
  --source deployer \
  --network testnet
# Save output as NEW_VAULT_CONTRACT_ID

# 2. RecurringStream
stellar contract deploy \
  --wasm recurring-stream/target/wasm32-unknown-unknown/release/recurring_stream.wasm \
  --source deployer \
  --network testnet
# Save output as NEW_STREAM_CONTRACT_ID

# 3. DCAPolicy
stellar contract deploy \
  --wasm dca-policy/target/wasm32-unknown-unknown/release/dca_policy.wasm \
  --source deployer \
  --network testnet
# Save output as NEW_DCA_CONTRACT_ID

# 4. KeeperCoordinator
stellar contract deploy \
  --wasm keeper-coordinator/target/wasm32-unknown-unknown/release/keeper_coordinator.wasm \
  --source deployer \
  --network testnet
# Save output as NEW_COORDINATOR_CONTRACT_ID
```

Configure DEX test routers on DCAPolicy:
```bash
stellar contract invoke \
  --id $NEW_DCA_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- \
  set_config \
  --admin deployer \
  --soroswap_router <SOROSWAP_TESTNET_ROUTER> \
  --phoenix_multihop <PHOENIX_TESTNET_ROUTER> \
  --soroswap_aggregator <SOROSWAP_TESTNET_ROUTER>
```

---

### Phase C: Recreate Token Allowances

For automated streams, DCA swaps, and scheduled releases, approval allowances must be re-authorized:

```bash
# Approve ScheduleVault to transfer tokens on schedule execution
stellar contract invoke \
  --id $TESTNET_USDC_CONTRACT_ID \
  --source test_user \
  --network testnet \
  -- \
  approve \
  --from test_user \
  --spender $NEW_VAULT_CONTRACT_ID \
  --amount 1000000000000 \
  --expiration_ledger 100000
```

---

### Phase D: Synchronize Service Configuration

Update contract IDs simultaneously across all system components:

#### 1. Backend (`backend/.env`)
```ini
PORT=3001
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
VAULT_CONTRACT_ID=<NEW_VAULT_CONTRACT_ID>
STREAM_CONTRACT_ID=<NEW_STREAM_CONTRACT_ID>
DCA_CONTRACT_ID=<NEW_DCA_CONTRACT_ID>
COORDINATOR_CONTRACT_ID=<NEW_COORDINATOR_CONTRACT_ID>
```

#### 2. Keeper (`keeper/.env`)
```ini
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
KEEPER_SECRET=<KEEPER_SECRET_KEY>
VAULT_CONTRACT_ID=<NEW_VAULT_CONTRACT_ID>
STREAM_CONTRACT_ID=<NEW_STREAM_CONTRACT_ID>
DCA_CONTRACT_ID=<NEW_DCA_CONTRACT_ID>
COORDINATOR_CONTRACT_ID=<NEW_COORDINATOR_CONTRACT_ID>
POLL_INTERVAL_MS=30000
```

#### 3. Frontend (`frontend/.env.local`)
```ini
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_VAULT_CONTRACT_ID=<NEW_VAULT_CONTRACT_ID>
NEXT_PUBLIC_STREAM_CONTRACT_ID=<NEW_STREAM_CONTRACT_ID>
NEXT_PUBLIC_DCA_CONTRACT_ID=<NEW_DCA_CONTRACT_ID>
```

---

## 3. Data & State Purge Policy

Because on-chain ledger history was wiped, existing off-chain databases and journals reference non-existent transactions and invalidated contract IDs.

### Explicit State Policy:

1. **Old Schedule IDs & Stream IDs**:
   - Deemed **permanently dead**. IDs generated on previous testnets cannot be resumed.
   - Applications must reject or archive records marked prior to the reset epoch timestamp.
2. **Backend Event Store / SQLite / PostgreSQL**:
   - Truncate all event store tables:
     ```sql
     TRUNCATE TABLE schedules, streams, dca_orders, processed_events;
     ```
   - Reset the starting ingest ledger cursor to the current latest ledger (`ledger sequence = 1` or latest).
3. **Keeper Execution Journal & Fee Budget**:
   - Delete stale transaction journal: `rm keeper/.keeper-journal.json`.
   - Delete stale fee budget tracking state: `rm keeper/.keeper-fee-budget.json`.
   - This prevents the keeper from endlessly querying non-existent transactions during startup reconciliation.

---

## 4. End-to-End Verification Checklist

Before opening the deployment for development or user traffic, verify each checkpoint:

- [ ] **Friendbot Funding**: All operational wallets (deployer, keeper, test accounts) hold positive XLM balances.
- [ ] **Contract Deployment**: Calling `readContract` on `schedule-vault`, `recurring-stream`, `dca-policy`, and `keeper-coordinator` returns valid Soroban response.
- [ ] **Keeper Coordinator Registration**: Keeper successfully registers itself on the new coordinator contract on startup.
- [ ] **Keeper Health**: `GET http://localhost:8080/healthz` returns `status: "ok"` with an advancing `observedLedger` and unexhausted `feeBudget`.
- [ ] **Backend API Health**: `GET http://localhost:3001/health` returns `200 OK` and reads state without 404 contract errors.
- [ ] **Frontend Sanity**:
  - Connect Freighter wallet (switched to Stellar Testnet).
  - Create a new ScheduleVault payment for 10 XLM scheduled 1 minute ahead.
  - Observe Keeper release transaction submit, settle, and update UI status to `EXECUTED`.
