---
title: RecurringStream
description: Stream tokens continuously to a recipient.
---

## Overview

RecurringStream lets you stream tokens to a recipient over time. The recipient can claim accrued amounts at any time. This is useful for:

- -**Salaries**: Stream payroll continuously
- -**Subscriptions**: Pay for services by the second
- -**Royalties**: Auto-distribute revenue share

## Vesting Math

```
vested = (total_amount * elapsed) / total_duration
claimable = vested - claimed
```

Where `elapsed = min(current_ledger, end_ledger) - start_ledger` and `total_duration = end_ledger - start_ledger`.

## Cliff Period

A stream can optionally be created with a cliff (start delay). The cliff is specified in ledgers via `start_delay_ledgers` and is stored as `start_ledger = current_ledger + start_delay_ledgers`. No tokens accrue before `start_ledger`. This is useful for:

- -**Trial periods**: Subscriptions that only begin accruing after a trial
- -**Delayed salaries**: Streams that should not start until a start date

A `zero` delay reproduces the current behaviour exactly. Total duration is still calculated as `end_ledger - start_ledger`, so the drip rate is unchanged by the cliff.

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
    start_delay_ledgers: u32,
    label: String,
) -> u64
```

Creates a new stream. Transfers `total_amount` from owner to the contract. The stream begins accruing at `start_ledger = current_ledger + start_delay_ledgers`.

- Minimum duration: 60 ledgers (~5 minutes)
- `total_amount` must be positive
- `start_delay_ledgers` may be zero (no cliff)

### `claim`

```rust
fn claim(env: Env, stream_id: u64) -> i128
```

Claims the currently vested amount for the recipient. Returns the amount claimed. Claiming before the cliff (`current_ledger < start_ledger`) fails with a clear error rather than returning nothing to claim.

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

All tests must pass, including tests for pre-cliff claim rejection and a post-cliff partial claim.
