import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditHtmlFile, runAccessibilityAudit } from './check-a11y.js';

describe('Documentation Accessibility Checker (#441)', () => {
  it('detects missing alt attributes and missing lang attribute', () => {
    const fixtureDir = path.resolve('docs/scripts/.test-fixtures');
    if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

    const badHtmlPath = path.join(fixtureDir, 'bad.html');
    fs.writeFileSync(
      badHtmlPath,
      '<html><head><title>Test</title></head><body><main><h1>Title</h1><img src="pic.jpg"></main></body></html>'
    );

    const audit = auditHtmlFile(badHtmlPath, 'bad.html');
    assert.strictEqual(audit.pass, false);
    assert.ok(audit.violations.some((v) => v.rule === 'html-has-lang'));
    assert.ok(audit.violations.some((v) => v.rule === 'image-alt'));

    // Cleanup
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('passes on valid semantic accessible HTML', () => {
    const fixtureDir = path.resolve('docs/scripts/.test-fixtures');
    if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

    const goodHtmlPath = path.join(fixtureDir, 'good.html');
    fs.writeFileSync(
      goodHtmlPath,
      '<html lang="en"><head><title>Test Valid Page</title></head><body><main><h1>Title</h1><img src="pic.jpg" alt="Description"></main></body></html>'
    );

    const audit = auditHtmlFile(goodHtmlPath, 'good.html');
    assert.strictEqual(audit.pass, true);
    assert.strictEqual(audit.violations.length, 0);

    // Cleanup
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
});
