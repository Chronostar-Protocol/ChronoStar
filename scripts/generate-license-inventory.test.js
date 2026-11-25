import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateInventory } from './generate-license-inventory.js';

describe('Dependency License Inventory Generator (#442)', () => {
  it('generates an inventory with zero unapproved license violations', () => {
    const { stats, violations, md, jsonReport } = generateInventory({
      rootDir: process.cwd(),
    });

    assert.ok(stats.total > 0, 'Total audited dependencies must be greater than zero');
    assert.ok(stats.allowed > 0, 'Allowed dependencies must be greater than zero');
    assert.strictEqual(stats.disallowed, 0, `Disallowed dependencies found: ${JSON.stringify(violations)}`);
    assert.strictEqual(violations.length, 0);

    // Markdown assertions
    assert.match(md, /# Dependency License Inventory & Policy Report/);
    assert.match(md, /Scoped Exceptions Policy/);

    // JSON report assertions
    assert.ok(jsonReport.inventory.length > 0);
    assert.ok(jsonReport.exceptions['MPL-2.0']);
  });
});
