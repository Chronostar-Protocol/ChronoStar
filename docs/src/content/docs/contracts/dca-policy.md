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

### `get_execution_history`

```rust
fn get_execution_history(env: Env, dca_id: u64, start: u32, limit: u32) -> Vec<ExecutionRecord>
```

Returns recorded executions for a policy, oldest first. `start` is a 1-based index into
the execution sequence, and `limit` is clamped to 50 records per call.

Each successful `execute_swap` writes one record:

```rust
struct ExecutionRecord {
    index: u32,                  // 1-based, matches executions_completed at write time
    dca_id: u64,
    ledger: u32,                 // ledger the swap executed on
    amount_in: i128,
    amount_out: i128,
    remaining_budget: i128,      // budget left after this swap
    next_execution_ledger: u32,
    swapped: bool,               // true when a router swap ran, false for a plain transfer
}
```

Records persist across `cancel`, so history stays readable after a policy is stopped.

### `get_execution_count`

```rust
fn get_execution_count(env: Env, dca_id: u64) -> u32
```

Number of executions recorded for a policy.

## States

| Status | Meaning |
|---|---|
| `Active` | DCA is running, swaps will execute on schedule |
| `Exhausted` | All swaps executed, budget fully spent |
| `Cancelled` | Cancelled by owner, remaining budget returned |

## Events

Every event uses two topics: the event name and the DCA ID.

- `created` — published by `create_dca` and `create_dca_swap`. Data is `DCACreated { owner, next_execution_ledger }`.
- `swap` — published by `execute_swap`. Data is the running execution count.
- `cancelled` — published by `cancel`. Data is the owner address.

## Testing

```bash
cd contract
cargo test -p dca-policy
```

All 7 tests must pass.
All tests must pass, including the execution history coverage.
