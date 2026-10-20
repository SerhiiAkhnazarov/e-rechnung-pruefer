#!/usr/bin/env node
/*
 * e2e-browser.cjs — opens dist/E-Rechnung-Pruefer.html in a real browser (Playwright/Chromium,
 * WebKit or Firefox when installed; Microsoft Edge or Google Chrome of the machine with --channel)
 * from file://, feeds documents through the file input and compares the findings shown in the page
 * with the Node engine's results for the same files.
 *
 * Usage: node e2e-browser.cjs [--browser chromium|webkit|firefox] [--channel msedge|chrome] [--screenshot dir] <file>...
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const { chromium, webkit, firefox } = tool.playwright();
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));
const PdfEmbedded = require(path.join(__dirname, '..', 'src', 'pdf-embedded.js'));

const args = process.argv.slice(2);
function opt(n, d) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }
const browserName = opt('--browser', 'chromium');
const channel = opt('--channel', null);
const label = channel || browserName;
const shotDir = opt('--screenshot', null);
const files = args.filter((a, i) => !a.startsWith('--') && !['--browser', '--channel', '--screenshot'].includes(args[i - 1]));
const dist = path.join(__dirname, '..', 'dist', 'E-Rechnung-Pruefer.html');
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'scenarios.json'), 'utf8'));
const PrueferCore = require(path.join(__dirname, '..', 'src', 'pruefer-core.js'));
const { createEnv } = require(path.join(__dirname, '..', 'tools', 'node-env.cjs'));
const nodeEnv = createEnv({ exclude: /^PEPPOL-/ }); // like the browser build (Peppol rules are not embedded)

/** the same pipeline in Node: all findings (encoding, PDF container, XSD, Schematron) as id|level */
async function nodeFindings(file) {
  const r = await PrueferCore.analyzeBytes(nodeEnv, new Uint8Array(fs.readFileSync(file)), path.basename(file));
  return (r.allFindings || []).map((f) => f.id + '|' + f.level).sort();
}

(async () => {
  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch(channel ? { channel } : {});
  // the implicit timezone of the page = the one of the Node side (tools/verify-all.cjs sets TZ=UTC); browsers on
  // Windows do not read TZ, so it is set explicitly (Playwright timezone emulation)
  const page = await browser.newPage(process.env.TZ ? { timezoneId: process.env.TZ } : {});
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(tool.fileUrl(dist));
  await page.waitForSelector('#drop');
  console.log(`${label} ${browser.version()} (${process.platform}): page loaded in ${Date.now() - t0} ms, title "${await page.title()}"`);
  let fails = 0;
  for (const file of files) {
    const t1 = Date.now();
    const before = await page.locator('section.result').count();
    await page.setInputFiles('#file', file);
    await page.waitForFunction((n) => document.querySelectorAll('section.result').length > n && document.getElementById('status').hidden, before, { timeout: 120000 });
    const card = page.locator('section.result').first();
    const badge = await card.locator('.badge').first().textContent();
    const counts = await card.locator('.counts .pill').allTextContents().catch(() => []);
    const shown = await card.locator('table.findings tbody tr').evaluateAll((rows) => rows.map((r) => r.querySelector('td:nth-child(2)').firstChild.textContent.trim() + '|' + ({ Fehler: 'error', Warnung: 'warning', Hinweis: 'information' })[r.querySelector('td:first-child .pill').textContent.trim()])).catch(() => []);
    const expected = await nodeFindings(file);
    const same = expected === null ? '(no node reference)' : JSON.stringify(shown.sort()) === JSON.stringify(expected) ? 'identical to Node engine' : 'DIFFERS from Node engine';
    if (same.startsWith('DIFFERS')) { fails++; console.log('   browser:', shown.sort().join(','), '\n   node:   ', expected.join(',')); }
    const timing = await page.evaluate(() => { const r = window.PrueferApp && window.PrueferApp.results && window.PrueferApp.results[0]; return r ? JSON.stringify(r.timing) : ''; }).catch(() => '');
    console.log(`  ${path.basename(file)}: ${badge} · ${counts.join(', ')} · ${shown.length} findings ${same} · ${Date.now() - t1} ms${timing ? ' · stages ' + timing : ''}`);
    if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, label + '-' + path.basename(file) + '.png'), fullPage: true }); }
  }
  if (shotDir && files.length) await page.screenshot({ path: path.join(shotDir, label + '-overview.png'), fullPage: false });
  if (consoleErrors.length) { console.log('console errors:', consoleErrors.slice(0, 5)); fails++; }
  await browser.close();
  console.log(fails ? `E2E ${label}: ${fails} problem(s)` : `E2E ${label}: OK`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
