---
title: REST API Reference
description: Backend API endpoints for reading contract state.
---

## Base URL

```
http://localhost:3001
```

All endpoints return JSON.

## Endpoints

### `GET /api/schedules/:address`

Returns all vaults for a given Stellar address (as owner).

**Example:**

```bash
curl http://localhost:3001/api/schedules/GABCD...
```

```json
[
  {
    "id": 1,
    "owner": "GABCD...",
    "recipient": "GDEF...",
    "token": "CC...",
    "amount": "1000000",
    "release_ledger": 2000000,
    "status": "Active"
  }
]
```

### `GET /api/streams/:address`

Returns all streams where the address is owner or recipient.

```bash
curl http://localhost:3001/api/streams/GABCD...
```

### `GET /api/dca/:address`

Returns all DCA policies for an address.

```bash
curl http://localhost:3001/api/dca/GABCD...
```

### `GET /api/events`

Returns upcoming schedule events sorted by time until execution.

| Query | Default | Description |
|---|---|---|
| `limit` | `50` | Max events to return (max 100) |

```bash
curl http://localhost:3001/api/events?limit=10
```

```json
[
  {
    "type": "vault",
    "id": 1,
    "targetLedger": 2000000,
    "remainingLedgers": 5000
  }
]
```

### `GET /api/stats`

Returns aggregate statistics across all contracts.

```bash
curl http://localhost:3001/api/stats
```

```json
{
  "vaults": { "total": 10, "active": 8, "released": 2 },
  "streams": { "total": 5, "active": 4, "completed": 1 },
  "dca": { "total": 3, "active": 2, "exhausted": 1 },
  "totalValueLocked": "0"
}
```

### `GET /healthz`

Health check endpoint.

```bash
curl http://localhost:3001/healthz
```

```json
{ "status": "ok" }
```

## Error Responses

All errors return:

```json
{ "error": "message" }
```

With appropriate HTTP status codes (400, 404, 500).

---

## Wire Format & Precision Handling

ChronoStar API endpoints enforce strict precision standards for 64-bit and 128-bit integers (such as asset amounts and stream timestamps). See the [Soroban Wire-Format Guide](/ChronoStar/api/wire-format/) for full specifications on XDR decoding, Option/Enum serializations, and canonical string representations.
