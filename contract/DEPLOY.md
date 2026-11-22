# ChronoStar Contract Deployment

## Prerequisites

- **Rust**: Pinned to `1.84.0` (see `contract/rust-toolchain.toml`) with the `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI**: Installed via cargo:
  ```bash
  cargo install --locked stellar-cli --features opt
  ```

## Reproducible Contract Compilation (#444)

All ChronoStar smart contracts are deterministically compiled using pinned Rust toolchains and standardized release profile optimizations:

- **Optimization Level**: `opt-level = "z"` (optimized for WASM code size)
- **LTO**: Full Link-Time Optimization (`lto = true`)
- **Codegen Units**: Single codegen unit (`codegen-units = 1`) to eliminate multi-threaded nondeterminism
- **Symbol Stripping**: All debug symbols stripped (`strip = "symbols"`, `debug = 0`) to prevent host paths from leaking into bytecode

### Verifying WASM Reproducibility Locally

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release

# Compute SHA-256 checksums of compiled bytecode
sha256sum schedule-vault/target/wasm32-unknown-unknown/release/schedule_vault.wasm
sha256sum recurring-stream/target/wasm32-unknown-unknown/release/recurring_stream.wasm
sha256sum dca-policy/target/wasm32-unknown-unknown/release/dca_policy.wasm
sha256sum keeper-coordinator/target/wasm32-unknown-unknown/release/keeper_coordinator.wasm
```

CI automatically verifies that two fresh, independent builds yield identical SHA-256 hashes for all contract artifacts (`.github/workflows/test-contracts.yml`).

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

## Testnet Reset Recovery

When the SDF periodically resets the Stellar Testnet, all deployed contracts are permanently erased. Follow the [Testnet Reset Recovery Runbook](../docs/src/content/docs/operations/testnet-reset-recovery.md) to redeploy the contracts, update environment variables across backend/keeper/frontend, and purge stale local event store records.
