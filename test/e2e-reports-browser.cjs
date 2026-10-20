#!/usr/bin/env node
/*
 * e2e-reports-browser.cjs — the files and the VAT display of the page in a real browser (Playwright: Chromium, WebKit,
 * Firefox; Microsoft Edge / Google Chrome of the machine with --channel), opened from file://, with a fixed clock and
 * time zone. Every download is compared byte for byte with what Node writes for the same documents (same engine
 * src/pruefer-core.js, same src/reports.js, same build data of the page, same time):
 *   per invoice: Prüfprotokoll (PDF), Lesefassung (PDF), the XML of a ZUGFeRD/Factur-X PDF, every BG-24 attachment;
 *   all files:   Prüfbericht (CSV), Rechnungsdaten (CSV), Positionen (CSV), JSON (without the run times).
 * In the page: the SHA-256 of every file (WebCrypto) equals Node's, the verdict box shows the verdict, the
 * Pflichtangaben tab one row per item with its status, the filter "nur umsatzsteuerlich bedeutsame" hides exactly the
 * findings without VAT relevance.
 *
 * Usage: node test/e2e-reports-browser.cjs [--browser chromium|webkit|firefox] [--channel msedge|chrome] <file>...
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const { chromium, webkit, firefox } = tool.playwright();
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const Reports = require(path.join(root, 'src', 'reports.js'));
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const legal = JSON.parse(fs.readFileSync(path.join(root, 'legal', 'ust-pflichtangaben.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browserName = opt('--browser', 'chromium');
const channel = opt('--channel', null);
const label = channel || browserName;
const files = args.filter((a, i) => !a.startsWith('--') && !['--browser', '--channel'].includes(args[i - 1]));
const dist = path.join(root, 'dist', 'E-Rechnung-Pruefer.html');
const NOW = new Date('2026-10-20T10:30:00Z');
const timezoneId = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); } };
const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
/** the JSON report without run times (they differ between two runs of the same engine) */
const stableJson = (text) => { const j = JSON.parse(text); for (const r of j.results) delete r.timing; return JSON.stringify(j); };

(async () => {
  // ---- Node: the same documents, newest first (as the page lists them) --------------------------------------------
  const env = createEnv({ exclude: /^PEPPOL-/ }); // like the page (Peppol rules are not embedded)
  const nodeResults = [];
  for (const f of files) nodeResults.unshift(await PrueferCore.analyzeBytes(env, new Uint8Array(fs.readFileSync(f)), path.basename(f)));
  const byName = new Map(nodeResults.map((r) => [r.name, r]));

  // ---- the browser ----------------------------------------------------------------------------------------------
  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch(channel ? { channel } : {});
  const version = browser.version();
  const context = await browser.newContext({ acceptDownloads: true, timezoneId });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(tool.fileUrl(dist));
  await page.waitForSelector('#drop');
  for (const f of files) {
    const before = await page.locator('section.result').count();
    await page.setInputFiles('#file', f);
    await page.waitForFunction((n) => document.querySelectorAll('section.result').length > n && document.getElementById('status').hidden, before, { timeout: 180000 });
  }
  const build = await page.evaluate(() => window.PRUEFER_BUILD);
  const ctx = { build, now: NOW, vat: legal };
  const download = async (locator) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), locator.click()]);
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
  };
  let downloads = 0;
  const cmpFile = (what, got, wantName, wantBytes) => {
    downloads++;
    check(label + ': ' + what + ' file name', got.name === wantName, got.name + ' vs ' + wantName);
    check(label + ': ' + what + ' bytes identical to Node', sameBytes(got.bytes, wantBytes), got.bytes.length + ' vs ' + wantBytes.length + ' bytes');
  };

  // ---- per invoice ---------------------------------------------------------------------------------------------
  const pageShas = await page.evaluate(() => window.PrueferApp.results.map((r) => [r.name, r.sha256]));
  for (const [name, sha] of pageShas) check(label + ': SHA-256 of ' + name + ' (page) = Node crypto', sha === crypto.createHash('sha256').update(fs.readFileSync(files.find((f) => path.basename(f) === name))).digest('hex'), sha);
  const cards = page.locator('section.result');
  const nCards = await cards.count();
  check(label + ': one card per file', nCards === files.length, nCards);
  for (let i = 0; i < nCards; i++) {
    const card = cards.nth(i);
    const name = await card.getAttribute('data-name');
    const r = byName.get(name);
    if (!r) { check(label + ': card ' + name + ' has a Node result', false); continue; }
    // verdict box
    if (r.ust) check(label + ': ' + name + ' verdict "' + r.ust.kurz + '"', (await card.locator('.ust .badge').first().textContent()).trim() === r.ust.kurz);
    // files of the invoice
    cmpFile(name + ' Prüfprotokoll', await download(card.locator('[data-action="protocol"]')), Reports.fileName(r, 'protocol', NOW), Reports.protocolPdf(r, ctx));
    if (r.model) cmpFile(name + ' Lesefassung', await download(card.locator('[data-action="invoice-pdf"]')), Reports.fileName(r, 'invoice', NOW), Reports.invoicePdf(r, ctx));
    else check(label + ': ' + name + ' no Lesefassung without invoice data', (await card.locator('[data-action="invoice-pdf"]').count()) === 0);
    const xml = r.pdf && r.pdf.files ? r.pdf.files.find((x) => x.name === r.pdf.invoiceAttachment) : null;
    if (xml) cmpFile(name + ' embedded XML', await download(card.locator('[data-action="xml"]')), xml.name, xml.bytes);
    // Pflichtangaben
    if (r.ust && r.ust.pflichtangaben) {
      await card.locator('[data-tab="pflicht"]').click();
      const rows = await card.locator('table.checklist tbody tr').evaluateAll((trs) => trs.map((tr) => tr.dataset.angabe + ':' + tr.dataset.status));
      check(label + ': ' + name + ' Pflichtangaben tab = checklist', JSON.stringify(rows) === JSON.stringify(r.ust.pflichtangaben.items.map((it) => it.id + ':' + it.status)), rows.join(','));
    }
    // attachments (BG-24)
    const att = Reports.attachmentFiles(r);
    if (att.length) {
      await card.locator('[data-tab="invoice"]').click();
      const buttons = card.locator('[data-action="attachment"]');
      check(label + ': ' + name + ' one download button per attachment', (await buttons.count()) === att.length);
      for (let k = 0; k < att.length; k++) cmpFile(name + ' attachment ' + att[k].name, await download(buttons.nth(k)), att[k].name, att[k].bytes);
    }
    // the filter "nur umsatzsteuerlich bedeutsame"
    if (r.allFindings && r.allFindings.some((f) => f.ust)) {
      await card.locator('[data-tab="report"]').click();
      const cb = card.locator('input[data-filter="ust"]');
      await cb.check();
      const visible = await card.locator('table.findings tbody tr').evaluateAll((trs) => trs.filter((tr) => !tr.hidden).length);
      check(label + ': ' + name + ' filter shows the VAT-relevant findings', visible === r.allFindings.filter((f) => !['ohne-bezug', 'zusatz'].includes(f.ust.klasse)).length, visible);
      await cb.uncheck();
    }
  }

  // ---- all files -------------------------------------------------------------------------------------------------
  cmpFile('Prüfbericht CSV', await download(page.locator('#csv')), 'E-Rechnung-Pruefbericht.csv', Buffer.from(Reports.findingsCsv(nodeResults, legal), 'utf8'));
  cmpFile('Rechnungsdaten CSV', await download(page.locator('#data-csv')), 'E-Rechnung-Rechnungsdaten.csv', Buffer.from(Reports.invoicesCsv(nodeResults), 'utf8'));
  cmpFile('Positionen CSV', await download(page.locator('#lines-csv')), 'E-Rechnung-Positionen.csv', Buffer.from(Reports.linesCsv(nodeResults), 'utf8'));
  {
    const got = await download(page.locator('#json'));
    downloads++;
    check(label + ': JSON file name', got.name === 'E-Rechnung-Pruefbericht.json');
    check(label + ': JSON identical to Node (without run times)', stableJson(got.bytes.toString('utf8')) === stableJson(Reports.jsonReport(nodeResults, ctx)));
  }
  check(label + ': overview lists the VAT verdict', (await page.locator('#summary th').allTextContents()).includes('USt-Einordnung'));
  check(label + ': no console errors', !consoleErrors.length, consoleErrors.slice(0, 3).join(' | '));
  await browser.close();
  for (const m of failures) console.log('FAIL ' + m);
  console.log(`E2E reports ${label} ${version} (${process.platform}, time zone ${timezoneId}): ${files.length} files, ${downloads} downloads compared with Node; ${pass + fail} checks, ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
