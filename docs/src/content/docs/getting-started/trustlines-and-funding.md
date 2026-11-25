---
title: Token Trustlines & Recipient Readiness Tutorial
description: Step-by-step tutorial on Stellar asset types, reserve requirements, trustlines, and verifying recipient readiness.
---

When configuring scheduled vaults, recurring streams, or DCA disbursements in ChronoStar, disbursements fail if the recipient account cannot accept the selected token. This tutorial walks through asset classifications, reserve obligations, and non-destructive verification procedures.

---

## 1. Stellar Asset Classifications

ChronoStar supports three categories of tokens on the Stellar network:

| Category | Description | Trustline Required? | Base Reserve Impact |
| :--- | :--- | :--- | :--- |
| **Native Asset (`XLM`)** | Network gas and base currency | **No** | Requires 1.0 XLM to create the account |
| **Issued Classic Assets (`USDC`)** | Off-chain backed or fiat tokens issued via Stellar Classic (SEP-41 Soroban SAC wrapper) | **Yes** (for `G...` accounts) | Requires +0.5 XLM reserve per trustline |
| **Native Soroban Tokens** | Smart contracts implementing the Soroban Token Interface | **No** | Stored in contract instance storage; no trustline needed |

### Classic Accounts vs Contract Recipients

- **Classic Accounts (`G...`)**: Governed by the Stellar consensus core. To hold issued assets (such as Circle's testnet USDC), the account owner must explicitly submit a `ChangeTrust` transaction. Each trustline locks **0.5 XLM** of the account's balance in reserve.
- **Contract Recipients (`C...`)**: Do not have classic trustline limits. When ChronoStar disburses to a smart contract recipient, tokens are recorded directly into the Soroban Token Contract's persistent storage for that contract address.

---

## 2. Reserve & Balance Requirements for Recipients

For a classic account (`G...`) to successfully receive an issued asset payment:

$$\text{Minimum XLM Balance Required} = 1.0 \text{ XLM (Base Reserve)} + (0.5 \text{ XLM} \times \text{Number of Trustlines})$$

If an account only holds 1.0 XLM and has not established a trustline for USDC, attempting to disburse USDC to it will revert on-chain with `Error::Contract(101)` or `op_no_trust`.

---

## 3. Worked Example: Preparing a Recipient for Testnet USDC

### Scenario
A recipient with address `GAQW2J...` needs to receive a scheduled disbursement of **50 USDC** (`500,000,000` stroops) from ScheduleVault.

### Step 1: Fund the Recipient Account with Base Reserve
On testnet, request Friendbot to create and fund the recipient with test XLM:
```bash
curl -s "https://friendbot.stellar.org?addr=GAQW2J..."
```

### Step 2: Establish the USDC Trustline
The recipient signs a `ChangeTrust` operation pointing to the testnet USDC issuer:
- **Asset Code**: `USDC`
- **Issuer**: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

Using Stellar CLI (no private key needed on the sender side):
```bash
stellar xdr encode --type Operation <<EOF
{
  "sourceAccount": "GAQW2J...",
  "body": {
    "changeTrustOp": {
      "line": {
        "creditAlphanum4": {
          "assetCode": "USDC",
          "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        }
      },
      "limit": "9223372036854775807"
    }
  }
}
EOF
```
In browser environments, the recipient simply confirms the "Add Token" prompt in their Freighter wallet.

---

## 4. Verifying Destination Readiness (Read-Only)

Before creating a stream or scheduling a vault payment, senders or automated keepers can verify the recipient's readiness without spending gas or holding recipient credentials.

### Query Horizon REST API:
```bash
curl -s "https://horizon-testnet.stellar.org/accounts/GAQW2J..." | jq '.balances'
```

#### Expected Valid Response:
```json
[
  {
    "balance": "0.0000000",
    "limit": "922337203685.4775807",
    "asset_type": "credit_alphanumeric4",
    "asset_code": "USDC",
    "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  },
  {
    "balance": "9999.9999900",
    "asset_type": "native"
  }
]
```

### Readiness Checklist:
1. **Account Exists**: Query returns HTTP 200 (not `404 Not Found`).
2. **Native Balance $\ge$ 1.5 XLM**: Account has enough balance to cover the base reserve plus trustline reserve.
3. **Trustline Present**: An entry in `.balances` matches `asset_code == "USDC"` and the expected issuer address.

If all three conditions pass, the recipient is ready to receive disbursements from ChronoStar.
