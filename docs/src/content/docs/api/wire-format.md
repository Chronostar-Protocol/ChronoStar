---
title: Soroban Wire-Format Guide
description: Technical reference for encoding, decoding, and JSON serializing Soroban integers, options, structs, and enums.
---

When interacting with ChronoStar contracts via Soroban RPC, payload data undergoes two transformations:

```
[Contract State / Rust Types]
          │
          ▼
   Soroban XDR (ScVal)
          │  (Stellar SDK / scValToNative)
          ▼
 JavaScript Native Object
          │  (JSON.stringify)
          ▼
    REST API JSON
```

Assumptions about these transitions have historically caused silent precision loss, null pointer exceptions, and enum mismatch errors. This guide specifies the canonical representation at every boundary.

---

## 1. Integer Precision Boundaries (`u64`, `i128`, `u32`)

JavaScript's `Number` type uses IEEE-754 double-precision floating-point format, with a safe integer limit of $2^{53} - 1$ (`9,007,199,254,740,991`). Any 64-bit integer (`u64`) above 9 quadrillion stroops or any 128-bit integer (`i128`) loses precision if decoded into a standard JavaScript number.

### Representation Matrix

| Type | Range | Soroban XDR (`ScVal`) | Stellar SDK Native | REST API JSON |
| :--- | :--- | :--- | :--- | :--- |
| `u32` (Ledgers / IDs) | $0 \dots 4.29 \times 10^9$ | `ScValU32` | `number` | `number` (e.g., `124500`) |
| `u64` (Stream / Vault ID) | $0 \dots 1.84 \times 10^{19}$ | `ScValU64` | `BigInt` | `string` or `number` (< $2^{53}$) |
| `i128` (Asset Stroops) | $-1.7 \times 10^{38} \dots +1.7 \times 10^{38}$ | `ScValI128` | `BigInt` | **Canonical string** (e.g., `"10000000000000"`) |

### Example: i128 Token Amount (1,000,000 USDC with 7 decimals = $10^{13}$ stroops)

#### Raw XDR (`ScVal`):
```json
{
  "type": "scvI128",
  "i128": {
    "hi": "0",
    "lo": "10000000000000"
  }
}
```

#### Decoded JavaScript Object (`@stellar/stellar-sdk`):
```javascript
import { scValToNative } from '@stellar/stellar-sdk';
const decodedAmount = scValToNative(scVal); // Returns 10000000000000n (BigInt)
```

#### Canonical JSON Serialization:
```json
{
  "amount": "10000000000000",
  "amount_display": "1000000.0000000"
}
```

> **Warning**: Never use `Number(amount)` on contract balances. Always use `BigInt(amount).toString()` or string formatting utilities to preserve exact balance boundaries.

---

## 2. Option Values (`Option<T>`)

Soroban contracts use Rust's `Option<T>` for nullable return values and configuration fields (such as cliff delays, optional memos, or claim lookup results).

### Representation Matrix

| Variant | Soroban XDR (`ScVal`) | Stellar SDK (`scValToNative`) | REST API JSON |
| :--- | :--- | :--- | :--- |
| `None` | `ScValVoid` (`xdr.ScVal.scvVoid()`) | `null` or `undefined` | `null` |
| `Some(42)` | Inner `ScVal` (e.g. `ScValU32(42)`) | Inner native value (`42`) | `42` |

#### Fixture: Looking up a non-existent or settled claim
- **Soroban Return**: `xdr.ScVal.scvVoid()`
- **SDK Native**: `null`
- **API Response**:
  ```json
  {
    "stream_id": 999,
    "claim": null
  }
  ```

---

## 3. Status Enums (Unit and Ordinal Variants)

Contracts declare enums like `StreamStatus` (`Active`, `Paused`, `Completed`, `Cancelled`) and `VaultStatus` (`Active`, `Released`, `Cancelled`, `Paused`, `Reclaimed`).

Soroban contracts compile enums into unit tuple symbols or numeric integer discriminants:

```rust
#[contracttype]
pub enum StreamStatus {
    Active = 0,
    Paused = 1,
    Completed = 2,
    Cancelled = 3,
}
```

### Representation Matrix

| Status Name | Ordinal | XDR Representation | Frontend / API Acceptance |
| :--- | :--- | :--- | :--- |
| `Active` | `0` | Symbol or `u32(0)` | `"Active"` or `0` |
| `Paused` | `1` | Symbol or `u32(1)` | `"Paused"` or `1` |
| `Completed` | `2` | Symbol or `u32(2)` | `"Completed"` or `2` |
| `Cancelled` | `3` | Symbol or `u32(3)` | `"Cancelled"` or `3` |

### Client Normalization Helper (`frontend/src/types/index.ts`):
```typescript
export function toStreamStatusName(status: StreamStatus): StreamStatusName {
  if (typeof status === "number") {
    return STREAM_STATUS_NAMES[status as StreamStatusOrdinal] || "Active";
  }
  return status;
}
```
All API endpoints accept both canonical names (`"Active"`) and numeric discriminants (`0`) for backward compatibility, but always serialize canonical string names in HTTP responses.

---

## 4. Contract Structs & Vectors

### Structs (`StreamEntry`, `VaultEntry`)
Contracts serialize structs as `ScVal::Vec` or `ScVal::Map` where keys are symbols:

```rust
pub struct VaultEntry {
    pub id: u32,
    pub owner: Address,
    pub recipient: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: VaultStatus,
}
```

#### Canonical JSON Representation:
```json
{
  "id": 101,
  "owner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "recipient": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
  "amount": "500000000",
  "release_ledger": 250000,
  "status": "Active"
}
```

### Vectors (`Vec<StreamSplit>`)
Vectors of structs (e.g. split stream disbursements) decode directly to JSON arrays:
```json
[
  { "recipient": "GAAA...", "share": 7000 },
  { "recipient": "GBBB...", "share": 3000 }
]
```
Where `share` is expressed in basis points ($10,000 \text{ bps} = 100\%$).
