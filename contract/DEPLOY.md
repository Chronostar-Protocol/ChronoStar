# ChronoStar Contract Deployment

## Prerequisites

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

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

### 5. Configure DEX routers (Multi-Asset DCA)

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

> **Mainnet**: Replace `--network testnet` with `--network mainnet` and update env vars.
