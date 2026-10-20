#!/usr/bin/env node
/*
 * xsd-browser.cjs — runs src/xsd-validator.js inside a real browser (Playwright Chromium; WebKit
 * or Firefox when installed) on documents parsed with the browser's own DOMParser and compares the
 * verdicts AND the error lists (code + location) with the Node/slimdom run of the same engine.
 * This proves that the validator depends on nothing but the standard DOM and that the browser
 * result equals the Node result that was proven against Xerces.
 *
 * Usage: node test/xsd-browser.cjs [--browser chromium] [--every 10] [--report file]
 *   The sample: every N-th document of every build/oracle/xsd/*.jsonl list plus all probes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium, webkit, firefox } = require(path.join(__dirname, 'resolve-tool.cjs')).playwright();
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function opt(n, d) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }
const browserName = opt('--browser', 'chromium');
const every = parseInt(opt('--every', '10'), 10);
const reportFile = opt('--report', null);

const NS_CN = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const NS_CII = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const modelIds = ['UBL-Invoice-2.1', 'UBL-CreditNote-2.1', 'CII-D16B'];
const modelJson = {};
const nodeValidators = {};
for (const id of modelIds) {
  modelJson[id] = fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8');
  nodeValidators[id] = XV.create(JSON.parse(modelJson[id]));
}
function modelIdFor(ns) { return ns === NS_CN ? 'UBL-CreditNote-2.1' : ns === NS_CII ? 'CII-D16B' : 'UBL-Invoice-2.1'; }

const files = [];
const oracleDir = path.join(root, 'build', 'oracle', 'xsd');
for (const f of fs.readdirSync(oracleDir).filter((x) => x.endsWith('.jsonl')).sort()) {
  const rows = fs.readFileSync(path.join(oracleDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  rows.forEach((r, i) => { if (i % every === 0 || /probe__/.test(r.file)) files.push(path.isAbsolute(r.file) ? r.file : path.join(root, r.file)); });
}

(async () => {
  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><title>xsd-validator browser test</title></head><body></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'src', 'xsd-validator.js'), 'utf8') });
  await page.evaluate((models) => {
    window.__validators = {};
    for (const id of Object.keys(models)) window.__validators[id] = XsdValidator.create(JSON.parse(models[id]));
  }, modelJson);
  const ua = await page.evaluate(() => navigator.userAgent);
  const lines = [];
  const out = (s) => { lines.push(s); console.log(s); };
  out('xsd-validator in ' + browserName + ' (' + ua + ')');
  let n = 0, same = 0, diff = 0, parseDiff = 0, browserMs = 0;
  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');
    let nodeRes;
    try {
      const doc = slimdom.parseXmlDocument(xml);
      nodeRes = nodeValidators[modelIdFor(doc.documentElement.namespaceURI)].validate(doc);
    } catch (e) { nodeRes = null; }
    const br = await page.evaluate(({ xml, nsCn, nsCii }) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) return null;
      const ns = doc.documentElement.namespaceURI;
      const id = ns === nsCn ? 'UBL-CreditNote-2.1' : ns === nsCii ? 'CII-D16B' : 'UBL-Invoice-2.1';
      const t0 = performance.now();
      const r = window.__validators[id].validate(doc);
      return { valid: r.valid, errors: r.errors.map((e) => e.code + ' ' + e.location), ms: performance.now() - t0 };
    }, { xml, nsCn: NS_CN, nsCii: NS_CII });
    n++;
    if (!nodeRes || !br) { if (!nodeRes && !br) same++; else { parseDiff++; out('  parse difference: ' + file + ' node=' + (nodeRes ? 'parsed' : 'failed') + ' browser=' + (br ? 'parsed' : 'failed')); } continue; }
    browserMs += br.ms;
    const nodeErrs = nodeRes.errors.map((e) => e.code + ' ' + e.location);
    if (br.valid === nodeRes.valid && JSON.stringify(br.errors) === JSON.stringify(nodeErrs)) same++;
    else { diff++; out('  DIFF ' + file + '\n    node:    ' + nodeErrs.join(' | ') + '\n    browser: ' + br.errors.join(' | ')); }
  }
  out('documents ' + n + '   identical (verdict + error codes + locations) ' + same + '   differences ' + diff + '   parse differences ' + parseDiff + '   browser validation time ' + browserMs.toFixed(0) + ' ms');
  // run times of large invoices (100 / 500 / 2 000 lines, generated): test/perf.cjs
  await browser.close();
  if (reportFile) fs.appendFileSync(reportFile, '\n' + lines.join('\n') + '\n');
  process.exit(diff || parseDiff ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
