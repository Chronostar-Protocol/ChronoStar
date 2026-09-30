---
title: ScheduleVault
description: Lock funds and release at a future ledger.
---

## Overview

ScheduleVault lets you lock tokens and release them to a recipient at a specific future ledger. This is useful for:

- -- **Vesting**: Lock tokens for a team member, release after a cliff
- -- **Escrow**: Hold funds until a condition is met
- - **Deferred payroll**: Pre-fund payroll, release on payday

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

Creates one vault per recipient in a single transaction. Every vault shares the same `token`, `amount`, and `release_ledger`, so the keeper needs a single due-check pass over the returned vault IDs. Returns the new vault IDs in the same order as `recipients`.

- `owner.require_auth()` — owner must authorize
- `recipients.len()` must be between 1 and `MAX_BATCH_SIZE`
- `amount` must be positive
- `release_ledger` must be in the future
- each label is formed from `label_prefix` plus the recipient index, max 64 characters

### `MAX_BATCH_SIZE`

```rust
const MAX_BATCH_SIZE: u32 = 32;
```

Caps the number of recipients a single `create_vaults` call may create, protecting the resource budget of the transaction.

### `release`

```rust
fn release(env: Env, vault_id: u64)
```

Releases the locked tokens to the recipient. Only callable when `current_ledger >= release_ledger` and vault is Active.

### `cancel`

```rust
fn cancel(env: Env, vault_id: u64)
```

Cancels the vault and returns tokens to the owner. Only callable before `release_ledger`. Requires owner auth.

### `get_vault`

```rust
fn get_vault(env: Env, vault_id: u64) -> Option<VaultEntry>
```

### `get_vaults_by_owner`

```rust
fn get_vaults_by_owner(env: Env, owner: Address) -> Vec<u64>
```

## States

| Status | Meaning |
|---|---|
| `Active` | Tokens are locked, waiting for release ledger |
| `Released` | Tokens have been transferred to recipient |
| `Cancelled` | Tokens have been returned to owner |

## Testing

```bash
cd contract
cargo test -p schedule-vault
```

All tests must pass, including the batch creation coverage for a 3-recipient batch, an empty batch, and a batch over `MAX_BATCH_SIZE`.

## Footprint notes

`create_vaults` writes one vault entry plus one owner-index entry per recipient, so a batch of `N` costs `O(N`) entries and a corresponding increase in transaction resource usage. bMAX_BATCH_SIZE` bounds the worst-case entry count so the call remains within the resource budget; callers needing larger disbursements split them into multiple batches.
