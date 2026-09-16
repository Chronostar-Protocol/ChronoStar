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

## Proposed Contract Changes

### Data model

`DCAEntry` (see `contract/dca-policy/src/lib.rs`) gains two fields and one optional block:

```rust
pub struct DCAEntry {
    pub id: u64,
    pub owner: Address,
    pub token_in: Address,
    pub token_out: Address,      // NEW  – destination asset bought by each swap
    pub swap_receiver: Address,  // kept – for opt-out "forward-only" DCAs (see Migration)
    pub total_budget: i128,
    pub remaining_budget: i128,
    pub amount_per_swap: i128,
    pub interval_ledgers: u32,
    pub last_executed_ledger: u32,
    pub next_execution_ledger: u32,
    pub executions_completed: u32,
    pub created_ledger: u32,
    pub label: String,
    pub status: DCAStatus,
    // NEW
    pub swap_config: Option<SwapConfig>,
    pub decimals_in: u32,        // cached, avoids repeated token metadata reads
    pub decimals_out: u32,       // cached, avoids repeated token metadata reads
}

#[contracttype]
#[derive(Clone)]
pub struct SwapConfig {
    pub dex: DexProvider,         // Soroswap | Phoenix | (future: Aggregator)
    pub dex_address: Address,     // router / multihop instance
    pub path: Vec<Address>,       // e.g. [USDC, XLM] or [USDC, XLM, EURC] multi-hop
    pub min_amount_out_bps: u32,  // slippage guard, in basis points (e.g. 50 = 0.5%)
    pub deadline_offset_ledgers: u32, // quoted ledger + offset as swap deadline
}
```

`DexProvider` is a small enum stored in the entry so the contract knows which router ABI to
use when executing:

```rust
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum DexProvider {
    Soroswap,
    Phoenix,
}
```

### Versioning state

Storage keys are versioned so the migration does not clobber live entries. Replace the raw
`DataKey::DCA(u64)` with a versioned wrapper keyed on the enum instance:

```rust
#[contracttype]
pub enum DataKey {
    DCA(u64),          // v1 entries – legacy, read-only after migration
    DCAV2(u64),        // NEW – post-migration entries
    Counter,
    DCAsByOwner(Address),
    Config,            // NEW – global router addresses, admin
}
```

### `create_dca` signature

The v2 entry point keeps the existing argument order for source compatibility and appends
the new swap parameters:

```rust
pub fn create_dca(
    env: Env,
    owner: Address,
    token_in: Address,
    token_out: Address,          // NEW
    swap_receiver: Address,
    total_budget: i128,
    amount_per_swap: i128,
    interval_ledgers: u32,
    label: String,
    dex: DexProvider,            // NEW
    path: Vec<Address>,          // NEW
    min_amount_out_bps: u32,     // NEW
) -> u64
```

New validation rules:

- `token_in != token_out` (no-op swaps rejected).
- `path[0] == token_in` and `path[path.len()-1] == token_out` — the route must start and end
  with the funded and target assets.
- `min_amount_out_bps` bound to a sane range (e.g. `0 < bps <= 1_000` = up to 10%) to keep
  keeper-executed swaps profitable/bounded.
- `swap_receiver` is **optional by semantics**: when a `swap_config` is present the receiver
  may be the target asset owner's wallet (see `execute_swap`).

### `execute_swap` behavior

`execute_swap` remains keeper-callable and permissionless. When `swap_config` is `Some` the
legacy transfer branch is replaced by a router invocation:

```rust
match dca.swap_config {
    Some(config) => execute_on_dex(&env, &dca, &config),
    None         => legacy_transfer(&env, &dca),   // existing behavior
}
```

`execute_on_dex`:

1. Pulls `amount_per_swap` of `token_in` through `token::Client::transfer` to the router
   (or approves + transfers, depending on router ABI).
2. Calls the router's exact-in swap with `amount_out_min` derived from `min_amount_out_bps`.
3. Confirms the contract (or receiver) received `token_out`; otherwise reverts.
4. Decrements `remaining_budget` by the **full** `amount_per_swap` (slippage and fees are
   absorbed by the executed quantity, not the budget).
5. Flags an `execute_swap` return value with the realized `token_out` amount for keeper
   observability and partial-fill safety.

### New read functions

- `quote_amount_out(env, dca_id, amount_in) -> i128` — read-only, delegates to
  `router_get_amounts_out` (Soroswap) / pool `get_reserves` (Phoenix); used by keeper
  health checks and the frontend.
- `get_dca_v2(env, dca_id) -> Option<DCAEntry>` — typed read of versioned entries.

### Admin / configuration functions

A `Config` data key holds the canonical Soroswap Router, Soroswap Aggregator, and Phoenix
Multihop addresses per network, settable by an admin address:

```rust
pub fn set_config(env: Env, admin: Address, config: Config)
pub fn get_config(env: Env) -> Config
```

Keeping router addresses in instance storage (rather than hardcoded) lets the contract
point at testnet vs mainnet deployments without a redeploy.

## DEX Integration Points

The contract must be able to route a schedule swap through a Soroban AMM. Two venues are in
scope for v1: **Soroswap** and **Phoenix**. Both are reachable from a Soroban contract via
generated clients; neither requires holding user keys as long as the AMM sends output back
to the `DCAPolicy` contract or the policy's authorized receiver.

### Soroswap

[Soroswap](https://docs.soroswap.finance) is the reference AMM on Soroban. The contract
calls the **SoroswapRouter** via `contractimport!` on its WASM and invokes
`swap_exact_tokens_for_tokens`:

```rust
soroban_sdk::contractimport!(file = "./soroswap_router.wasm");
pub type SoroswapRouterClient<'a> = Client<'a>;

let router = SoroswapRouterClient::new(&env, &config.dex_address);
router.swap_exact_tokens_for_tokens(
    &amount_per_swap,      // amount_in
    &amount_out_min,       // derived from min_amount_out_bps
    &path,                 // e.g. [USDC, XLM]
    &recipient,            // DCAPolicy contract or authorized receiver
    &deadline_u64,         // current ledger + deadline_offset_ledgers
);
```

Key detail: the router calls `recipient.require_auth()`. Therefore `recipient` should be
the `DCAPolicy` contract itself (which authenticates via `env.current_contract_address()`)
and the policy then forwards `token_out` to the owner/`swap_receiver`. This avoids signing
on the user's behalf.

For multi-hop routes the same call accepts `path = [token_in, mid, ..., token_out]`, so
pairs without direct liquidity (e.g. USDC→EURC via XLM) work with no extra contract work.

Router addresses are read from `Config` / `config.dex_address` and seeded during deployment
(see [Deployment](/contracts/dca-multi-asset/#deployment-and-configuration)).

### Phoenix

[Phoenix](https://github.com/Phoenix-Protocol-Group/phoenix-contracts) is an order-book /
AMM hybrid on Soroban. The contract targets the **Phoenix Multihop** contract, which chains
pools in a single call:

```rust
let multihop = PhoenixMultihopClient::new(&env, &config.dex_address);
let swaps: Vec<Swap> = path
    .windows(2)
    .map(|w| Swap { ask_asset: w[1].clone(), offer_asset: w[0].clone() })
    .collect();
multihop.swap(
    &recipient,          // DCAPolicy contract
    &None,               // referral unused
    &swaps,              // [{USDC, XLM}, {XLM, EURC}] for multi-hop
    &Some(max_belief_price),
    &Some(max_spread_bps), // derived from min_amount_out_bps
    &amount_per_swap,
);
```

Phoenix's `Swap { ask_asset, offer_asset }` struct maps naturally to the same `path`
vector stored on the DCA entry, so the contract needs only a small serialization shim
between the two ABIs.

### Router ABI abstraction

To keep `execute_swap` ignorant of venue specifics, wrap both clients behind a shared
internal helper:

```rust
fn swap_exact_in(
    env: &Env,
    provider: &DexProvider,
    dex_address: &Address,
    path: &Vec<Address>,
    amount_in: i128,
    amount_out_min: i128,
    recipient: &Address,
) -> i128
```

Soroswap targets the router; Phoenix targets multihop. The return value is the realized
`amount_out`, which feeds the execution-receipt path described in `execute_swap`.

### Future: Soroswap Aggregator

The [Soroswap Aggregator](https://docs.soroswap.finance/aggregator/) splits a single trade
across supported AMMs (Soroswap, Phoenix, and later Aquarius) and exposes a
`swap_exact_tokens_for_tokens`-shaped call. Adding it later means:

- New `DexProvider::Aggregator` variant, no new contract logic.
- Better pricing for thin pairs and the ability to include SDEX-heavy liquidity over time.

This is deliberately deferred — see Non-Goals — but the `DexProvider` enum keeps the door
open.

### Integration contract checklist

| Venue | Entry point | Output auth model | Multi-hop |
|---|---|---|---|
| Soroswap | `SoroswapRouter.swap_exact_tokens_for_tokens` | `recipient.require_auth()` → use policy address, then forward | Yes (via `path`) |
| Phoenix | `PhoenixMultihop.swap` | Liquidity pool requires pool auth; policy receives output | Yes (via `operations`/`Swap[]`) |
| Soroswap Aggregator | `swap_exact_tokens_for_tokens` (same shape) | Same as router | Yes (auto) |

## Fee Handling

Fee handling splits into three distinct concerns: **DEX fees**, **keeper execution costs**,
and **protocol fees**. Each has different accounting semantics in the contract.

### DEX swap fees

Both venues take an in-swap liquidity-provider fee:

- Soroswap pairs charge a fixed liquidity fee (0.30% per swap today; the protocol has an
  optional 0.05% protocol fee).
- Phoenix pools charge a trading fee configured per pool.

**Design decision:** DEX fees are *absorbed inside the executed quantity* and **never**
billed against `remaining_budget`. `amount_per_swap` is decremented from the budget in full;
the `token_out` amount the keeper records is `amount_in − fee − price_impact`. Consequences:

- Budget exhaustion and execution counts remain deterministic and identical to the legacy
  contract.
- A user's eventual `token_out` is `sum(realized_amount_out)` across executions, which the
  (upcoming) query surface reports for transparency.

### Slippage as a fee guard

`min_amount_out_bps` caps how much of `amount_in` a swap may lose to price movement. The
contract computes:

```rust
let amount_out_min = quote(env, amount_per_swap).moving_avg_or_reserves
    * (10000 - min_amount_out_bps)
    / 10000;
```

- Soroswap: call `router_get_amounts_out(amount_in, path)` read-only, then apply the bps
  haircut.
- Phoenix: use pool `get_reserves` + constant-product math, then apply the bps haircut.

If the router returns an output below `amount_out_min`, `execute_swap` reverts. The swap is
not marked executed, so the keeper retries on the next poll — protecting users from a
slippage spike during a single ledger while staying eventually consistent.

### Keeper execution costs

`execute_swap` is permissionless and paid by whom? Three options, with a recommendation:

| Option | Description | Verdict |
|---|---|---|
| Keeper pays | Keeper signs and pays `base_fee` on each `execute_swap` | Keep today's model |
| Payers pay | Keeper stipend funded by users on top of budget | No — complicates budget math |
| Sponsored | ChronoStar treasury pays keepers a fixed rate | Out of scope for v1 |

**Recommendation:** retain the current model where the keeper funds transaction fees. The
per-swap value is set at creation and the DEX fee is the only cost that reduces the fill.
Chair this if `amount_per_swap` is very small relative to `base_fee` — see
[Open Questions](/contracts/dca-multi-asset/#open-questions).

### Protocol / take-rate fees (explicitly out of scope)

Whether ChronoStar takes a percentage of `token_out` is a **product decision**, not a
contract requirement. The design deliberately leaves it out so:

- Budget and authorization semantics stay aligned with the existing contract.
- Introducing a take-rate later is a pure additive change (a fee collector address in
  `Config`), implemented through an upgrade with no back-compat break.

### Fee transparency to users

The frontend "Create DCA" form and the DCA detail page should surface:

- The venue's documented swap fee (Soroswap 0.30% per pool hop; Phoenix per-pool fee).
- The selected slippage bound (`min_amount_out_bps`).
- A worst-case `amount_out_min` preview via `quote_amount_out`.

This matches the existing docs tone in `docs/src/content/docs/contracts/dca-policy.md` and
keeps the off-chain estimate honest about fee impact.