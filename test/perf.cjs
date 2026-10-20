#!/usr/bin/env node
/*
 * perf.cjs — reproducible performance measurement of the complete pipeline (encoding, XSD, Schematron,
 * report) for large invoices, in Node and in a real browser (the standalone page, file input).
 *
 * Test documents are generated, not stored: the business case 01.01a-INVOICE_ubl.xml of the XRechnung
 * test suite with its first invoice line repeated N times (new line IDs; the totals no longer add up, so
 * the documents produce a few findings — the rules are evaluated over every line either way).
 *
 * Budgets (target values, not guarantees; they hold on the development sandbox and are checked on the
 * GitHub runner): wall time per document in the browser after one warm-up document (the cold start is
 * reported separately).
 *   100 lines ≤ 3 s · 500 lines ≤ 8 s · 2000 lines ≤ 30 s
 * The report records CPU model, core count, Node and browser versions, so that numbers from different
 * machines are not compared blindly.
 *
 * Usage: node perf.cjs <xrechnung-testsuite dir> [--browser chromium|webkit|firefox] [--sizes 100,500,2000]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const PrueferCore = require(path.join(__dirname, '..', 'src', 'pruefer-core.js'));
const { createEnv } = require(path.join(__dirname, '..', 'tools', 'node-env.cjs'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const suite = args.find((a, i) => !a.startsWith('--') && !['--browser', '--sizes'].includes(args[i - 1]));
const browserName = opt('--browser', 'chromium');
const sizes = opt('--sizes', '100,500,2000').split(',').map(Number);
const BUDGET = { 100: 3000, 500: 8000, 2000: 30000 };
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'E-Rechnung-Pruefer.html');

const src = fs.readFileSync(path.join(suite, 'src', 'test', 'business-cases', 'standard', '01.01a-INVOICE_ubl.xml'), 'utf8');
const line = /<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/.exec(src)[0];
function makeInvoice(n) {
  let lines = '';
  for (let i = 0; i < n; i++) lines += line.replace(/<cbc:ID>[^<]*<\/cbc:ID>/, '<cbc:ID>' + (1000 + i) + '</cbc:ID>') + '\n';
  return src.replace(line, lines);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const env = createEnv({ exclude: /^PEPPOL-/ });
  const { [browserName]: engine } = require(path.join(__dirname, 'resolve-tool.cjs')).playwright();
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.goto('file://' + dist);
  await page.waitForSelector('#drop');
  console.log('# machine: ' + os.cpus()[0].model + ' × ' + os.cpus().length + ', ' + Math.round(os.totalmem() / 2 ** 30) + ' GiB, Node ' + process.version + ', ' + browserName + ' ' + browser.version());
  let fails = 0;
  // cold start (first document after loading the page: XPath compilation, JIT) measured separately
  { const f = path.join(tmp, 'warmup.xml'); fs.writeFileSync(f, src); const c0 = Date.now(); await page.setInputFiles('#file', f);
    await page.waitForFunction(() => document.querySelectorAll('section.result').length > 0 && document.getElementById('status').hidden, null, { timeout: 300000 });
    const cb = Date.now() - c0;
    const c1 = process.hrtime.bigint(); await PrueferCore.analyzeBytes(env, new Uint8Array(fs.readFileSync(f)), 'warmup.xml');
    console.log('cold start (1 line, first document): ' + browserName + ' ' + cb + ' ms, node ' + (Number(process.hrtime.bigint() - c1) / 1e6).toFixed(0) + ' ms'); }
  for (const n of sizes) {
    const file = path.join(tmp, 'invoice-' + n + '-lines.xml');
    fs.writeFileSync(file, makeInvoice(n));
    const bytes = new Uint8Array(fs.readFileSync(file));
    const t0 = process.hrtime.bigint();
    const r = await PrueferCore.analyzeBytes(env, bytes, path.basename(file));
    const nodeMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const nodeIds = r.allFindings.map((f) => f.id + '|' + f.level).sort();
    const before = await page.locator('section.result').count();
    const t1 = Date.now();
    await page.setInputFiles('#file', file);
    await page.waitForFunction((k) => document.querySelectorAll('section.result').length > k && document.getElementById('status').hidden, before, { timeout: 300000 });
    const wall = Date.now() - t1;
    const b = await page.evaluate(() => { const x = window.PrueferApp.results[0]; return { timing: x.timing, ids: (x.allFindings || []).map((f) => f.id + '|' + f.level).sort() }; });
    const same = JSON.stringify(b.ids) === JSON.stringify(nodeIds);
    const budget = BUDGET[n];
    const within = budget ? wall <= budget : true;
    if (!same || !within) fails++;
    console.log(`${String(n).padStart(5)} lines, ${(bytes.length / 1024).toFixed(0)} KiB: node ${nodeMs.toFixed(0)} ms · ${browserName} ${wall} ms (analysis ${b.timing.total} ms, XSD ${b.timing.xsd} ms, rules ${JSON.stringify(b.timing.rules)})` +
      (budget ? ` · budget ${budget} ms ${within ? 'ok' : 'EXCEEDED'}` : '') + ` · findings ${same ? 'identical' : 'DIFFER'} (${b.ids.length})`);
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('performance ' + browserName + ': ' + (fails ? fails + ' FAILED' : 'OK'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
