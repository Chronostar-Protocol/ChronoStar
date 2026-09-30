---
title: RecurringStream
description: Stream tokens continuously to a recipient.
---

## Overview

RecurringStream lets you stream tokens to a recipient over time. The recipient can claim accrued amounts at any time. This is useful for:

- **Salaries**: Stream payroll continuously
- **Subscriptions**: Pay for services by the second
- **Royalties**: Auto-distribute revenue share

## Vesting Math

```
vested = (total_amount * elapsed) / total_duration
claimable = vested - claimed
```

Where `elapsed = min(current_ledger, end_ledger) - start_ledger` and `total_duration = end_ledger - start_ledger`.

## Interface

### `create_stream`

```rust
fn create_stream(
    env: Env,
    owner: Address,
    recipient: Address,
    token: Address,
    total_amount: i128,
    duration_ledgers: u32,
    label: String,
) -> u64
```

Creates a new stream. Transfers `total_amount` from owner to the contract.

- Minimum duration: 60 ledgers (~5 minutes)
- `total_amount` must be positive

### `create_split_stream`

```rust
fn create_split_stream(
    env: Env,
    owner: Address,
    splits: Vec<StreamSplit>, // { recipient: Address, share: u16 }
    token: Address,
    total_amount: i128,
    duration_ledgers: u32,
    label: String,
) -> u64
```

Creates a new stream with multiple recipients. `share` is in basis points and total shares must equal exactly 10 000. Rounding dust is automatically distributed to the last recipient on each claim.

### `claim`

```rust
fn claim(env: Env, caller: Address, stream_id: u64) -> i128
```

Claims the currently vested amount for the recipient. Returns the amount claimed.

### `tick`

```rust
fn tick(env: Env, stream_id: u64)
```

Updates stream status to Completed if `current_ledger >= end_ledger` and all tokens claimed. Called by the keeper.

### `cancel`

```rust
fn cancel(env: Env, stream_id: u64)
```

Cancels the stream. Recipient gets their vested amount, owner gets the remainder.

### `get_stream`

```rust
fn get_stream(env: Env, stream_id: u64) -> Option<StreamEntry>
```

### `get_claimable`

```rust
fn get_claimable(env: Env, stream_id: u64) -> i128
```

## Testing

```bash
cd contract
cargo test -p recurring-stream
```

All 6 tests must pass.
