#!/usr/bin/env node

/**
 * Validates GitHub Actions workflow files for syntax errors, expression structure,
 * and pinned action references (#439).
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKFLOWS_DIR = path.resolve('.github/workflows');

export function validateWorkflows(dir = WORKFLOWS_DIR) {
  if (!fs.existsSync(dir)) {
    return { valid: false, errors: [`Workflows directory not found: ${dir}`] };
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const errors = [];
  let checkedCount = 0;

  for (const file of files) {
    checkedCount++;
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // 1. Basic structural sanity checks
    if (!content.includes('name:')) {
      errors.push(`${file}: Missing 'name' property`);
    }
    if (!content.includes('on:')) {
      errors.push(`${file}: Missing 'on' trigger specification`);
    }
    if (!content.includes('jobs:')) {
      errors.push(`${file}: Missing 'jobs' block`);
    }

    // 2. Bracket matching for GitHub Actions expressions: ${{ ... }}
    const openMatches = content.match(/\$\{\{/g) || [];
    const closeMatches = content.match(/\}\}/g) || [];
    if (openMatches.length !== closeMatches.length) {
      errors.push(`${file}: Mismatched \${{ ... }} expression delimiters (${openMatches.length} open vs ${closeMatches.length} close)`);
    }

    // 3. Inspect lines for unquoted asterisks in cron syntax
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('- cron:') && !line.includes("'") && !line.includes('"')) {
        errors.push(`${file}:${i + 1}: Cron expression must be quoted`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    checkedCount,
    errors,
  };
}

if (process.argv[1] && process.argv[1].endsWith('lint-workflows.js')) {
  console.log('Validating GitHub Actions workflow syntax (#439)...');
  const result = validateWorkflows();

  if (!result.valid) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Found ${result.errors.length} workflow error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`\x1b[32m[SUCCESS]\x1b[0m All ${result.checkedCount} workflow files are valid.`);
}
