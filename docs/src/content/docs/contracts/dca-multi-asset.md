---
title: Multi-Asset DCA (Design)
description: Design and scoping document for extending DCAPolicy to arbitrary token pairs.
---

## Status

- **Type:** RFC / scoping document
- **Owner:** ChronoStar maintainers
- **Tracking:** [ROADMAP Milestone 2 – Multi-Asset DCA Support](/roadmap)
- **Last updated:** 2026-09-16

## TL;DR

The `DCAPolicy` contract currently simulates a DCA swap by transferring `token_in` to a
`swap_receiver` address. A real DCA strategy must convert `token_in` into a *different*
`token_out` on a recurring basis.

This document proposes extending `DCAPolicy` to:

1. Accept a `token_out` (destination asset) and a DEX routing configuration.
2. Execute each scheduled swap **on-chain** through an AMM router (Soroswap or Phoenix).
3. Track slippage / minimum-output thresholds and absorb DEX swap fees in budget accounting.
4. Migrate existing DCA entries without breaking live policies.

The change is additive: existing `USDC → receiver` policies keep working while new
token-to-token policies are enabled.

## Problem Statement

### What works today

The present implementation in
[`contract/dca-policy/src/lib.rs`](https://github.com/Chronostar-Protocol/ChronoStar/blob/master/contract/dca-policy/src/lib.rs)
models a DCA as:

- A `token_in` that the owner funds up front (`create_dca` transfers `total_budget` into the
  contract).
- A `swap_receiver` destination address.
- A fixed `amount_per_swap` scheduled every `interval_ledgers`.

`execute_swap` on the keeper's schedule performs:

```rust
token_client.transfer(
    &env.current_contract_address(),
    &dca.swap_receiver,
    &dca.amount_per_swap,
);
```

### What this means in practice

Because `execute_swap` is a plain token transfer, the contract "down payment" is:

1. **Funding:** `token_in` (e.g. USDC) is locked in the contract.
2. **Swap:** scheduled transfer of USDC to `swap_receiver`.
3. **Conversion:** *off-chain* — the receiver is expected to convert USDC to the target
   asset (e.g. XLM) on some external venue.

There is **no on-chain swap**, no `token_out`, no slippage protection, and no routing. The
contract cannot support arbitrary pairs (USDC→EURC, XLM→USDC, …) and cannot guarantee the
user actually receives the intended asset.

## Goals

1. Support arbitrary `token_in → token_out` pairs in a single DCA policy.
2. Execute swaps atomically on-chain through a trusted AMM (Soroswap and/or Phoenix),
   keeping the keeper the only party that triggers execution.
3. Protect users with a per-swap minimum-output (slippage) bound.
4. Preserve the existing funding / scheduling / cancellation semantics.
5. Provide a clean migration path so existing DCAs are not stranded.

## Non-Goals (initial scope)

- **Classic Stellar SDEX (path payments):** out of scope for v1 of this change. Composite
  SDEX swaps cannot be invoked from within a Soroban contract the same way AMM router calls
  can. May be revisited via an aggregator adapter.
- **Quote/price discovery UIs:** a frontend quote endpoint is a nice-to-have, not a blocker.
- **DEX-agnostic best-price aggregation across venues in one swap:** v1 routes through one
  configured venue per policy; a Soroswap Aggregator option can be layered on later.
- **Protocol revenue sharing / take-rate fees:** discussed in
  [Fee Handling](/contracts/dca-multi-asset/#fee-handling) as an explicit decision.