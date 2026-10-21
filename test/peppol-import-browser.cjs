#!/usr/bin/env node
/*
 * peppol-import-browser.cjs — the Peppol BIS rule files are not redistributed (no licence); the user loads
 * the official .sch files in the page ("Regelwerke laden"). This test proves for a real browser that
 *  1. the rule set compiled in the browser (src/sch-compiler.js with the browser host) is identical to the
 *     one compiled by the Node build (build/schemas/PEPPOL-*.json), apart from the recorded source names;
 *  2. the SHA-256 shown as "verified" is computed over the file bytes and equals the manifest value, and a
 *     modified file is reported as a deviating version;
 *  3. documents analysed after the import give the same findings as the Node pipeline with all rule sets;
 *  4. the imported rule set survives a reload (localStorage, where the browser provides it).
 *
 * Usage: node peppol-import-browser.cjs [--browser chromium|webkit|firefox] [--channel msedge|chrome]
 *          <peppol-bis-invoice-3 dir> <doc>...
 *   --channel: Microsoft Edge / Google Chrome installation of the machine instead of Playwright's Chromium build
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const { chromium, webkit, firefox } = tool.playwright();
const PrueferCore = require(path.join(__dirname, '..', 'src', 'pruefer-core.js'));
const { createEnv } = require(path.join(__dirname, '..', 'tools', 'node-env.cjs'));

const args = process.argv.slice(2);
const OPTS = ['--browser', '--channel'];
const optValue = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browserName = optValue('--browser', 'chromium');
const channel = optValue('--channel', null);
const label = channel || browserName;
const rest = args.filter((a, i) => !OPTS.includes(a) && !OPTS.includes(args[i - 1]));
const [pepDir, ...docs] = rest;
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'E-Rechnung-Pruefer.html');
const fullEnv = createEnv({});

const strip = (c) => { const o = JSON.parse(JSON.stringify(c)); delete o.sources; delete o.importedFrom; return o; };
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };

(async () => {
  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch(channel ? { channel } : {});
  // the implicit timezone of the page = the one of the Node side (tools/verify-all.cjs sets TZ=UTC); browsers on
  // Windows do not read TZ, so it is set explicitly (Playwright timezone emulation)
  const context = await browser.newContext(process.env.TZ ? { timezoneId: process.env.TZ } : {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(tool.fileUrl(dist));
  await page.waitForSelector('#ruleimport input[type=file]', { state: 'attached' });
  console.log(label + ' ' + browser.version() + ' (' + process.platform + '): Peppol import test');

  for (const id of ['PEPPOL-UBL', 'PEPPOL-CII']) {
    const file = path.join(pepDir, 'rules', 'sch', id.replace('PEPPOL-', 'PEPPOL-EN16931-') + '.sch');
    await page.setInputFiles('#ruleimport input[type=file]', file);
    await page.waitForFunction((i) => window.PrueferApp.imported[i], id, { timeout: 120000 });
    const got = await page.evaluate((i) => window.PrueferApp.imported[i], id);
    const ref = JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', id + '.json'), 'utf8'));
    const ga = JSON.stringify(strip(got)), rb = JSON.stringify(strip(ref));
    if (ga !== rb) { let i = 0; while (i < ga.length && ga[i] === rb[i]) i++; console.log('    first difference at ' + i + '\n    browser: ' + ga.slice(Math.max(0, i - 120), i + 120) + '\n    node:    ' + rb.slice(Math.max(0, i - 120), i + 120)); }
    check(ga === rb, id + ': compiled in the browser = Node build (' + got.stats.asserts + ' asserts)');
    check(got.importedFrom.verified === true && got.importedFrom.sha256 === ref.sources[0].sha256, id + ': SHA-256 over bytes = manifest (' + got.importedFrom.sha256.slice(0, 16) + '…)');
  }
  const status = await page.locator('#ruleimport').textContent();
  check(/SHA-256 entspricht/.test(status), 'status line shows the verified version');

  // a modified file (one extra comment) must be reported as a deviating version
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pep-'));
  const modified = path.join(tmp, 'PEPPOL-EN16931-UBL.sch');
  fs.writeFileSync(modified, fs.readFileSync(path.join(pepDir, 'rules', 'sch', 'PEPPOL-EN16931-UBL.sch'), 'utf8') + '\n<!-- modified -->\n');
  await page.setInputFiles('#ruleimport input[type=file]', modified);
  await page.waitForFunction(() => window.PrueferApp.imported['PEPPOL-UBL'] && window.PrueferApp.imported['PEPPOL-UBL'].importedFrom.verified === false, null, { timeout: 120000 });
  check(/ABWEICHENDE Version/.test(await page.locator('#ruleimport').textContent()), 'modified file reported as deviating version');
  // restore the official file
  await page.setInputFiles('#ruleimport input[type=file]', path.join(pepDir, 'rules', 'sch', 'PEPPOL-EN16931-UBL.sch'));
  await page.waitForFunction(() => window.PrueferApp.imported['PEPPOL-UBL'].importedFrom.verified === true, null, { timeout: 120000 });

  // persistence across reload
  await page.reload();
  await page.waitForSelector('#ruleimport input[type=file]', { state: 'attached' });
  const persisted = await page.evaluate(() => Object.keys(window.PrueferApp.imported).sort().join(','));
  console.log('  info persisted after reload: ' + (persisted || '(none – browser has no localStorage for file:// pages)'));
  // where the browser offers storage to file:// pages, the official rule sets are kept: the rule set compiled in the
  // browser is byte for byte the one compiled by Node (its SHA-256 is in the page, build/importable.json)
  const storage = await page.evaluate(() => { try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); return true; } catch (e) { return false; } });
  if (storage) check(persisted === 'PEPPOL-CII,PEPPOL-UBL', 'official rule sets kept in the browser storage across a reload (compiled in the browser = compiled by Node, integrity check of src/app.js)');

  // documents with the imported rules = Node with all rule sets
  if (persisted !== 'PEPPOL-CII,PEPPOL-UBL') {
    for (const id of ['PEPPOL-UBL', 'PEPPOL-CII']) {
      const file = path.join(pepDir, 'rules', 'sch', id.replace('PEPPOL-', 'PEPPOL-EN16931-') + '.sch');
      await page.setInputFiles('#ruleimport input[type=file]', file);
      await page.waitForFunction((i) => window.PrueferApp.imported[i], id, { timeout: 120000 });
    }
  }
  for (const doc of docs) {
    const before = await page.locator('section.result').count();
    await page.setInputFiles('#file', doc);
    await page.waitForFunction((n) => document.querySelectorAll('section.result').length > n && document.getElementById('status').hidden, before, { timeout: 120000 });
    const r = await page.evaluate(() => { const x = window.PrueferApp.results[0]; return { ids: (x.allFindings || []).map((f) => f.id + '|' + f.level).sort(), route: x.route, missing: x.missingRuleSets || [] }; });
    const n = await PrueferCore.analyzeBytes(fullEnv, new Uint8Array(fs.readFileSync(doc)), path.basename(doc));
    const exp = (n.allFindings || []).map((f) => f.id + '|' + f.level).sort();
    check(JSON.stringify(r.ids) === JSON.stringify(exp) && r.missing.length === 0, path.basename(doc) + ': ' + r.ids.length + ' findings, identical to Node with all rule sets, route ' + JSON.stringify(r.route && (r.route.ruleSets || r.route)));
  }
  // the loaded rule sets can be deleted again: from memory and from localStorage (legal/datenschutz.txt;
  // docs/SICHERHEIT.md, Anhang I Teil I Nr. 2 Buchst. m)
  await page.evaluate(() => { document.getElementById('ruleimport').closest('details').open = true; }); // the section a user opens
  await page.click('#ruleimport button[data-action="clear-rules"]');
  const cleared = await page.evaluate(() => ({ imported: Object.keys(window.PrueferApp.imported).length, stored: (() => { try { return Object.keys(localStorage).filter((k) => k.startsWith('e-rechnung-pruefer.ruleset.')).length; } catch (e) { return 0; } })() }));
  check(cleared.imported === 0 && cleared.stored === 0, 'loaded rule sets deleted from memory and localStorage (' + JSON.stringify(cleared) + ')');
  check((await page.locator('#ruleimport button[data-action="clear-rules"]').count()) === 0 && /nicht geladen/.test(await page.locator('#ruleimport').textContent()), 'after deleting: no delete button, rule sets shown as not loaded');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  await browser.close();
  console.log('PEPPOL IMPORT ' + label + ': ' + (fails ? fails + ' FAILED' : 'OK'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
