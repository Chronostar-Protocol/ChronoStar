#!/usr/bin/env node

/**
 * Tracks optimized WASM contract sizes and enforces byte budgets (#438).
 */

import fs from 'node:fs';
import path from 'node:path';

// Budget limits in bytes
export const DEFAULT_BUDGETS = {
  'schedule_vault': {
    maxBytes: 65_536, // 64 KB
    description: 'Time-locked single and multi-recipient escrow vault',
  },
  'recurring_stream': {
    maxBytes: 65_536, // 64 KB
    description: 'Continuous linear streaming with cliffs, pauses, and splits',
  },
  'dca_policy': {
    maxBytes: 65_536, // 64 KB
    description: 'Automated dollar-cost averaging policy execution',
  },
  'keeper_coordinator': {
    maxBytes: 49_152, // 48 KB
    description: 'Decentralized keeper registration and coordination ledger',
  },
};

export function checkWasmBudgets({
  searchDirs = [
    'contract/target/wasm32-unknown-unknown/release',
    'contract/schedule-vault/target/wasm32-unknown-unknown/release',
    'contract/recurring-stream/target/wasm32-unknown-unknown/release',
    'contract/dca-policy/target/wasm32-unknown-unknown/release',
    'contract/keeper-coordinator/target/wasm32-unknown-unknown/release',
    'target/wasm32-unknown-unknown/release',
  ],
  budgets = DEFAULT_BUDGETS,
  mockSizes = null,
} = {}) {
  const report = [];
  const violations = [];

  for (const [name, config] of Object.entries(budgets)) {
    let size = null;
    let foundPath = null;

    if (mockSizes && mockSizes[name] !== undefined) {
      size = mockSizes[name];
      foundPath = `mock/${name}.wasm`;
    } else {
      for (const dir of searchDirs) {
        const candidate = path.resolve(dir, `${name}.wasm`);
        if (fs.existsSync(candidate)) {
          size = fs.statSync(candidate).size;
          foundPath = candidate;
          break;
        }
      }
    }

    if (size === null) {
      report.push({
        name,
        description: config.description,
        status: 'SKIPPED',
        size: null,
        maxBytes: config.maxBytes,
        percent: null,
      });
      continue;
    }

    const percent = ((size / config.maxBytes) * 100).toFixed(1);
    const passed = size <= config.maxBytes;

    const entry = {
      name,
      description: config.description,
      status: passed ? 'PASS' : 'EXCEEDED',
      size,
      maxBytes: config.maxBytes,
      diff: size - config.maxBytes,
      percent: `${percent}%`,
      path: foundPath,
    };

    if (!passed) {
      violations.push(entry);
    }
    report.push(entry);
  }

  // Generate markdown
  let md = '# Contract WASM Size Budget Report (#438)\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '| Contract | Size (bytes) | Budget (bytes) | Utilization | Status |\n';
  md += '| :--- | :--- | :--- | :--- | :--- |\n';
  for (const r of report) {
    const sizeStr = r.size !== null ? `${r.size.toLocaleString()} B` : 'Not Built';
    const budgetStr = `${r.maxBytes.toLocaleString()} B`;
    const statusStr = r.status === 'PASS' ? '✅ PASS' : r.status === 'EXCEEDED' ? '❌ EXCEEDED' : '⚪ SKIPPED';
    md += `| \`${r.name}.wasm\` | ${sizeStr} | ${budgetStr} | ${r.percent ?? 'N/A'} | ${statusStr} |\n`;
  }
  md += '\n';

  return {
    valid: violations.length === 0,
    report,
    violations,
    md,
    json: {
      generatedAt: new Date().toISOString(),
      budgets,
      report,
      violations,
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('check-wasm-budget.js')) {
  console.log('Checking contract WASM size budgets (#438)...');
  const res = checkWasmBudgets();

  fs.writeFileSync('wasm-size-report.md', res.md, 'utf8');
  fs.writeFileSync('wasm-size-report.json', JSON.stringify(res.json, null, 2), 'utf8');

  console.log('Generated wasm-size-report.md and wasm-size-report.json.');

  if (!res.valid) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${res.violations.length} contract(s) exceeded size budget!`);
    for (const v of res.violations) {
      console.error(`  - ${v.name}.wasm: ${v.size} bytes (Budget: ${v.maxBytes} bytes, Over by: +${v.diff} bytes)`);
    }
    process.exit(1);
  }

  console.log('\x1b[32m[SUCCESS]\x1b[0m All contract WASM artifacts are within configured size budgets.');
}
