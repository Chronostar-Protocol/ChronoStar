# ChronoStar Backend Deployment

This guide covers deploying the ChronoStar backend API service (Node.js 22 + Express) to Render or standalone servers.

## Prerequisites

- **Node.js**: >=22.0.0 (enforced via `package.json` engines; see `.nvmrc`)
- **Stellar Soroban RPC**: Working testnet or mainnet RPC endpoint
- **Deployed Contract Addresses**: See [`contract/DEPLOY.md`](../contract/DEPLOY.md)

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Local or service HTTP listening port | `3001` |
| `STELLAR_RPC_URL` | Stellar Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | Target Stellar network passphrase | `Test SDF Network ; September 2015` |
| `VAULT_CONTRACT_ID` | ScheduleVault contract ID | `C...` |
| `STREAM_CONTRACT_ID` | RecurringStream contract ID | `C...` |
| `DCA_CONTRACT_ID` | DCAPolicy contract ID | `C...` |
| `COORDINATOR_CONTRACT_ID`| KeeperCoordinator contract ID | `C...` |

## Deployment on Render

The repository provides a [`render.yaml`](../render.yaml) blueprint for automated deployments:
1. Connect repository in Render Dashboard.
2. Select the `chronostar-backend` web service.
3. Configure the environment variables in the Render settings.
4. Deploy the service.

## Health Verification

Verify backend availability:
```bash
curl http://localhost:3001/health
```
Should return HTTP 200 with service status and contract bindings.

## Testnet Reset Recovery

When the Stellar Testnet is reset by SDF, all contract IDs change and existing event streams become invalid. Refer to the [Testnet Reset Recovery Runbook](../docs/src/content/docs/operations/testnet-reset-recovery.md) for instructions on updating contract addresses and resetting the backend event store.
