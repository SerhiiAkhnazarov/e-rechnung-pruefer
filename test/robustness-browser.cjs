#!/usr/bin/env node
/*
 * robustness-browser.cjs — the hostile files of test/robustness-inputs.cjs through the page itself
 * (dist/E-Rechnung-Pruefer.html from file://) in a real browser: Chromium, WebKit or Firefox (Playwright), Microsoft
 * Edge or Google Chrome of the machine (--channel). For every file the page must show a result card – no exception in
 * the page, no hang – and stay responsive; the page must not request anything but itself (no network, no file other
 * than the page: every request is recorded) and a local listener addressed by external entities must see no
 * connection; no content of a local file may appear. Where the result is fixed by the program (depth limit, stream
 * limits of PDFs, file size limit) the verdict is checked; how a browser's own XML parser treats entity expansion is
 * recorded per browser.
 *
 * Usage: node test/robustness-browser.cjs [--browser chromium|webkit|firefox] [--channel msedge|chrome]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const { chromium, webkit, firefox } = tool.playwright();
const I = require(path.join(__dirname, 'robustness-inputs.cjs'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browserName = opt('--browser', 'chromium');
const channel = opt('--channel', null);
const label = channel || browserName;
const dist = path.join(__dirname, '..', 'dist', 'E-Rechnung-Pruefer.html');

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' – ' + detail : '')); } };

(async () => {
  // a local listener: any connection (HTTP from an external entity, a DTD, anything) is counted
  let connections = 0;
  const server = net.createServer((s) => { connections++; s.destroy(); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;

  // the files (written to a temporary directory: the file input takes paths)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pruefer-robustness-'));
  const bomb200 = I.zeroBomb(200 * 1048576), bomb60 = I.zeroBomb(60 * 1048576);
  const six = {}; for (let i = 1; i <= 6; i++) six['anlage-' + i + '.bin'] = { deflated: bomb60 };
  // a document type declaration is refused before parsing (src/pruefer-core.js, as the KoSIT validator does):
  // entity expansion and external entities never reach the XML parser of the browser
  const DOCTYPE = (r) => /Dokumenttyp-Deklaration \(DOCTYPE\)/.test(r.xml && r.xml.parseError || '');
  const cases = [
    // [file name, bytes, expectation: { verdict, test(result) + testName }]
    ['billion-laughs.xml', I.billionLaughs(), { verdict: 'format', test: DOCTYPE, testName: 'refused before parsing (DOCTYPE)' }],
    ['quadratic-blowup.xml', I.quadraticBlowup(), { verdict: 'format', test: DOCTYPE, testName: 'refused before parsing (DOCTYPE)' }],
    ['xxe.xml', I.xxe(port), { verdict: 'format', test: (r) => DOCTYPE(r) && !I.LEAK.test(JSON.stringify(r)), testName: 'refused before parsing (DOCTYPE), no content of a local file in the result' }],
    ['doctype-harmless.xml', I.utf8('<?xml version="1.0"?>\n<!DOCTYPE Invoice>\n<Invoice xmlns="' + I.UBL + '"><Note xmlns="' + I.CBC + '">x</Note></Invoice>'), { verdict: 'format', test: DOCTYPE, testName: 'refused like the KoSIT validator' }],
    ['nesting-5001.xml', I.nested(5001), { verdict: 'format' }],
    ['nesting-200000.xml', I.nested(200000), { verdict: 'format' }],
    ['nesting-5000.xml', I.nested(5000), {}],
    ['random.bin', I.randomBytes(1 << 20, 0x12345678), {}],
    ['bomb-200mib.pdf', I.pdf({ 'factur-x.xml': { deflated: bomb200 } }), { verdict: 'keine-xml', test: (r) => (r.pdf && r.pdf.warnings || []).some((w) => /überschreitet die Grenze von 64 MiB/.test(w)), testName: 'refused with the stream limit' }],
    ['six-60mib.pdf', I.pdf(six), { test: (r) => (r.pdf && r.pdf.warnings || []).some((w) => /überschreiten die Grenze von 256 MiB/.test(w)) && (r.pdf.attachments || []).length === 4, testName: 'four decoded, the rest refused with the document limit' }],
    ['arrays-100000.pdf', I.pdf({}, ['['.repeat(100000) + ']'.repeat(100000)]), { verdict: 'keine-xml' }],
  ];
  for (const [name, bytes] of cases) fs.writeFileSync(path.join(dir, name), bytes);
  // larger than the file limit of the page (100 MB): a sparse file of 101 MiB
  const big = path.join(dir, 'gross-101mib.xml');
  { const fd = fs.openSync(big, 'w'); fs.writeSync(fd, Buffer.from('<?xml version="1.0"?><x>'), 0, 24, 0); fs.ftruncateSync(fd, 101 * 1048576); fs.closeSync(fd); }

  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch(channel ? { channel } : {});
  const context = await browser.newContext(process.env.TZ ? { timezoneId: process.env.TZ } : {});
  const requests = [];
  context.on('request', (r) => requests.push(r.url()));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const pageUrl = tool.fileUrl(dist);
  await page.goto(pageUrl);
  await page.waitForSelector('#drop');
  console.log(label + ' ' + browser.version() + ' (' + process.platform + '): page loaded');

  const verdicts = {};
  let closed = null; // the page or the browser went away (a crash of the tab): every further case is a failure
  page.on('close', () => { closed = closed || 'page closed'; });
  page.on('crash', () => { closed = 'page crashed'; });
  const runCase = async (name, file, expect) => {
    const t0 = Date.now();
    if (closed) { check(name + ': result card within 180 s', false, 'not run – ' + closed); return; }
    let ok = true;
    try {
      const before = await page.locator('section.result').count();
      await page.setInputFiles('#file', file);
      await page.waitForFunction((n) => document.querySelectorAll('section.result').length > n && document.getElementById('status').hidden, before, { timeout: 180000 });
    } catch (e) { ok = false; check(name + ': result card within 180 s', false, (closed ? closed + ': ' : '') + e.message.split('\n')[0]); }
    if (!ok) { console.log('  ' + name + ': NO RESULT' + (closed ? ' (' + closed + ')' : '')); return; }
    check(name + ': result card within 180 s', true);
    const r = await page.evaluate(() => { const x = window.PrueferApp.results[0]; return JSON.parse(JSON.stringify(x)); });
    const v = r && r.ust ? r.ust.id : null;
    verdicts[name] = v || '(kein Urteil)';
    if (expect.verdict) check(name + ': verdict ' + expect.verdict, v === expect.verdict, 'got ' + v + ' ' + JSON.stringify((r.warnings || []).slice(0, 2)).slice(0, 300));
    if (expect.test) check(name + ': ' + expect.testName, !!expect.test(r), JSON.stringify({ warnings: r.warnings, pdf: r.pdf && r.pdf.warnings }).slice(0, 400));
    check(name + ': page responsive afterwards', (await page.evaluate(() => 6 * 7)) === 42);
    console.log('  ' + name + ': ' + (v || 'no verdict') + (r.xml && r.xml.parseError ? ' (parser: ' + String(r.xml.parseError).replace(/\s+/g, ' ').slice(0, 90) + ')' : '') + ', ' + (Date.now() - t0) + ' ms');
  };
  for (const [name, , expect] of cases) await runCase(name, path.join(dir, name), expect);
  await runCase('gross-101mib.xml', big, { test: (r) => (r.warnings || []).some((w) => /größer als 100 MB/.test(w)) && !r.ust, testName: 'not read (file limit of the page)' });

  // the page as a whole: no request but the page itself, no connection to the listener, no page error
  await new Promise((res) => setTimeout(res, 500));
  check('the page stayed open (no crash of the tab)', !closed, closed || '');
  const foreign = requests.filter((u) => u !== pageUrl && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('no request other than the page (' + requests.length + ' requests recorded)', foreign.length === 0, foreign.slice(0, 5).join(', '));
  check('no connection to the local listener (external entities, DTD)', connections === 0, connections + ' connection(s)');
  check('no uncaught exception in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  if (!closed) check('page text shows no content of a local file', !I.LEAK.test(await page.evaluate(() => document.body.innerText)));

  await browser.close().catch(() => {});
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of failures) console.log('FAIL ' + f);
  console.log('verdicts in ' + label + ': ' + Object.entries(verdicts).map(([k, v]) => k + ' ' + v).join(', '));
  console.log('E2E robustness ' + label + ': ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (' + (cases.length + 1) + ' hostile files; network, local files, page errors)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
