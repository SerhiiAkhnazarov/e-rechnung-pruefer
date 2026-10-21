#!/usr/bin/env node
/*
 * security-browser.cjs — the protections of the page in a real browser (dist/E-Rechnung-Pruefer.html from file://):
 *
 *  1. Content-Security-Policy and Trusted Types: no request leaves the page (fetch, image), eval and new Function are
 *     refused, a script element created by script does not run, the stylesheet of the page applies but a style element
 *     or style attribute created by script does not, and – in browsers with Trusted Types – a string
 *     assigned to an HTML or script sink throws a TypeError;
 *  2. a dangerous attachment (the EICAR test file of the ZUGFeRD corpus, other/eicar.ubl.xml): marked "Gefährlich",
 *     offered only after a second click and under the name "….gesperrt";
 *  3. a PDF invoice with JavaScript (test/active-pdfs.cjs, js-openaction): the result names it in its security notes;
 *  4. support period and age (src/app.js lifecycleNotice; the browser's clock set by Playwright): no notice for a new
 *     copy, the age notice for a saved copy older than six months, the end-of-support notice after December 2031;
 *  5. integrity of stored rule sets: a manipulated rule set in the browser's storage is discarded and reported, the
 *     official one (the Peppol rule set compiled by Node, build/schemas) is kept.
 *
 * Usage: node test/security-browser.cjs [--browser chromium|webkit|firefox] [--channel msedge|chrome] <zugferd corpus>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const { chromium, webkit, firefox } = tool.playwright();
const ActivePdfs = require(path.join(__dirname, 'active-pdfs.cjs'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browserName = opt('--browser', 'chromium');
const channel = opt('--channel', null);
const corpus = args.filter((a, i) => !a.startsWith('--') && !['--browser', '--channel'].includes(args[i - 1]))[0];
const label = channel || browserName;
const dist = path.join(root, 'dist', 'E-Rechnung-Pruefer.html');
const pageUrl = tool.fileUrl(dist);

let pass = 0, fail = 0;
const failures = [];
const notes = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' – ' + String(detail).slice(0, 300) : '')); } };

(async () => {
  const engine = { chromium, webkit, firefox }[browserName];
  const browser = await engine.launch(channel ? { channel } : {});
  const version = browser.version();
  const build = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'BUILD_INFO.json'), 'utf8'));
  const sec = JSON.parse(fs.readFileSync(path.join(root, 'legal', 'security.json'), 'utf8'));
  const newPage = async (setup) => {
    const context = await browser.newContext({ acceptDownloads: true });
    // every request that reaches the network layer: local files continue, anything else is recorded and aborted (a
    // request refused by the Content-Security-Policy never gets here)
    const requests = [];
    await context.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:')) return route.continue(); requests.push(u); return route.abort(); });
    if (setup) await setup(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // what the page offers for download (Blob and name), also when the browser holds the download back
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      window.__offered = [];
      URL.createObjectURL = (obj) => { const url = create(obj); if (obj instanceof Blob) window.__offered.push({ url, size: obj.size, name: null }); return url; };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { const o = window.__offered.find((x) => x.url === this.href); if (o) o.name = this.getAttribute('download'); return click.call(this); };
    });
    return { context, page, requests, errors };
  };
  const load = async (page, file) => {
    const before = await page.locator('section.result').count();
    await page.setInputFiles('#file', file);
    await page.waitForFunction((n) => document.querySelectorAll('section.result').length > n && document.getElementById('status').hidden, before, { timeout: 180000 });
    return page.locator('section.result').nth(0);
  };

  // ---- 1. CSP and Trusted Types ----
  {
    const { context, page, requests, errors } = await newPage();
    await page.goto(pageUrl);
    await page.waitForSelector('#drop');
    const r = await page.evaluate(async () => {
      const o = { tt: typeof window.trustedTypes !== 'undefined' && typeof window.trustedTypes.createPolicy === 'function' };
      try { document.createElement('div').innerHTML = '<img src=x>'; o.innerHTML = 'assigned'; } catch (e) { o.innerHTML = e.name; }
      try { document.createElement('div').insertAdjacentHTML('beforeend', '<b>x</b>'); o.insertAdjacentHTML = 'inserted'; } catch (e) { o.insertAdjacentHTML = e.name; }
      // eval and new Function from a task of the page (code evaluated by the test driver itself is exempt from the
      // policy in Chromium: Runtime.evaluate allowUnsafeEvalBlockedByCSP)
      const later = (f) => new Promise((res) => setTimeout(() => { try { res(String(f())); } catch (e) { res(e.name); } }, 0));
      o.eval = await later(() => eval('1 + 1'));
      o.fn = await later(() => new Function('return 2')());
      try { await fetch('https://example.org/leak?d=1'); o.fetch = 'fetched'; } catch (e) { o.fetch = 'refused'; }
      window.__injected = false;
      try { const s = document.createElement('script'); s.textContent = 'window.__injected = true'; document.head.append(s); o.scriptText = 'set'; } catch (e) { o.scriptText = e.name; }
      const img = new Image(); img.src = 'https://example.org/pixel.png'; document.body.append(img);
      // styles: the stylesheet of the page applies (its SHA-256 is in the policy), a style element or a style attribute
      // created by script does not (no 'unsafe-inline' in style-src)
      const drop = document.getElementById('drop');
      o.ownStyle = getComputedStyle(drop).borderTopStyle;
      await later(() => { const st = document.createElement('style'); st.textContent = '#drop { border-top-style: dotted !important; }'; document.head.append(st); return 'appended'; });
      await later(() => { drop.setAttribute('style', 'border-left-style: dotted !important'); return 'set'; });
      await new Promise((res) => setTimeout(res, 400));
      o.foreignStyle = getComputedStyle(drop).borderTopStyle;
      o.attrStyle = getComputedStyle(drop).borderLeftStyle;
      drop.removeAttribute('style');
      o.injected = window.__injected;
      // the policy of the Prüfer passes XML to DOMParser
      try { o.xml = PrueferXml.parse('<a><b>1</b></a>').documentElement.nodeName; } catch (e) { o.xml = e.name + ': ' + e.message; }
      return o;
    });
    notes.push('Trusted Types ' + (r.tt ? 'supported' : 'not supported') + ' by ' + label + ' ' + version);
    check('CSP: fetch to another site refused', r.fetch === 'refused', r.fetch);
    check("CSP: eval refused (no 'unsafe-eval')", r.eval !== '2', r.eval);
    check("CSP: new Function refused (no 'unsafe-eval')", r.fn !== '2', r.fn);
    check('CSP/Trusted Types: a script element created by script does not run', r.injected === false, r.scriptText);
    check('CSP: the stylesheet of the page applies (allowed by its SHA-256)', r.ownStyle === 'dashed', r.ownStyle);
    check("CSP: a style element created by script does not apply (no 'unsafe-inline' in style-src)", r.foreignStyle === 'dashed', r.foreignStyle);
    check('CSP: a style attribute set by script does not apply', r.attrStyle === 'dashed', r.attrStyle);
    if (r.tt) {
      check('Trusted Types: string to innerHTML throws TypeError', r.innerHTML === 'TypeError', r.innerHTML);
      check('Trusted Types: string to insertAdjacentHTML throws TypeError', r.insertAdjacentHTML === 'TypeError', r.insertAdjacentHTML);
      check('Trusted Types: string to script text throws TypeError', r.scriptText === 'TypeError', r.scriptText);
    }
    check('the XML parsing of the Prüfer works under the policy (PrueferXml)', r.xml === 'a', r.xml);
    check('no request left the page (fetch and image refused by the policy before the network)', requests.length === 0, requests.join(' '));
    check('no error in the page', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- 2. dangerous attachment, 3. PDF with JavaScript ----
  {
    const { context, page, requests, errors } = await newPage();
    await page.goto(pageUrl);
    await page.waitForSelector('#drop');
    const eicar = corpus ? path.join(corpus, 'other', 'eicar.ubl.xml') : '';
    if (!eicar || !fs.existsSync(eicar)) check('ZUGFeRD corpus with other/eicar.ubl.xml given', false, String(corpus));
    else {
      const card = await load(page, eicar);
      await card.locator('[data-tab="invoice"]').click();
      const offer = card.locator('.file-offer[data-risk="danger"]');
      check('EICAR attachment: offered as dangerous', (await offer.count()) === 1, await offer.count());
      check('EICAR attachment: marked "Gefährlich" with the reason', /Gefährlich/.test(await offer.innerText()) && /EICAR/.test(await offer.innerText()));
      const n0 = await page.evaluate(() => window.__offered.length);
      await offer.locator('[data-action="attachment"]').click();
      await page.waitForTimeout(500);
      check('EICAR attachment: the first click saves nothing', (await page.evaluate(() => window.__offered.length)) === n0);
      const confirm = offer.locator('[data-action="attachment-confirm"]');
      check('EICAR attachment: the first click shows the warning and "Trotzdem herunterladen"', await confirm.isVisible() && /gesperrt/.test(await offer.innerText()));
      const saved = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await confirm.click();
      const dl = await saved;
      const offered = await page.evaluate(() => window.__offered[window.__offered.length - 1] || null);
      check('EICAR attachment: offered under the name eicar.com.gesperrt (68 bytes)', !!offered && offered.name === 'eicar.com.gesperrt' && offered.size === 68, JSON.stringify(offered));
      // the browser's own protection or a virus scanner of the machine may hold the file back; when saved: the name
      if (dl) check('EICAR attachment: saved by the browser as eicar.com.gesperrt', dl.suggestedFilename() === 'eicar.com.gesperrt', dl.suggestedFilename());
      else notes.push('download of the EICAR file held back by the browser or the machine (not saved)');
      if (dl) await dl.delete().catch(() => {});
    }
    // a PDF invoice with JavaScript (synthetic, test/active-pdfs.cjs)
    const pdfCase = ActivePdfs.cases().find((c) => c.name === 'js-openaction.pdf');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pruefer-security-'));
    const pdfFile = path.join(dir, pdfCase.name);
    fs.writeFileSync(pdfFile, pdfCase.bytes);
    const card = await load(page, pdfFile);
    const secNotes = card.locator('[data-security="notes"]');
    check('PDF with JavaScript: security notes shown', (await secNotes.count()) === 1 && /JavaScript/.test(await secNotes.innerText()), (await secNotes.count()) ? await secNotes.innerText() : 'no notes');
    fs.rmSync(dir, { recursive: true, force: true });
    check('no request left the page while files were checked', requests.length === 0, requests.join(' '));
    check('no error in the page', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- 4. support period and age ----
  {
    const built = Date.parse(build.date + 'T12:00:00Z');
    const [ey, em] = sec.supportEnd.split('-').map(Number);
    const afterEnd = new Date(Date.UTC(ey, em, 15, 12));       // the month after the last month of support
    const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    for (const [what, time, expect] of [
      ['a new copy (10 days old)', new Date(built + 10 * 864e5), []],
      ['a saved copy 200 days old', new Date(built + 200 * 864e5), ['älter als sechs Monate']],
      ['after the end of support (' + MONTHS[em - 1] + ' ' + ey + ')', afterEnd, ['endete im ' + MONTHS[em - 1] + ' ' + ey, 'keine Sicherheitsupdates mehr', 'älter als sechs Monate']],
    ]) {
      const { context, page } = await newPage();
      await page.clock.setFixedTime(time);
      await page.goto(pageUrl);
      await page.waitForSelector('#drop');
      const box = await page.evaluate(() => { const b = document.getElementById('lifecycle'); return { hidden: b.hidden, text: b.innerText, links: Array.from(b.querySelectorAll('a')).map((a) => a.href) }; });
      if (!expect.length) check('lifecycle: no notice for ' + what, box.hidden, box.text);
      else check('lifecycle: notice for ' + what + ' (' + expect.join(' / ') + '), with the link to the releases', !box.hidden && expect.every((t) => box.text.includes(t)) && box.links.includes(sec.releases), box.text);
      await context.close();
    }
  }

  // ---- 5. integrity of stored rule sets ----
  {
    const KEY = 'e-rechnung-pruefer.ruleset.';
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
    const pep = Object.entries(manifest.sources).find(([k]) => k.startsWith('OpenPeppol peppol-bis-invoice-3'));
    const ublSha = pep ? (pep[1].files || []).find((f) => f.file.endsWith('PEPPOL-EN16931-UBL.sch')).sha256 : null;
    const compiledFile = path.join(root, 'build', 'schemas', 'PEPPOL-UBL.json');
    const official = fs.existsSync(compiledFile) ? JSON.parse(fs.readFileSync(compiledFile, 'utf8')) : null;
    const tampered = official ? JSON.parse(JSON.stringify(official)) : { id: 'PEPPOL-UBL', patterns: [] };
    // a manipulated rule: an assertion that never fires
    if (tampered.patterns && tampered.patterns[0] && tampered.patterns[0].rules && tampered.patterns[0].rules[0] && tampered.patterns[0].rules[0].asserts && tampered.patterns[0].rules[0].asserts[0]) tampered.patterns[0].rules[0].asserts[0].test = 'true()';
    else tampered.patterns = [];
    tampered.importedFrom = { file: 'PEPPOL-EN16931-UBL.sch', sha256: ublSha, verified: true, expected: ublSha, loaded: '2026-10-21T00:00:00.000Z' };
    const entries = { [KEY + 'PEPPOL-UBL']: JSON.stringify(tampered) };
    if (official) entries[KEY + 'PEPPOL-CII'] = JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', 'PEPPOL-CII.json'), 'utf8')), { importedFrom: { file: 'PEPPOL-EN16931-CII.sch', sha256: (pep[1].files || []).find((f) => f.file.endsWith('PEPPOL-EN16931-CII.sch')).sha256, verified: true, loaded: '2026-10-21T00:00:00.000Z' } }));
    const { context, page } = await newPage();
    // storage of file:// pages: set once before the page's scripts run, on its first load only
    await page.addInitScript((e) => { try { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } } catch (x) { /* no storage for file:// in this browser */ } }, entries);
    await page.goto(pageUrl);
    await page.waitForSelector('#ruleimport input[type=file]', { state: 'attached' });
    const st = await page.evaluate((k) => {
      let storage = true;
      try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); } catch (e) { storage = false; }
      const get = (id) => { try { return localStorage.getItem(k + id); } catch (e) { return null; } };
      const note = document.querySelector('[data-integrity="discarded"]');
      return { storage, imported: Object.keys(window.PrueferApp.imported).sort(), discarded: window.PrueferApp.discarded.slice(), ubl: get('PEPPOL-UBL'), cii: get('PEPPOL-CII'), note: note ? note.textContent : null };
    }, KEY);
    if (!st.storage) notes.push('no localStorage for file:// pages in ' + label + ': integrity check of stored rule sets not exercised');
    else {
      check('stored rule sets: the manipulated PEPPOL-UBL is discarded and deleted', st.discarded.includes('PEPPOL-UBL') && !st.imported.includes('PEPPOL-UBL') && st.ubl === null, JSON.stringify(st.discarded) + ' ' + (st.ubl || '').slice(0, 40));
      check('stored rule sets: the user is told (notice with the rule set)', !!st.note && st.note.includes('PEPPOL-UBL'), st.note);
      if (official) check('stored rule sets: the official PEPPOL-CII (compiled by Node from the pinned file) is kept and used', st.imported.includes('PEPPOL-CII') && st.cii !== null, JSON.stringify(st.imported));
      else notes.push('build/schemas/PEPPOL-*.json not compiled: positive control of the integrity check skipped');
    }
    await context.close();
  }

  await browser.close();
  for (const n of notes) console.log('  note: ' + n);
  for (const f of failures) console.log('FAIL ' + f);
  console.log('E2E security ' + label + ' ' + version + ': ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
