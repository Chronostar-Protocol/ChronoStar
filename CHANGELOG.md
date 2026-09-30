# Changelog

All notable changes to ChronoStar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `created` events published by `create_vault`, `create_stream`, and `create_dca`/`create_dca_swap`, carrying the new ID in topic two and a typed payload with the owner and key schedule ledger
- ESLint config and lint script for keeper bot
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `ROADMAP.md` community health files
- CI lint jobs (`cargo fmt`, `cargo clippy`, ESLint) added to test workflows
- Issue templates (`bug_report.md`, `good_first_issue.md`) for structured contributions
- Multi-asset DCA design & scoping document (`docs/.../contracts/dca-multi-asset.md`)

### Fixed
- Restored the `#[contract] pub struct RecurringStream;` declaration removed in #201, which left `recurring-stream` uncompilable and failed the `Test Contracts` job
- `test_execute_swap_with_router` now bumps the mock router's instance TTL before the ledger jump and allows non-root auth, so it no longer panics with an archived instance key / invalid auth action
- `cargo fmt --check` violations in the `dca-policy` import list and a stray blank-line run in `recurring-stream`, which were failing the `Test Contracts` lint job
- CI branch triggers changed from `main` to `master` to match default branch

## [0.1.0] — 2026-07-14

### Added (Phase 1 — Repository Setup & Smart Contract Scaffolding)
- Monorepo workspace with `contract/` workspace (schedule-vault, recurring-stream, dca-policy)
- `ScheduleVault` contract: create, release, cancel, query vaults
- `RecurringStream` contract: create, claim, tick, cancel, query streams with linear vesting
- `DCAPolicy` contract: create DCA policy, execute swaps on interval, cancel
- Contract deployment guide (`contract/DEPLOY.md`)
- Workspace `Cargo.toml` with Soroban SDK v22.x

### Added (Phase 2 — Keeper Bot Implementation)
- Node.js keeper bot with vault/stream/DCA watchers
- Stellar SDK integration with exponential backoff retry
- `render.yaml` for Render Background Worker deployment
- Health check and metrics HTTP endpoints
- Configuration via environment variables

### Added (Phase 3 — Backend REST API Implementation)
- Express REST API with routes for schedules, streams, DCA policies, events, stats
- In-memory event log store
- Stellar SDK v13 read helpers with `scValToNative`
- Health check endpoint
- `render.yaml` for Render Web Service deployment

### Added (Phase 4 — Frontend)
- Next.js 14 App Router frontend with TypeScript and Tailwind CSS
- Freighter wallet integration
- Pages: landing, dashboard, create/explore vaults, streams, DCA policies
- Component library: StatsBar, LedgerClock, TxToast, EmptyState
- `.env.local.example` and `vercel.json`

### Added (Phase 5 — Documentation Site)
- Astro Starlight documentation site
- Content: overview, quickstart, contract docs, API reference, self-hosting guide, Lodestar integration
- GitHub Pages deployment via `deploy-docs.yml` workflow

