---
title: DCAPolicy
description: Dollar-cost average into any asset on a recurring schedule.
---

## Overview

DCAPolicy lets you commit a budget and auto-execute fixed-size swaps on a recurring schedule. This is useful for:

- **Dollar-cost averaging**: Buy XLM with USDC every day
- **Recurring payments**: Send a fixed amount to a service each week
- **Treasury management**: Accumulate assets over time

> **Note:** This page documents the current single-asset (USDC → receiver) behavior.
> Support for arbitrary token pairs (e.g. USDC → EURC, XLM → USDC) is covered by the
> [Multi-Asset DCA design document](/contracts/dca-multi-asset/).

## Interface

### `create_dca`

```rust
fn create_dca(
    env: Env,
    owner: Address,
    token_in: Address,
    swap_receiver: Address,
    total_budget: i128,
    amount_per_swap: i128,
    interval_ledgers: u32,
    label: String,
) -> u64
```

Creates a DCA policy. Transfers `total_budget` from owner to the contract.

- `total_budget` must be an exact multiple of `amount_per_swap`
- Minimum interval: 120 ledgers (~10 minutes)

### `execute_swap`

```rust
fn execute_swap(env: Env, dca_id: u64)
```

Executes a single swap. Transfers `amount_per_swap` to `swap_receiver`. Only callable when `current_ledger >= next_execution_ledger`.

Sets status to `Exhausted` when `remaining_budget` reaches zero.

### `cancel`

```rust
fn cancel(env: Env, dca_id: u64)
```

Cancels the DCA policy. Returns remaining budget to the owner.

### `get_dca`

```rust
fn get_dca(env: Env, dca_id: u64) -> Option<DCAEntry>
```

## States

| Status | Meaning |
|---|---|
| `Active` | DCA is running, swaps will execute on schedule |
| `Exhausted` | All swaps executed, budget fully spent |
| `Cancelled` | Cancelled by owner, remaining budget returned |

## Testing

```bash
cd contract
cargo test -p dca-policy
```

All 5 tests must pass.
