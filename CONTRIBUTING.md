# Contributing to ChronoStar

Thanks for your interest in contributing! ChronoStar is a Stellar Soroban protocol for scheduled and recurring payments.

> 🎓 **New Contributor?** Check out our step-by-step [Good-First-Issue Onboarding Curriculum](docs/src/content/docs/getting-started/onboarding-curriculum.md) for setup checklists, curated starter tasks, and walkthroughs.

## Prerequisites

- **Node.js** >=22.0.0 (enforced across root and workspace engines; see `.nvmrc`)
- **Rust** 1.84.0 pinned toolchain with the `wasm32-unknown-unknown` target
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Soroban CLI** (`stellar` or `soroban`)
  ```bash
  cargo install --locked stellar-cli --features opt
  ```

## Running Locally

### Contracts

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in required vars
npm run dev
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in contract addresses
npm install
npm run dev
```

### Keeper

```bash
cd keeper
cp .env.example .env   # fill in KEEPER_SECRET and contract addresses
npm install
npm start
```

## Troubleshooting

- **"wasm32 target not found"** — run `rustup target add wasm32-unknown-unknown`.
- **"stellar command not found"** — ensure `~/.cargo/bin` is in your `$PATH`.
- **Frontend fails to connect wallet** — make sure Freighter browser extension is installed and set to Testnet.
- **Keeper fails with "simulation error"** — verify contract addresses in `.env` match the current Testnet deployment.

## Running Tests

```bash
# Contracts (all in workspace)
cd contract && cargo test

# Backend
cd backend && npm test

# Backend integration (requires Docker + Stellar CLI; spins up a local
# Soroban sandbox, seeds the contracts, and runs supertest against the real routes)
cd backend && npm run test:integration

# Keeper
cd keeper && npm test

# Node engines validation
npm run check:engines

# Dependency license inventory & policy audit
npm run audit:licenses
```

## Open Source Dependency License Policy (#442)

ChronoStar enforces an explicit dependency license compliance policy across all npm workspaces and Cargo crates to protect contributors, users, and downstream integrators.

### Allowed Permissive Licenses
Dependencies governed by standard permissive open-source licenses are automatically approved:
- `MIT`, `MIT-0`
- `Apache-2.0`
- `BSD-2-Clause`, `BSD-3-Clause`
- `ISC`
- `CC0-1.0`, `0BSD`, `Unlicense`
- `BlueOak-1.0.0`
- `Python-2.0`, `Zlib`

### Scoped Exceptions Policy
Certain dependencies with non-permissive or specialized licenses are permitted under strictly scoped rationales:
- **`MPL-2.0`**: Permitted strictly for build-time license identifier registries (`spdx-license-ids`) and accessibility test runners (`axe-core`).
- **`CC-BY-4.0`**: Permitted for browser compatibility and styling datasets (`caniuse-lite`).
- **`LGPL-3.0-or-later`**: Permitted for isolated binary prebuilds (`sharp-libvips`) used solely during static site documentation generation and compiler WASM helpers (`@swc/wasm`).

### Prohibited Licenses
Strong copyleft or non-commercial licenses (such as standard GPL without linking exceptions, AGPL, SSPL, or proprietary commercial licenses) are rejected by CI.

To verify license compliance before submitting changes:
```bash
npm run audit:licenses
```

## Branch & Commit Conventions

- **Branch naming:** `feature/short-description`, `fix/short-description`, `docs/short-description`
- **PR base:** `master` (do not open PRs against other branches)
- **Commit messages:** Use [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — new feature
  - `fix:` — bug fix
  - `docs:` — documentation
  - `ci:` — CI/CD changes
  - `refactor:` — code restructuring without behavior change
  - `test:` — adding or updating tests

## Review Expectations

- Contract changes should be reviewed by a contract owner listed in `.github/CODEOWNERS`. Regenerate contract specs with `scripts/generate-contract-specs.sh` and include the generated changes.
- Workflow changes should be reviewed by the workflow owner listed in `.github/CODEOWNERS`. Describe changes to permissions, secrets, and third-party actions in the pull request.

## Issue Labels & Drips Wave Points

Issues are labeled by complexity for the Drips Network Stellar Wave Program:

| Label | Estimated effort | Points |
|-------|-----------------|--------|
| `light` | < 4 hours | 1–2 |
| `medium` | 4–16 hours | 3–5 |
| `heavy` | > 16 hours | 6–10 |

**`good-first-issue`** marks tasks suitable for first-time contributors:
well-scoped, self-contained, and achievable without deep Stellar/Soroban knowledge.

## Getting Help

Open a GitHub Discussion or comment on an issue. We respond within 2–3 business days.
