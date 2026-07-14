# Roadmap

This document outlines near-term and medium-term milestones for ChronoStar.
Priorities may shift based on community input and ecosystem developments.

## Near-Term (Q3 2026)

### Milestone 1: Mainnet Readiness
- Finalize contract audit scope and engage an auditor
- Deploy all three contracts (ScheduleVault, RecurringStream, DCAPolicy) to Stellar Mainnet
- Deploy backend, frontend, and keeper to production with Mainnet configuration
- Add production monitoring and alerting (health checks, keeper uptime)

### Milestone 2: Multi-Asset DCA Support
- Extend the DCAPolicy contract to support token-to-token swaps (not just USDC → XLM)
- Integrate with Stellar DEX contracts (e.g., Soroswap) for on-chain swap execution
- Update the frontend "Create DCA" form to accept arbitrary token pairs
- Add multi-asset support scoping document

### Milestone 3: Mobile-Friendly Frontend
- Responsive redesign of all pages for mobile screens
- Add PWA support (offline caching, install prompt)
- Test on Freighter mobile wallet

## Medium-Term (Q4 2026)

### Milestone 4: Protocol Maturity
- e2e test suite with Playwright covering the create-vault → release lifecycle
- Integration tests connecting backend routes to a local Soroban sandbox
- OpenAPI/Swagger spec for the backend API
- Structured logging with correlation IDs across keeper watchers
- Scheduled security audits (`cargo audit`, `npm audit`) in CI
- Rate limiting and input validation on Express routes

## How to Contribute

Pick an issue labeled `good-first-issue` or comment on a milestone you'd like to help with.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and conventions.
