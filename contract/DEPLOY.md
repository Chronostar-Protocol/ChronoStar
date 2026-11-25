# ChronoStar Contract Deployment

## Prerequisites

- **Rust**: With `wasm32-unknown-unknown` target
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI**: Installed via cargo:
  ```bash
  cargo install --locked stellar-cli --features opt
  ```

## Contract WASM Size Budgets (#438)

To ensure deployability and prevent out-of-gas or deployment rejections on the Stellar network, all contract bytecode artifacts are subject to explicit size budgets:

| Contract | Maximum Size Budget | Description |
| :--- | :--- | :--- |
| `schedule_vault.wasm` | **64 KB** (65,536 B) | Time-locked escrow vault |
| `recurring_stream.wasm` | **64 KB** (65,536 B) | Linear vesting payment streams |
| `dca_policy.wasm` | **64 KB** (65,536 B) | Dollar-cost averaging policy execution |
| `keeper_coordinator.wasm` | **48 KB** (49,152 B) | Decentralized keeper coordination ledger |

### Enforcing Size Budgets

To verify contract sizes locally against configured budgets:
```bash
npm run check:wasm-budget
```
CI automatically builds optimized release artifacts and enforces these budgets on every pull request (`.github/workflows/test-contracts.yml`).

## Build All Contracts

```bash
cd contract
stellar contract build
```

## Deploy to Testnet

### 1. Generate and fund deployer keypair

```bash
stellar keys generate deployer --network testnet --fund
```

### 2. Deploy ScheduleVault

```bash
stellar contract deploy \
  --wasm schedule-vault/target/wasm32-unknown-unknown/release/schedule_vault.wasm \
  --source deployer \
  --network testnet
```
→ Copy printed contract ID → `VAULT_CONTRACT_ID`

### 3. Deploy RecurringStream

```bash
stellar contract deploy \
  --wasm recurring-stream/target/wasm32-unknown-unknown/release/recurring_stream.wasm \
  --source deployer \
  --network testnet
```
→ Copy printed contract ID → `STREAM_CONTRACT_ID`

### 4. Deploy DCAPolicy

```bash
stellar contract deploy \
  --wasm dca-policy/target/wasm32-unknown-unknown/release/dca_policy.wasm \
  --source deployer \
  --network testnet
```
→ Copy printed contract ID → `DCA_CONTRACT_ID`

### 5. Deploy KeeperCoordinator

```bash
stellar contract deploy \
  --wasm keeper-coordinator/target/wasm32-unknown-unknown/release/keeper_coordinator.wasm \
  --source deployer \
  --network testnet
```
→ Copy printed contract ID → `COORDINATOR_CONTRACT_ID`

### 6. Configure DEX routers (Multi-Asset DCA)

The DCAPolicy contract reads Soroswap/Phoenix router addresses from its `Config` key.
After deploying (or upgrading to) the multi-asset build, point `set_config` at the
routers for the target network:

```bash
stellar contract invoke \
  --id $DCA_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- \
  set_config \
  --admin deployer \
  --soroswap_router C... \
  --phoenix_multihop C... \
  --soroswap_aggregator C...
```

- Soroswap Router (mainnet): `CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH`
- Soroswap/testnet router, Phoenix Multihop: query the respective protocol docs per network.

See the [Multi-Asset DCA design document](../docs/src/content/docs/contracts/dca-multi-asset.md)
for contract changes, fee handling, and migration details.

## Fund Keeper Wallet

```bash
stellar keys generate keeper --network testnet --fund
stellar keys show keeper
```
Copy secret key → `KEEPER_SECRET`

## Deployed Contract Addresses (Testnet)

| Contract | Address |
|---|---|
| ScheduleVault | `C...` |
| RecurringStream | `C...` |
| DCAPolicy | `C...` |
| KeeperCoordinator | `C...` |

> **Mainnet**: Replace `--network testnet` with `--network mainnet` and update env vars.
