---
title: ScheduleVault
description: Lock funds and release at a future ledger.
---

## Overview

ScheduleVault lets you lock tokens and release them to a recipient at a specific future ledger. This is useful for:

- **Vesting**: Lock tokens for a team member, release after a cliff
- **Escrow**: Hold funds until a condition is met
- **Deferred payroll**: Pre-fund payroll, release on payday

---

## Interface

### `create_vault`

```rust
fn create_vault(
    env: Env,
    owner: Address,
    recipient: Address,
    token: Address,
    amount: i128,
    release_ledger: u32,
    label: String,
) -> u64
```

Creates a new vault. Transfers `amount` of `token` from `owner` to the contract. Returns a unique vault ID.

- `owner.require_auth()` — owner must authorize
- `amount` must be positive
- `release_ledger` must be in the future
- `label` max 64 characters

### `create_vaults`

```rust
fn create_vaults(
    env: Env,
    owner: Address,
    recipients: Vec<Address>,
    token: Address,
    amount: i128,
    release_ledger: u32,
    label_prefix: String,
) -> Vec<u64>
```

Creates N vaults for multi-recipient disbursements sharing one release ledger and amount.

### `release`

```rust
fn release(env: Env, vault_id: u64)
```

Releases locked tokens to the recipient. Can be called by anyone (keeper or recipient) once `current_ledger >= release_ledger`.

### `cancel`

```rust
fn cancel(env: Env, vault_id: u64)
```

Cancels the vault and refunds tokens to the owner. Only the owner may call this, and only while the vault is `Active`.

### `get_vault`

```rust
fn get_vault(env: Env, vault_id: u64) -> Option<VaultEntry>
```

### `get_vaults_by_owner`

```rust
fn get_vaults_by_owner(env: Env, owner: Address) -> Vec<u64>
```

---

## States

| Status | Meaning |
|---|---|
| `Active` | Tokens are locked, waiting for release ledger |
| `Released` | Tokens have been transferred to recipient |
| `Cancelled` | Tokens have been returned to owner |

---

## Recipient Readiness & Trustlines

When creating vaults holding issued assets (such as USDC), the recipient address must have established an active trustline and hold sufficient base reserves before `release` executes. If a classic recipient account lacks a trustline for the token, the release transfer will fail on-chain. Refer to the [Token Trustlines & Recipient Readiness Guide](../../getting-started/trustlines-and-funding/) to verify destination accounts before locking funds.

---

## Events

Every event uses two topics: the event name and the vault ID.

- `created` — published by `create_vault`. Data is `VaultCreated { owner, release_ledger }`.
- `released` — published by `release`. Data is the recipient address.
- `cancelled` — published by `cancel`. Data is the owner address.

---

## Testing

```bash
cd contract
cargo test -p schedule-vault
```

All tests must pass, including batch creation coverage for multi-recipient disbursements.
