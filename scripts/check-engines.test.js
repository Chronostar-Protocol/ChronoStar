import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('check-engines script', () => {
  it('exits with code 0 on supported Node 22+ runtime', () => {
    const scriptPath = path.resolve('scripts/check-engines.js');
    const output = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.match(output, /Node\.js runtime/);
  });
});
