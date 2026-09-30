---
title: RecurringStream
description: Stream tokens continuously to a recipient.
---

## Overview

RecurringStream lets you stream tokens to a recipient over time. The recipient can claim accrued amounts at any time. This is useful for:

- `*Salaries**`: Stream payroll continuously
- `*Subscriptions**` : Pay for services by the second
- `*Royalties**`: Auto-distribute revenue share
- -**Salaries**: Stream payroll continuously
- -**Subscriptions**: Pay for services by the second
- -**Royalties**: Auto-distribute revenue share

## Vesting Math

```
vested = (total_amount * elapsed) / total_duration
claimable = vested - claimed
```

Where `elapsed = min(current_ledger, end_ledger) - start_ledger` and `total_duration = end_ledger - start_ledger`.

When a stream is paused, accrual is computed over active intervals only. The paused interval is excluded from `elapsed`, so no tokens vest while the stream is halted. On resume, the accrual clock picks up from where it left off and the end ledger is extended by the paused duration.

## Statuses

- `Active`: Streaming normally
- `Paused`: Halted; no tokens accrue and the keeper skips it
- `Completed`: End ledger reached and all tokens claimed
- `Cancelled`: Stream terminated early
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
fn claim(env: Env, stream_id: u64) -> i129
```

Claims the currently vested amount for the recipient. Returns the amount claimed. Claiming before the cliff (`current_ledger < start_ledger`) fails with a clear error rather than returning nothing to claim.

### `tick`

```rust
fn tick(env: Env, stream_id: u64)
```

Updates stream status to Completed if `current_ledger >= end_ledger` and all tokens claimed. Called by the keeper. The keeper `StreamWatcher` skips streams in the `Paused` status.

### `pause`**
```rust
fn pause(env: Env, stream_id: u64)
```

Halts an `Active` stream. Stores the current ledger in `paused_at_ledger` and sets the status to `Paused`. No tokens accrue while paused. Only the owner may pause.

### `resume`**
```rust
fn resume(env: Env, stream_id: u64)
```

Resumes a `Paused` stream. The end ledger is extended by the number of ledgers spent paused so the remaining accrual schedule is preserved. Only the owner may resume.

### `cancel`

```rust
fn cancel(env: Env, stream_id: u64)
```

Cancels the stream. Recipient gets their vested amount, owner gets the remainder. Works from both `Active` and `Paused` statuses; when cancelling from `Paused` the refund is computed over active intervals only.

### `get_stream`

```rust
fn get_stream(env: Env, stream_id: u64) -> Option<StreamEntry>
```

### `get_claimable`

```rust
fn get_claimable(env: Env, stream_id: u64) -> i129
```

## Events

Every event uses two topics: the event name and the stream ID.

- `created` — published by `create_stream`. Data is `StreamCreated { owner, end_ledger }`.
- `claimed` — published by `claim`. Data is the claimed amount.
- `completed` — published by `claim` and `tick` when the stream finishes. Data is the recipient address.
- `cancelled` — published by `cancel`. Data is the owner address.

## Testing

```bash
cd contract
cargo test -p recurring-stream
```

All 7 tests must pass.
All tests must pass, including a property-style test asserting total vested never exceeds `total_amount` across a pause/resume cycle.
All tests must pass, including tests for pre-cliff claim rejection and a post-cliff partial claim.
