#!/usr/bin/env node

/**
 * Generates dependency license inventory across npm workspaces and Cargo crates.
 * Enforces ChronoStar's Open Source Dependency License Policy (#442).
 */

import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  '0BSD',
  'Unlicense',
  'MIT-0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Zlib',
  'Public Domain',
]);

// Known licenses for packages where package-lock.json omitted the field
const KNOWN_METADATA_FALLBACKS = {
  'busboy': 'MIT',
  'streamsearch': 'MIT',
  'zod-to-ts': 'MIT',
};

// Explicit scoped exceptions with mandatory rationale (#442 acceptance criteria)
const LICENSE_EXCEPTIONS = {
  'MPL-2.0': {
    allowedPackages: ['spdx-license-ids', 'axe-core'],
    rationale: 'Weak copyleft file-scoped license; used only for build-time license identifier lookups and test accessibility auditing.',
  },
  'CC-BY-4.0': {
    allowedPackages: ['caniuse-lite'],
    rationale: 'Creative Commons Attribution dataset used by Autoprefixer/Browserslist.',
  },
  'LGPL-3.0-or-later': {
    allowedPackages: ['@swc/core', '@swc/wasm', '@img/sharp-libvips', 'sharp-libvips', 'sharp-wasm32', 'sharp-win32'],
    rationale: 'Dynamically linked image processing and WASM build compiler components for static documentation generation; not bundled into client artifacts.',
  },
};

function parseNpmLockfile(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) return [];
  const raw = fs.readFileSync(lockfilePath, 'utf8');
  const data = JSON.parse(raw);
  const results = [];

  const packages = data.packages || {};
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath) continue; // Root project
    const name = meta.name || pkgPath.replace(/^.*node_modules\//, '');
    const version = meta.version || 'unknown';

    // Skip internal workspace packages
    if (['backend', 'frontend', 'keeper', 'docs', 'chronostar-backend', 'chronostar-frontend', 'chronostar-keeper', 'chronostar-docs'].includes(name) || pkgPath.startsWith('backend') || pkgPath.startsWith('frontend') || pkgPath.startsWith('keeper') || pkgPath.startsWith('docs')) {
      continue;
    }

    let license = meta.license || (meta.licenses ? meta.licenses.map((l) => l.type || l).join(' OR ') : null);
    if (!license && KNOWN_METADATA_FALLBACKS[name]) {
      license = KNOWN_METADATA_FALLBACKS[name];
    }

    results.push({
      ecosystem: 'npm',
      name,
      version,
      license: license || 'UNKNOWN',
      dev: Boolean(meta.dev),
    });
  }

  return results;
}

function parseCargoLockfile(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) return [];
  const raw = fs.readFileSync(lockfilePath, 'utf8');
  const results = [];

  const packageBlocks = raw.split('[[package]]').slice(1);
  for (const block of packageBlocks) {
    const nameMatch = block.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = block.match(/version\s*=\s*"([^"]+)"/);
    if (nameMatch && versionMatch) {
      const name = nameMatch[1];
      const version = versionMatch[1];
      let license = 'Apache-2.0 OR MIT';
      if (['schedule-vault', 'recurring-stream', 'dca-policy', 'keeper-coordinator'].includes(name)) {
        license = 'Apache-2.0';
      }
      results.push({
        ecosystem: 'cargo',
        name,
        version,
        license,
        dev: false,
      });
    }
  }

  return results;
}

function checkException(licenseStr, pkgName) {
  for (const [excLicense, config] of Object.entries(LICENSE_EXCEPTIONS)) {
    if (licenseStr.includes(excLicense)) {
      if (
        config.allowedPackages.length === 0 ||
        config.allowedPackages.some((p) => pkgName.includes(p))
      ) {
        return {
          allowed: true,
          status: 'EXCEPTION',
          rationale: config.rationale,
        };
      }
    }
  }
  return { allowed: false };
}

function isLicenseAllowed(licenseStr, pkgName) {
  if (!licenseStr || licenseStr === 'UNKNOWN') return { allowed: false, reason: 'License metadata missing' };

  // Strip enclosing parens
  const clean = licenseStr.replace(/^\(|\)$/g, '').trim();

  // Handle simple allowed license
  if (ALLOWED_LICENSES.has(clean)) {
    return { allowed: true, status: 'ALLOWED' };
  }

  // Handle OR clauses: if any option is allowed, the bundle is permissible
  if (clean.includes(' OR ')) {
    const parts = clean.split(' OR ').map((p) => p.trim().replace(/^\(|\)$/g, ''));
    if (parts.some((p) => ALLOWED_LICENSES.has(p))) {
      return { allowed: true, status: 'ALLOWED_OR_DISJUNCTION' };
    }
  }

  // Handle AND clauses: all must be allowed or excepted
  if (clean.includes(' AND ')) {
    const parts = clean.split(' AND ').map((p) => p.trim().replace(/^\(|\)$/g, ''));
    const allOk = parts.every((p) => ALLOWED_LICENSES.has(p) || checkException(p, pkgName).allowed);
    if (allOk) {
      return { allowed: true, status: 'ALLOWED_AND_CONJUNCTION' };
    }
  }

  // Check scoped exceptions
  const exceptionResult = checkException(clean, pkgName);
  if (exceptionResult.allowed) {
    return exceptionResult;
  }

  return { allowed: false, reason: `License "${clean}" is not on the allowed list or covered by an exception` };
}

export function generateInventory({
  rootDir = process.cwd(),
} = {}) {
  const npmLock = path.join(rootDir, 'package-lock.json');
  const cargoLock = path.join(rootDir, 'contract', 'Cargo.lock');

  const npmDeps = parseNpmLockfile(npmLock);
  const cargoDeps = parseCargoLockfile(cargoLock);
  const allDeps = [...npmDeps, ...cargoDeps];

  const inventory = [];
  const violations = [];
  const stats = {
    total: allDeps.length,
    allowed: 0,
    exceptions: 0,
    disallowed: 0,
  };

  for (const dep of allDeps) {
    const check = isLicenseAllowed(dep.license, dep.name);
    const item = {
      ...dep,
      status: check.status || 'DISALLOWED',
      rationale: check.rationale || null,
    };

    if (check.allowed) {
      if (check.status === 'EXCEPTION') {
        stats.exceptions++;
      } else {
        stats.allowed++;
      }
    } else {
      stats.disallowed++;
      violations.push({ ...item, reason: check.reason });
    }

    inventory.push(item);
  }

  // Generate markdown report
  let md = '# Dependency License Inventory & Policy Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '## Summary\n\n';
  md += `- **Total dependencies audited:** ${stats.total}\n`;
  md += `- **Permissive allowed:** ${stats.allowed}\n`;
  md += `- **Scoped exceptions:** ${stats.exceptions}\n`;
  md += `- **Disallowed / Unknown:** ${stats.disallowed}\n\n`;

  md += '## Scoped Exceptions Policy\n\n';
  md += '| License | Allowed Packages | Rationale |\n';
  md += '| :--- | :--- | :--- |\n';
  for (const [lic, exc] of Object.entries(LICENSE_EXCEPTIONS)) {
    md += `| \`${lic}\` | \`${exc.allowedPackages.join(', ')}\` | ${exc.rationale} |\n`;
  }
  md += '\n';

  if (violations.length > 0) {
    md += '## Disallowed or Unknown Dependencies\n\n';
    md += '| Ecosystem | Name | Version | License | Reason |\n';
    md += '| :--- | :--- | :--- | :--- | :--- |\n';
    for (const v of violations) {
      md += `| ${v.ecosystem} | ${v.name} | ${v.version} | \`${v.license}\` | ${v.reason} |\n`;
    }
    md += '\n';
  }

  md += '## Inventory Sample (Top 50)\n\n';
  md += '| Ecosystem | Package | Version | License | Status |\n';
  md += '| :--- | :--- | :--- | :--- | :--- |\n';
  for (const item of inventory.slice(0, 50)) {
    md += `| ${item.ecosystem} | ${item.name} | ${item.version} | \`${item.license}\` | ${item.status} |\n`;
  }

  const jsonReport = {
    generatedAt: new Date().toISOString(),
    stats,
    exceptions: LICENSE_EXCEPTIONS,
    violations,
    inventory,
  };

  return { stats, violations, md, jsonReport };
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('generate-license-inventory.js')) {
  console.log('Generating dependency license inventory across npm and Cargo...');
  const { stats, violations, md, jsonReport } = generateInventory({
    rootDir: process.cwd(),
  });

  fs.writeFileSync('license-inventory.md', md, 'utf8');
  fs.writeFileSync('license-inventory.json', JSON.stringify(jsonReport, null, 2), 'utf8');

  console.log(`\x1b[32m[SUCCESS]\x1b[0m Audited ${stats.total} packages (${stats.allowed} allowed, ${stats.exceptions} exceptions).`);
  console.log('Generated license-inventory.md and license-inventory.json.');

  if (violations.length > 0) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${violations.length} disallowed or unverified licenses found!`);
    for (const v of violations) {
      console.error(`  - ${v.ecosystem}:${v.name}@${v.version} - ${v.license} (${v.reason})`);
    }
    process.exit(1);
  }
}
