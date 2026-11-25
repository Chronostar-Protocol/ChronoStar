import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runCoordinated } from './coordination.js';

class MockCoordinatorContract {
  constructor() {
    this.claims = new Map(); // key -> { keeper, expiresAt }
    this.currentLedger = 100;
  }

  claim(resource, id, keeper, ttlLedgers = 10) {
    const key = `${resource}:${id}`;
    const existing = this.claims.get(key);
    if (existing && existing.expiresAt > this.currentLedger && existing.keeper !== keeper) {
      return false; // lock held by another keeper
    }
    this.claims.set(key, {
      keeper,
      expiresAt: this.currentLedger + ttlLedgers,
    });
    return true;
  }

  release(resource, id, keeper) {
    const key = `${resource}:${id}`;
    const existing = this.claims.get(key);
    if (!existing || existing.keeper !== keeper) {
      return false;
    }
    this.claims.delete(key);
    return true;
  }

  advanceLedgers(count) {
    this.currentLedger += count;
  }
}

class SandboxKeeperClient {
  constructor(name, coordinator) {
    this.name = name;
    this.coordinator = coordinator;
    this.executedActions = [];
  }

  async claimExecution(resource, id, ttl = 10) {
    return this.coordinator.claim(resource, id, this.name, ttl);
  }

  async releaseExecution(resource, id) {
    return this.coordinator.release(resource, id, this.name);
  }
}

describe('Coordination Sandbox Integration Test (#437)', () => {
  it('prevents duplicate action execution when two keepers contend for the same resource', async () => {
    const coordinator = new MockCoordinatorContract();
    const keeperA = new SandboxKeeperClient('keeper-alpha', coordinator);
    const keeperB = new SandboxKeeperClient('keeper-bravo', coordinator);

    let executionCount = 0;
    const executeAction = async (keeperName) => {
      executionCount++;
      return `executed-by-${keeperName}`;
    };

    // Keeper A and Keeper B contend simultaneously on vault #101
    let keeperAExecuted = false;
    let keeperBExecuted = false;

    const promiseA = runCoordinated(keeperA, 'vault', 101, async () => {
      // Simulate in-flight work while holding lock
      assert.strictEqual(coordinator.claims.get('vault:101')?.keeper, 'keeper-alpha');
      keeperAExecuted = true;
      await executeAction(keeperA.name);
    });

    // Keeper B attempts claim while A holds lock
    const claimBResult = await runCoordinated(keeperB, 'vault', 101, async () => {
      keeperBExecuted = true;
      await executeAction(keeperB.name);
    });

    await promiseA;

    // Verify only Keeper A ran, Keeper B was locked out
    assert.strictEqual(keeperAExecuted, true);
    assert.strictEqual(keeperBExecuted, false);
    assert.strictEqual(claimBResult, false);
    assert.strictEqual(executionCount, 1);

    // After A finished, claim was released
    assert.strictEqual(coordinator.claims.has('vault:101'), false);
  });

  it('allows second keeper to claim after the first claim expires by ledger TTL', async () => {
    const coordinator = new MockCoordinatorContract();
    const keeperA = new SandboxKeeperClient('keeper-alpha', coordinator);
    const keeperB = new SandboxKeeperClient('keeper-bravo', coordinator);

    // Keeper A claims vault #202 with TTL of 5 ledgers, but crashes without releasing
    const claimedA = await keeperA.claimExecution('vault', 202, 5);
    assert.strictEqual(claimedA, true);

    // While unexpired, Keeper B cannot claim
    assert.strictEqual(await keeperB.claimExecution('vault', 202), false);

    // Ledger advances past expiration (TTL = 5)
    coordinator.advanceLedgers(6);

    // Now Keeper B successfully acquires expired claim
    let keeperBExecuted = false;
    const resultB = await runCoordinated(keeperB, 'vault', 202, async () => {
      keeperBExecuted = true;
    });

    assert.strictEqual(resultB, true);
    assert.strictEqual(keeperBExecuted, true);
  });

  it('guarantees mutual exclusion across 10 concurrent contending attempts', async () => {
    const coordinator = new MockCoordinatorContract();
    const keepers = Array.from({ length: 10 }, (_, i) => new SandboxKeeperClient(`keeper-${i}`, coordinator));

    let runCounter = 0;
    const results = await Promise.all(
      keepers.map((k) =>
        runCoordinated(k, 'dca', 777, async () => {
          runCounter++;
          // Simulate latency
          await new Promise((resolve) => setTimeout(resolve, 10));
        })
      )
    );

    // Exactly one keeper must succeed in acquiring lock and running
    const successfulRuns = results.filter(Boolean).length;
    assert.strictEqual(successfulRuns, 1);
    assert.strictEqual(runCounter, 1);
  });
});
