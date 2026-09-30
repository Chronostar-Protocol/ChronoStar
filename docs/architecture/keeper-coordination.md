# Keeper coordination design

## Goal

Prevent two independent keepers from paying to execute the same ChronoStar action while preserving liveness if a keeper crashes. Coordination is optional so existing single-keeper deployments continue unchanged.

## Contract model

The `keeper-coordinator` Soroban contract stores:

- a registry keyed by keeper address;
- a claim keyed by `(resource, id)`, where `resource` distinguishes `vault`, `stream`, and `dca` IDs;
- each claim's owner and exclusive `expires_at` ledger.

Any address may register itself, supporting a future permissionless keeper set. Registration and claim acquisition require that address's authorization. `claim(resource, id, keeper, ttl_ledgers)` succeeds when no live claim exists, when the previous claim has expired, or when the same keeper renews it. TTL must be non-zero and is capped to limit accidental long-lived locks. A claim is live while `current_ledger < expires_at`; therefore a crashed keeper can delay work only until that explicit ledger.

The contract emits registration, claim, and release events. Claims use persistent storage and extend their storage TTL beyond the logical lock TTL; logical expiry never depends on Soroban entry eviction.

## Keeper flow

When `COORDINATOR_CONTRACT_ID` is configured, a watcher:

1. asks the coordinator to claim the resource and schedule ID using `COORDINATOR_LOCK_TTL_LEDGERS`;
2. invokes the scheduled action only if the claim returns `true`;
3. best-effort releases its claim after the invocation, whether it succeeds or fails.

Without `COORDINATOR_CONTRACT_ID`, watchers retain their current behavior. The lock TTL should exceed the expected transaction settlement time but remain short enough for another keeper to retry after a crash. Contention is safe: Soroban serializes claim transactions, so only one keeper observes an available claim.

## Failure behavior

- Keeper crashes after claiming: another keeper proceeds at `expires_at`.
- Invocation fails: the keeper releases best-effort; expiry remains the fallback.
- Release fails: expiry restores liveness.
- Duplicate polling by the lock owner: renewing the claim is allowed.
- Unregistered keeper: claim fails until it registers itself.

## Compatibility and rollout

Deploy and initialize the coordinator, register each keeper address, then set the two coordinator environment variables on participating keeper instances. Mixed coordinated and uncoordinated keepers are unsafe; all keepers targeting the same schedules must opt in during the rollout.
