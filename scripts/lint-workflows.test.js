import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateWorkflows } from './lint-workflows.js';

describe('Workflow Validation (#439)', () => {
  it('validates all existing workflow YAML files with zero errors', () => {
    const res = validateWorkflows();
    assert.strictEqual(res.valid, true, `Workflow validation errors: ${res.errors.join(', ')}`);
    assert.ok(res.checkedCount >= 8, 'Must check at least 8 workflows');
  });
});
