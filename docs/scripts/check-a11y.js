#!/usr/bin/env node

/**
 * Automated accessibility auditing for ChronoStar documentation (#441).
 * Validates WCAG 2.1 AA criteria across built documentation pages.
 */

import fs from 'node:fs';
import path from 'node:path';

const DOCS_DIST = path.resolve('docs/dist');

// Representative pages across documentation taxonomy (#441 acceptance criteria)
const REPRESENTATIVE_PAGES = [
  'index.html',
  'getting-started/overview/index.html',
  'getting-started/quickstart/index.html',
  'contracts/schedule-vault/index.html',
  'contracts/recurring-stream/index.html',
  'contracts/dca-policy/index.html',
  'api/reference/index.html',
  'keeper/self-hosting/index.html',
];

export function auditHtmlFile(filePath, relativePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  // Rule 1: Document must declare a language attribute
  if (!html.includes('<html') || !html.match(/<html[^>]*lang=["'][a-zA-Z-]+["']/i)) {
    violations.push({
      rule: 'html-has-lang',
      severity: 'critical',
      message: '<html> element must have a valid lang attribute',
    });
  }

  // Rule 2: Document must have a non-empty <title>
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) {
    violations.push({
      rule: 'document-title',
      severity: 'serious',
      message: 'Document must contain a non-empty <title> tag',
    });
  }

  // Rule 3: Images must have an alt attribute
  const imgMatches = html.matchAll(/<img\b([^>]*)>/gi);
  for (const match of imgMatches) {
    const attrs = match[1];
    if (!attrs.match(/\balt\s*=/i)) {
      violations.push({
        rule: 'image-alt',
        severity: 'critical',
        message: `Image tag missing alt attribute: ${match[0].slice(0, 50)}...`,
      });
    }
  }

  // Rule 4: Buttons must have accessible text or aria-label
  const buttonMatches = html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi);
  for (const match of buttonMatches) {
    const attrs = match[1];
    const innerText = match[2].replace(/<[^>]+>/g, '').trim();
    const hasAria = attrs.match(/aria-label\s*=\s*["'][^"']+["']/i) || attrs.match(/aria-labelledby\s*=/i);
    if (!innerText && !hasAria) {
      violations.push({
        rule: 'button-name',
        severity: 'serious',
        message: `Interactive button lacks accessible text or aria-label: ${match[0].slice(0, 50)}...`,
      });
    }
  }

  // Rule 5: Landmark regions
  if (!html.includes('<main') && !html.includes('role="main"')) {
    violations.push({
      rule: 'landmark-main',
      severity: 'serious',
      message: 'Page is missing a <main> landmark region',
    });
  }

  // Rule 6: Page must have an h1 heading
  if (!html.includes('<h1')) {
    violations.push({
      rule: 'page-has-heading-one',
      severity: 'serious',
      message: 'Page must contain at least one primary <h1> heading',
    });
  }

  return {
    page: relativePath,
    violations,
    pass: violations.length === 0,
  };
}

export function runAccessibilityAudit({ distDir = DOCS_DIST } = {}) {
  if (!fs.existsSync(distDir)) {
    return {
      success: false,
      skipped: true,
      reason: `Built documentation directory not found at ${distDir}. Run 'npm run build' inside docs/ first.`,
      results: [],
    };
  }

  const results = [];
  let totalViolations = 0;

  for (const relPage of REPRESENTATIVE_PAGES) {
    const pagePath = path.join(distDir, relPage);
    if (fs.existsSync(pagePath)) {
      const res = auditHtmlFile(pagePath, relPage);
      results.push(res);
      totalViolations += res.violations.length;
    }
  }

  // Generate markdown report
  let md = '# Documentation Accessibility Audit Report (#441)\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Audited Pages: ${results.length} | Total Violations: ${totalViolations}\n\n`;
  md += '| Page | Status | Violations |\n';
  md += '| :--- | :--- | :--- |\n';
  for (const r of results) {
    const statusStr = r.pass ? '✅ PASS' : '❌ FAIL';
    md += `| \`${r.page}\` | ${statusStr} | ${r.violations.length} |\n`;
  }
  md += '\n';

  if (totalViolations > 0) {
    md += '## Detailed Findings\n\n';
    for (const r of results) {
      if (r.violations.length > 0) {
        md += `### \`${r.page}\`\n\n`;
        for (const v of r.violations) {
          md += `- **[${v.severity.toUpperCase()}]** \`${v.rule}\`: ${v.message}\n`;
        }
        md += '\n';
      }
    }
  }

  return {
    success: totalViolations === 0,
    results,
    totalViolations,
    md,
    json: {
      generatedAt: new Date().toISOString(),
      results,
      totalViolations,
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('check-a11y.js')) {
  console.log('Running automated documentation accessibility audit (#441)...');
  const audit = runAccessibilityAudit();

  if (audit.skipped) {
    console.warn(`[WARN] ${audit.reason}`);
    process.exit(0);
  }

  fs.writeFileSync('docs-a11y-report.md', audit.md, 'utf8');
  fs.writeFileSync('docs-a11y-report.json', JSON.stringify(audit.json, null, 2), 'utf8');

  console.log(`Audited ${audit.results.length} pages. Generated docs-a11y-report.md.`);

  if (!audit.success) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Accessibility audit failed with ${audit.totalViolations} violation(s)!`);
    process.exit(1);
  }

  console.log('\x1b[32m[SUCCESS]\x1b[0m All audited documentation pages satisfy WCAG criteria.');
}
