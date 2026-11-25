---
title: RecurringStream
description: Stream tokens continuously to a recipient with pause, resume, and split support.
---

## Overview

RecurringStream lets you stream tokens to a recipient over time. The recipient can claim accrued amounts at any time while the stream is active. This is useful for:

- **Salaries**: Stream payroll continuously
- **Subscriptions**: Pay for services by the ledger
- **Royalties**: Auto-distribute revenue share across multiple recipients

---

## Vesting Math

The contract computes continuous linear vesting on-chain using ledger sequences:

```
total_duration = end_ledger - start_ledger
effective_ledger = min(current_ledger, end_ledger)
total_elapsed = effective_ledger - start_ledger
active_ledgers = total_elapsed - paused_ledgers
vested_amount = (total_amount * active_ledgers) / total_duration
claimable_amount = vested_amount - claimed_amount
```

When a stream is `Active`, `claimable_amount` is immediately withdrawable by the recipient. When a stream is `Paused`, **claims are strictly disabled** (`claimable_amount = 0`), and the keeper skips automated execution.

---

## Stream Pause Accounting: Worked Numerical Ledger Examples (#448)

The following worked examples derive strictly from the implemented mathematical logic in `contract/recurring-stream/src/lib.rs` (`active_ledgers` and `claimable_amount`).

### Baseline Stream Parameters for Examples
- `start_ledger`: `1000`
- `end_ledger`: `2000`
- `total_duration`: `1000` ledgers
- `total_amount`: `1,000,000` stroops (drip rate = `1,000` stroops per active ledger)

---

### Example 1: Single Mid-Stream Pause & Resume
*(Cross-checked against contract test `test_claim_after_resume`)*

1. **Active Run (Ledger 1000 → 1050)**:
   - At ledger `1050`, the owner calls `pause(stream_id)`.
   - `active_ledgers = 1050 - 1000 = 50` ledgers.
   - Vested amount = `(1,000,000 * 50) / 1000 = 50,000` stroops (5% vested).
   - `paused_at_ledger` is set to `1050`, status transitions to `Paused`.

2. **During the Pause (Ledger 1051 → 1249)**:
   - Time advances by 200 ledgers.
   - Accrual is frozen: active ledgers remain strictly `50`.
   - Calling `get_claimable` returns `0`. Calling `claim` fails with `Error::StreamNotActive`.

3. **Resume (Ledger 1250)**:
   - Owner calls `resume(stream_id)`.
   - `pause_duration = 1250 - 1050 = 200` ledgers.
   - `paused_ledgers` accumulated = `200`. `paused_at_ledger` reset to `0`. Status = `Active`.

4. **Subsequent Accrual (Ledger 1450)**:
   - At ledger `1450`, total wall-clock elapsed = `1450 - 1000 = 450` ledgers.
   - `active_ledgers = 450 - 200 = 250` ledgers.
   - Total vested = `(1,000,000 * 250) / 1000 = 250,000` stroops (25% vested).
   - Recipient calls `claim()` and receives `250,000` stroops.

---

### Example 2: Repeated Pauses Across Multiple Intervals

A stream undergoes two distinct pause periods before completion:

| Ledger Event | Action | Wall-Clock Elapsed | Paused Ledgers Added | Total Paused Ledgers | Active Ledgers | Vested (stroops) | Claimable (stroops) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `1000` | Created | `0` | `0` | `0` | `0` | `0` | `0` |
| `1200` | Pause #1 | `200` | Ongoing | `0` | `200` | `200,000` | `0` *(Paused)* |
| `1300` | Resume #1 | `300` | `100` | `100` | `200` | `200,000` | `200,000` |
| `1300` | Recipient claims | `300` | `0` | `100` | `200` | `200,000` | `0` *(Claimed)* |
| `1500` | Pause #2 | `500` | Ongoing | `100` | `400` | `400,000` | `0` *(Paused)* |
| `1650` | Resume #2 | `650` | `150` | `250` | `400` | `400,000` | `200,000` |
| `1800` | Mid-stream check | `800` | `0` | `250` | `550` | `550,000` | `350,000` |

---

### Example 3: Pause Near and Across `end_ledger`

What occurs if a stream is paused near its completion and remains paused past `end_ledger = 2000`?

1. **Pause at Ledger 1950**:
   - `paused_at_ledger = 1950`. Wall-clock elapsed = `950`.
   - Active ledgers = `950`. Vested = `950,000` stroops.
2. **Ledger Reaches 2100 (Past `end_ledger`)**:
   - The owner resumes the stream at ledger `2100`.
   - Contract clamps effective sequence: `effective_current = min(2100, 2000) = 2000`.
   - `pause_duration = 2000 - 1950 = 50` ledgers.
   - `paused_ledgers` = `50`.
   - Active ledgers at completion: `(2000 - 1000) - 50 = 950` ledgers.
   - Final vested amount = `950,000` stroops.
3. **Unvested Balance Handling**:
   - The remaining `50,000` stroops were never vested because the stream was inactive during those ledgers.
   - If the owner cancels the stream via `cancel(stream_id)`, the recipient receives their unclaimed vested portion (`950,000 - claimed`), and the unvested `50,000` stroops are refunded to the stream owner.

---

### Recipient Guarantees & Semantic Notes

1. **Non-Dilution Guarantee**: Every active ledger that elapsed guarantees the recipient `total_amount / total_duration` tokens. Pausing never revokes already vested tokens.
2. **Zero In-Pause Claims**: Calling `claim()` while paused returns `Error::StreamNotActive`. This prevents front-running pause decisions.
3. **Completion Semantics**: In the Soroban implementation, `end_ledger` is immutable. Paused ledgers reduce the total active ledgers accrued before `end_ledger`. Unaccrued balances remain available for owner cancellation refund.

---

## Contract Interface

### `create_stream`

```rust
pub fn create_stream(
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
Transfers `total_amount` from `owner` to the contract. Accrual begins at `start_ledger = current_ledger + start_delay_ledgers`.

### `pause`

```rust
pub fn pause(env: Env, stream_id: u64)
```
Halts an `Active` stream. Stores current ledger sequence in `paused_at_ledger`. Requires owner authentication.

### `resume`

```rust
pub fn resume(env: Env, stream_id: u64)
```
Resumes a `Paused` stream. Accrues completed pause interval into `paused_ledgers`. Requires owner authentication.

### `claim`

```rust
pub fn claim(env: Env, caller: Address, stream_id: u64) -> i128
```
Claims accrued claimable tokens for caller. Fails if stream is `Paused` or caller is not authorized.

### `cancel`

```rust
pub fn cancel(env: Env, stream_id: u64)
```
Terminates stream. Disburses vested tokens to recipient and refunds unvested balance to owner.
