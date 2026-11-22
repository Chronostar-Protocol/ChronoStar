#!/usr/bin/env node

/**
 * Validates local Node.js engine version against project requirements.
 * Emits actionable instructions if running on an unsupported runtime.
 */

const requiredMajor = 22;
const currentVersion = process.versions.node;
const currentMajor = parseInt(currentVersion.split('.')[0], 10);

if (Number.isNaN(currentMajor) || currentMajor < requiredMajor) {
  console.error('\n\x1b[31m[ERROR] Unsupported Node.js version detected!\x1b[0m');
  console.error(`Current version:  v${currentVersion}`);
  console.error(`Required version: >=${requiredMajor}.0.0 (Node 22 LTS or newer)\n`);
  console.error('To resolve this, please install or switch to Node.js 22:');
  console.error('  - If using nvm:           nvm install 22 && nvm use 22');
  console.error('  - If using fnm:           fnm use 22');
  console.error('  - If using volta:         volta install node@22');
  console.error('  - Direct download:        https://nodejs.org/en/download/\n');
  process.exit(1);
}

console.log(`\x1b[32m[OK]\x1b[0m Node.js runtime v${currentVersion} meets requirement (>=${requiredMajor}.0.0).`);
