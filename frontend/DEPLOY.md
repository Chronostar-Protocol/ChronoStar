# ChronoStar Frontend Deployment

This guide covers deploying the ChronoStar frontend (Next.js 14) to Vercel and wiring it up to the backend API and Stellar contracts.

## Prerequisites

- A Vercel account and the [Vercel CLI](https://vercel.com/docs/cli) (optional, for CLI deploys)
- Deployed contracts and keeper wallet. See [`contract/DEPLOY.md`](../contract/DEPLOY.md) first — you will need the `VAULT_CONTRACT_ID`, `STREAM_CONTRACT_ID`, `DCA_CONTRACT_ID`, and `USDC_CONTRACT_ID`.
- A deployed backend. See the root [`README.md`](../README.md) and [`render.yaml`](../render.yaml) for the backend deployment on Render.

## 1. Vercel Setup

### Option A: GitHub Integration (recommended)

1. Push the repository to GitHub.
2. In the [Vercel dashboard](https://vercel.com/dashboard), select **Add New → Project**.
3. Import the `ChronoStar` repository.
4. Vercel auto-detects the framework from `frontend/vercel.json`/`next.config.mjs`. Set the following Project Settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Next.js (auto-detected)
   - **Build Command:** `npm run build` (set in `vercel.json`)
   - **Output Directory:** `.next`
5. Add the environment variables from [section 2](#2-environment-variables) below.
6. Click **Deploy**. Vercel runs `npm install`, `npm run lint`, then `npm run build` on every push to `master` (`frontend/**` changes).

### Option B: Vercel CLI

```bash
cd frontend
npm install -g vercel
vercel login
vercel link
vercel env add NEXT_PUBLIC_API_URL production
# repeat for every variable in section 2
vercel --prod
```

## 2. Environment Variables

Copy `frontend/.env.local.example` to `.env.local` locally, or set the same variables in Vercel (**Settings → Environment Variables**).

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the backend API (note: this is the variable read by `src/lib/api.ts`) | `https://chronostar-backend-s905.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | Public URL of your Vercel deployment (used for SEO/metadata) | `https://chronostar.vercel.app` |
| `NEXT_PUBLIC_VAULT_CONTRACT_ID` | ScheduleVault contract ID from `contract/DEPLOY.md` | `C...` |
| `NEXT_PUBLIC_STREAM_CONTRACT_ID` | RecurringStream contract ID from `contract/DEPLOY.md` | `C...` |
| `NEXT_PUBLIC_DCA_CONTRACT_ID` | DCAPolicy contract ID from `contract/DEPLOY.md` | `C...` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | USDC token contract ID on Stellar | `C...` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network passphrase matching the RPC network | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_STELLAR_EXPLORER` | Block explorer base URL for transaction links | `https://stellar.expert/explorer/testnet` |

> Keep contract IDs in sync with the network the RPC URL points to (testnet vs. mainnet). Mixing them is the most common cause of "contract not found" errors.

### Verify locally

```bash
cd frontend
cp .env.local.example .env.local
# fill in real values
npm install
npm run dev
```

The dashboard/explorer pages should load data from the backend once `NEXT_PUBLIC_API_URL` is set.

## 3. Connecting to the Backend API

The frontend talks to the backend exclusively through `src/lib/api.ts`:

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
```

- Every `api.*` call prefixes the path with `BASE_URL` (e.g. `GET {BASE_URL}/api/schedules/:address`).
- The backend already enables open CORS (`app.use(cors())` in `backend/src/index.js`), so no proxy/rewrites are needed in `vercel.json`. If you want to add rewrites instead, see [section 5](#5-troubleshooting).
- For a real HTTPS backend on Render, use the `onrender.com` URL (never `localhost`) in the production environment.

## 4. Building Locally (same as CI)

```bash
cd frontend
npm install
npm run lint
npm run build
```

CI (`.github/workflows/deploy-frontend.yml`) runs `lint` + `build` on every push to `master` that touches `frontend/**`.

## 5. Troubleshooting

### Vercel deploy fails with "Module not found" or build errors

- Ensure the **Root Directory** is `frontend` — Vercel defaults to the repo root.
- Run `npm run lint` and `npm run build` locally; fix errors before pushing (note: some dashboard/detail pages have duplicate code blocks that break the build — check `src/app/dashboard/page.tsx` and `src/app/{vault,stream,dca}/[id]/page.tsx`).
- Clear Vercel's build cache: **Settings → Build Cache** then redeploy, or `vercel build --force`.

### CORS errors in the browser console

- Confirm the browser hits `NEXT_PUBLIC_API_URL` (open DevTools → Network → inspect the request URL).
- If you're serving the frontend from a custom domain while the backend only allows specific origins, add your Vercel domain to the backend's CORS allow-list.
- If the backend is unreachable from the browser (private network or localhost), expose it publicly (Render) or rewrite API calls through Vercel:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://chronostar-backend-s905.onrender.com/api/:path*" }
  ]
}
```

- Add `cors` middleware options in `backend/src/index.js` instead of bare `cors()` to restrict origins in production.

### Wallet (Freighter) issues

- **"Freighter is not installed"**: install the [Freighter](https://freighter.app/) browser extension, and only connect from a browser context (not server-side SSR).
- **Network mismatch**: Freighter must be on the same network as `NEXT_PUBLIC_STELLAR_RPC_URL` and `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`. Switch the wallet to Testnet and keep the testnet values in your env vars.
- **Wallet connects but data is empty**: the wallet address must be passed to the backend calls (`GET /api/schedules/:address`, etc.). Contract IDs must match the network the wallet is on.
- **Tracking a connected account**: `WalletProvider` in `src/lib/store.tsx` auto-detects an existing Freighter session on mount; hard-refresh the page after switching networks in Freighter.

### Backend not reachable

- Verify the URL via `curl https://<backend-url>/api/stats` — it must return JSON, not an error page.
- Env vars changed in Vercel require a redeploy to take effect.