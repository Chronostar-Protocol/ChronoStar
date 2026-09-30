---
title: ScheduleVault
description: Lock funds and release at a future ledger.
---

## Overview

ScheduleVault lets you lock tokens and release them to a recipient at a specific future ledger. This is useful for:

- **Vesting**: Lock tokens for a team member, release after a cliff
- **Escrow**: Hold funds until a condition is met
- **Deferred payroll**: Pre-fund payroll, release on payday

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

### `transfer_ownership`

```rust
fn transfer_ownership(env: Env, vault_id: u64, new_owner: Address)
```

Transfers control of the vault to `new_owner`. The recipient remains unchanged. The new owner becomes the funder, gaining the ability to cancel the vault and claim the tokens, or transfer ownership again. The old owner loses these rights immediately.

- Requires current owner auth
- Only allowed on `Active` vaults

## Owner vs Recipient

```mermaid
flowchart LR
    Owner[Owner (Funder)] -- "Funds vault\nCan cancel/transfer" --> Vault
    Vault -- "Releases funds" --> Recipient[Recipient (Payee)]
```

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

All 6 tests must pass.
