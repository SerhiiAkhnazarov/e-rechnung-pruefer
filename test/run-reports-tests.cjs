#!/usr/bin/env node
/*
 * run-reports-tests.cjs — tests of the files the Prüfer writes (src/reports.js, src/pdf-writer.js):
 *
 *   CSV   Prüfbericht, Rechnungsdaten, Positionen: byte order mark, ';', CRLF, quoting; every cell read back with a
 *         strict CSV reader and compared with the result it came from (finding ids and texts, business-term values,
 *         decimal comma, dates); one column pair per VAT category and rate also for "19" and "19.00";
 *   JSON  structure, no DOM nodes, attachment content replaced by its length;
 *   PDF   Prüfprotokoll and Lesefassung of every document: identical bytes on a second run; structure checked by
 *         qpdf --check; text extracted by two independent readers – poppler (pdftotext -raw, pdfinfo) and Mozilla
 *         pdf.js – must contain the file name, SHA-256, verdict, rule ids, invoice number, amounts, line names
 *         (as written: characters outside Windows-1252 replaced like the writer does);
 *   attachments (BG-24): the decoded bytes equal Node's Base64 decoder (Buffer.from) for every attachment of the corpus;
 *   formatting helpers (amounts, quantities, dates, canonical decimals) and the WinAnsi encoding of the writer.
 *
 * Usage: node test/run-reports-tests.cjs [--corpus-dirs a,b] <file>...   (needs qpdf, pdftotext, pdfinfo; pdf.js)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const Reports = require(path.join(root, 'src', 'reports.js'));
const PdfWriter = require(path.join(root, 'src', 'pdf-writer.js'));
const tool = require(path.join(__dirname, 'resolve-tool.cjs'));
const legal = JSON.parse(fs.readFileSync(path.join(root, 'legal', 'ust-pflichtangaben.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--corpus-dirs');
const corpusDirs = (opt('--corpus-dirs') || 'extra-ubl,extra-cii,zugferd-ubl,zugferd-cii,xr-ubl,xr-cii').split(',');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); } }
const NOW = new Date('2026-10-20T12:00:00Z');
const BUILD = { name: 'E-Rechnung Prüfer', version: '0.0.0-test', date: '2026-10-20', fingerprint: 'f'.repeat(64), verification: 'test', standards: [{ name: 'Test', version: '1', sha256: 'a'.repeat(64) }] };
const CTX = { build: BUILD, now: NOW, vat: legal };

// ---------------------------------------------------------------------------------------------------------------
// formatting helpers and the WinAnsi encoding
// ---------------------------------------------------------------------------------------------------------------
const eq = (name, got, want) => check(name + ': ' + JSON.stringify(want), got === want, 'got ' + JSON.stringify(got));
eq('amount 1234.5 EUR', Reports.amount('1234.5', 'EUR'), '1.234,50 EUR');
eq('amount -0.5', Reports.amount('-0.5'), '-0,50');
eq('amount 1.2300 (trailing zeros beyond two decimals dropped)', Reports.amount('1.2300'), '1,23');
eq('amount 1.2345 (no rounding)', Reports.amount('1.2345'), '1,2345');
eq('amount 1000000', Reports.amount('1000000'), '1.000.000,00');
eq('amount 007.10', Reports.amount('007.10'), '7,10');
eq('amount not a number', Reports.amount('abc', 'EUR'), 'abc EUR');
eq('amount empty', Reports.amount(''), '');
eq('quantity 1250.500', Reports.quantity('1250.500'), '1.250,5');
eq('quantity 19.00', Reports.quantity('19.00'), '19');
eq('quantity 0', Reports.quantity('0'), '0');
eq('canonicalDecimal 19.00', Reports.canonicalDecimal('19.00'), '19');
eq('canonicalDecimal 07.50', Reports.canonicalDecimal('07.50'), '7.5');
eq('canonicalDecimal -0.00', Reports.canonicalDecimal('-0.00'), '0');
eq('canonicalDecimal .5', Reports.canonicalDecimal('.5'), '0.5');
eq('canonicalDecimal empty', Reports.canonicalDecimal(''), '');
eq('date ISO', Reports.date('2026-10-20'), '20.10.2026');
eq('date with time zone', Reports.date('2026-10-20+02:00'), '20.10.2026');
eq('date other format kept', Reports.date('20261020 (Format 203)'), '20261020 (Format 203)');
eq('decimalComma', Reports.decimalComma('1234.56'), '1234,56');
eq('decimalComma not a number', Reports.decimalComma('1.234,56'), '1.234,56');
check('stamp: local time, offset and UTC', /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}; 2026-10-20T12:00:00Z\)$/.test(Reports.stamp(NOW)), Reports.stamp(NOW));
eq('fileName protocol', Reports.fileName({ name: 'a.xml', model: { bt: { 'BT-1': ['R 1/2026'] } } }, 'protocol', NOW), 'Pruefprotokoll_R_1_2026_2026-10-20.pdf');
eq('fileName invoice without number', Reports.fileName({ name: 'Rechnung März.xml', model: { bt: {} } }, 'invoice', NOW), 'Rechnung_Rechnung_März_Lesefassung.pdf');
{
  const stats = { replaced: 0 };
  const codes = PdfWriter.encode('A€„“őä中\t', stats);
  check('WinAnsi encoding: € „ “ ä kept, ő without accent, 中 as ?, tab as space', JSON.stringify(codes) === JSON.stringify([65, 0x80, 0x84, 0x93, 0x6f, 0xe4, 63, 32]) && stats.replaced === 2, JSON.stringify(codes) + ' ' + stats.replaced);
}
/** the text as the writer renders it: Windows-1252, other characters replaced (src/pdf-writer.js encode). Decoded
 * with the table of the WHATWG Encoding Standard (index-windows-1252, 0x80–0x9F; the rest is Latin-1) – written out
 * here, because Node's TextDecoder decodes "windows-1252" as ISO-8859-1 without full ICU */
const WIN1252_80_9F = [0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178];
const rendered = (s) => PdfWriter.encode(String(s)).map((c) => String.fromCharCode(c >= 0x80 && c <= 0x9f ? WIN1252_80_9F[c - 0x80] : c)).join('');
const squash = (s) => String(s).replace(/\s+/g, '');

// ---------------------------------------------------------------------------------------------------------------
// a strict CSV reader (RFC 4180 with ';'): returns rows or throws
// ---------------------------------------------------------------------------------------------------------------
function readCsv(text) {
  if (text.charCodeAt(0) !== 0xfeff) throw new Error('no byte order mark');
  const s = text.slice(1);
  if (!s.endsWith('\r\n')) throw new Error('last line not terminated by CRLF');
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { if (cell !== '') throw new Error('quote inside an unquoted cell at ' + i); quoted = true; i++; continue; }
    if (c === ';') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { if (s[i + 1] !== '\n') throw new Error('CR without LF at ' + i); row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (c === '\n') throw new Error('LF without CR at ' + i);
    cell += c; i++;
  }
  if (quoted) throw new Error('unterminated quote');
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// external readers
// ---------------------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
const run = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28 });
for (const t of ['qpdf', 'pdftotext', 'pdfinfo']) if (run(t, ['--version']).error) { console.log(t + ' not installed (Debian/Ubuntu: apt-get install qpdf poppler-utils)'); process.exit(2); }
let pdfjs = null;

async function checkPdf(label, bytes, expected, title, withPdfJs) {
  const file = path.join(tmp, 'x.pdf');
  fs.writeFileSync(file, bytes);
  const q = run('qpdf', ['--check', file]);
  check(label + ': qpdf --check', q.status === 0 && /No syntax or stream encoding errors found/.test(q.stdout), (q.stdout + q.stderr).trim().split('\n').slice(-3).join(' | '));
  const info = run('pdfinfo', [file]);
  const t = /^Title:\s*(.*)$/m.exec(info.stdout || '');
  check(label + ': pdfinfo title', t && t[1].trim() === title, t ? t[1] : info.stderr);
  const txt = run('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-']);
  const flat = squash(txt.stdout || '');
  const missing = expected.filter((e) => e && !flat.includes(squash(rendered(e))));
  check(label + ': text (pdftotext) contains ' + expected.length + ' expected strings', txt.status === 0 && !missing.length, 'missing: ' + missing.slice(0, 5).join(' | '));
  if (withPdfJs) {
    pdfjs = pdfjs || await import(tool.pdfjsUrl());
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true });
    const docjs = await task.promise;
    let all = '';
    for (let p = 1; p <= docjs.numPages; p++) { const tc = await (await docjs.getPage(p)).getTextContent(); all += tc.items.map((it) => it.str).join(''); }
    const meta = await docjs.getMetadata();
    const flatjs = squash(all);
    const missjs = expected.filter((e) => e && !flatjs.includes(squash(rendered(e))));
    check(label + ': text (pdf.js) contains the expected strings', !missjs.length, 'missing: ' + missjs.slice(0, 5).join(' | '));
    check(label + ': title (pdf.js)', meta.info && meta.info.Title === title, meta.info && meta.info.Title);
    await task.destroy();
  }
}

(async () => {
  const env = createEnv({ exclude: /^PEPPOL-/ });
  const analyze = async (p) => PrueferCore.analyzeBytes(env, new Uint8Array(fs.readFileSync(p)), path.basename(p));
  const named = [];
  for (const f of files) named.push(await analyze(f));
  const corpus = [];
  for (const d of corpusDirs) {
    const dir = path.join(root, 'build', 'corpus', d);
    if (!fs.existsSync(dir)) { check('corpus directory ' + d, false, 'missing'); continue; }
    for (const f of fs.readdirSync(dir).sort()) corpus.push(await analyze(path.join(dir, f)));
  }
  const all = named.concat(corpus);

  // ---- attachments: our Base64 decoder vs Node's ---------------------------------------------------------------
  let attachments = 0;
  for (const r of all) {
    if (!r.model) continue;
    const got = Reports.attachmentFiles(r);
    const withData = r.model.attachments.filter((a) => a.base64);
    check('attachments of ' + r.name + ': one file per embedded attachment', got.length === withData.length);
    for (const g of got) {
      attachments++;
      const want = Buffer.from(r.model.attachments[g.index].base64, 'base64');
      if (Buffer.compare(Buffer.from(g.bytes), want) !== 0) check('attachment ' + g.name + ' of ' + r.name + ': bytes equal Node Buffer.from(base64)', false, g.bytes.length + ' vs ' + want.length);
      else pass++;
    }
  }

  // ---- CSV ----------------------------------------------------------------------------------------------------
  const fcsv = readCsv(Reports.findingsCsv(all, legal));
  const head = fcsv[0];
  const col = (n) => head.indexOf(n);
  check('Prüfbericht CSV: 16 columns, every row', head.length === 16 && fcsv.every((row) => row.length === 16), head.length);
  check('Prüfbericht CSV: one row per finding (at least one per file)', fcsv.length - 1 === all.reduce((s, r) => s + Math.max(1, (r.allFindings || []).length), 0));
  {
    let k = 1, bad = 0;
    for (const r of all) {
      const list = r.allFindings && r.allFindings.length ? r.allFindings : [null];
      for (const f of list) {
        const row = fcsv[k++];
        const ok = row[col('Datei')] === r.name && row[col('SHA-256')] === (r.sha256 || '') && row[col('USt-Einordnung')] === (r.ust ? r.ust.kurz : '') &&
          (!f || (row[col('Regel')] === (f.id || '') && row[col('Meldung')] === f.text && row[col('Zeile')] === String(f.line || '') && row[col('USt-Bedeutung der Regel')] === Reports.ustLabel(f, legal)));
        if (!ok) { bad++; if (bad < 4) check('Prüfbericht CSV row ' + k + ' (' + r.name + ')', false, JSON.stringify(row).slice(0, 200)); }
      }
    }
    check('Prüfbericht CSV: every cell equals its finding', bad === 0, bad + ' rows differ');
  }
  const icsv = readCsv(Reports.invoicesCsv(all));
  const ih = icsv[0];
  const withModel = all.filter((r) => r.model);
  check('Rechnungsdaten CSV: one row per invoice', icsv.length - 1 === withModel.length);
  {
    let bad = 0;
    const first = (m, id) => (m.bt[id] || [])[0] || '';
    withModel.forEach((r, i) => {
      const row = icsv[i + 1];
      for (let c = 0; c < ih.length; c++) {
        const m = /\((BT-\d+)\)$/.exec(ih[c]);
        if (!m || /^(Bemessungsgrundlage|Steuerbetrag) /.test(ih[c])) continue;
        const id = m[1];
        const raw = ['BT-25', 'BT-84', 'BT-86', 'BT-85', 'BT-20'].includes(id) ? (r.model.bt[id] || []).join(' | ') : first(r.model, id);
        const want = ['BT-2', 'BT-72', 'BT-73', 'BT-74', 'BT-9'].includes(id) ? Reports.date(raw) : /^BT-1(0[6-9]|1[0-5])$/.test(id) ? Reports.decimalComma(raw) : raw;
        if (row[c] !== want) { bad++; if (bad < 4) check('Rechnungsdaten CSV ' + r.name + ' ' + ih[c], false, JSON.stringify(row[c]) + ' vs ' + JSON.stringify(want)); }
      }
      // the VAT columns: the sum of the taxable amounts of each category/rate column equals the breakdown
      for (const v of r.model.vat) {
        const label = 'Bemessungsgrundlage ' + (v.cat || '?') + (v.rate !== '' ? ' ' + Reports.decimalComma(Reports.canonicalDecimal(v.rate)) + ' %' : '') + ' (BT-116)';
        const c = ih.indexOf(label);
        if (c < 0 || !row[c].split(' | ').includes(Reports.decimalComma(v.taxable))) { bad++; if (bad < 4) check('Rechnungsdaten CSV ' + r.name + ' ' + label, false, c < 0 ? 'no column' : row[c]); }
      }
    });
    check('Rechnungsdaten CSV: business terms, dates, amounts and VAT columns equal the data model', bad === 0, bad + ' cells differ');
  }
  {
    // "19" and "19.00" are the same rate: one column pair
    const mk = (rate) => ({ name: rate + '.xml', assessment: 'accept', model: { bt: {}, vat: [{ cat: 'S', rate, taxable: '100.00', tax: '19.00' }], skonto: [], lines: [], attachments: [], precedingInvoices: [], allowances: [], notes: [] } });
    const h2 = readCsv(Reports.invoicesCsv([mk('19'), mk('19.00'), mk('7')]))[0];
    check('Rechnungsdaten CSV: rates 19 and 19.00 in one column pair, 7 in another', h2.filter((x) => /^Bemessungsgrundlage S 19 %/.test(x)).length === 1 && h2.filter((x) => /^Bemessungsgrundlage S 7 %/.test(x)).length === 1, h2.filter((x) => /^Bemessungs/.test(x)).join(' / '));
  }
  const lcsv = readCsv(Reports.linesCsv(all));
  check('Positionen CSV: one row per invoice line', lcsv.length - 1 === withModel.reduce((s, r) => s + r.model.lines.length, 0));
  {
    let k = 1, bad = 0;
    const lh = lcsv[0];
    for (const r of withModel) for (const l of r.model.lines) {
      const row = lcsv[k++];
      if (row[lh.indexOf('Position (BT-126)')] !== l.id || row[lh.indexOf('Bezeichnung (BT-153)')] !== l.name || row[lh.indexOf('Nettobetrag (BT-131)')] !== Reports.decimalComma(l.net) || row[lh.indexOf('Menge (BT-129)')] !== Reports.decimalComma(l.qty)) bad++;
    }
    check('Positionen CSV: id, name, quantity and net amount of every line', bad === 0, bad + ' rows differ');
  }

  // ---- JSON ---------------------------------------------------------------------------------------------------
  {
    const j = JSON.parse(Reports.jsonReport(all, CTX));
    check('JSON: one result per file, generated at the given time', j.results.length === all.length && j.generated === NOW.toISOString());
    check('JSON: findings with their classification', j.results.every((x, i) => x.findings.length === (all[i].allFindings || []).length && x.findings.every((f) => f.ust)));
    check('JSON: verdict and checklist', j.results.every((x, i) => !all[i].ust || (x.ust && x.ust.id === all[i].ust.id)));
    const txt = JSON.stringify(j);
    check('JSON: no DOM nodes or XML text', !/"node"\s*:|"doc"\s*:|"docIndex"\s*:/.test(txt));
    const b125 = j.results.flatMap((x) => (x.model && x.model.bt['BT-125']) || []);
    check('JSON: attachment content (BT-125) replaced by its length', b125.length > 0 && b125.every((b) => /^\[Base64, \d+ Zeichen\]$/.test(b)), b125.slice(0, 2).join(' '));
  }

  // ---- PDF ----------------------------------------------------------------------------------------------------
  let pdfs = 0;
  const first = (m, id) => (m && m.bt[id] || [])[0] || '';
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const deep = i < named.length || i % 10 === 0; // pdf.js for the named files and every 10th corpus document
    const p1 = Reports.protocolPdf(r, CTX), p1b = Reports.protocolPdf(r, CTX);
    check('Prüfprotokoll ' + r.name + ': identical bytes on a second run', Buffer.compare(Buffer.from(p1), Buffer.from(p1b)) === 0);
    const expP = ['Prüfprotokoll E-Rechnung', r.name, r.sha256, r.ust ? r.ust.kurz : '', r.profile ? r.profile.label : '']
      .concat((r.allFindings || []).slice(0, 40).map((f) => f.id))
      .concat(r.model ? [first(r.model, 'BT-1')] : []);
    await checkPdf('Prüfprotokoll ' + r.name, p1, expP, 'Prüfprotokoll E-Rechnung – ' + r.name, deep);
    pdfs++;
    if (r.model) {
      const p2 = Reports.invoicePdf(r, CTX), p2b = Reports.invoicePdf(r, CTX);
      check('Lesefassung ' + r.name + ': identical bytes on a second run', Buffer.compare(Buffer.from(p2), Buffer.from(p2b)) === 0);
      const m = r.model, cur = first(m, 'BT-5');
      const expI = [first(m, 'BT-1'), Reports.date(first(m, 'BT-2')), first(m, 'BT-27'), first(m, 'BT-44'), Reports.amount(first(m, 'BT-112'), ''), Reports.amount(first(m, 'BT-115'), '')]
        .concat(m.lines.slice(0, 30).map((l) => l.name))
        .concat(m.vat.map((v) => Reports.amount(v.tax, '')));
      const typeLabel = { 380: 'Rechnung', 381: 'Gutschrift / Rechnungskorrektur (Credit Note)', 384: 'Korrigierte Rechnung', 389: 'Selbst ausgestellte Rechnung (Gutschrift nach § 14 Abs. 2 Satz 5 UStG)' }[first(m, 'BT-3')];
      const title = (Reports.TYPE_CODES[first(m, 'BT-3')] || 'Rechnung') + ' ' + first(m, 'BT-1') + ' (Lesefassung)';
      if (typeLabel) check('Lesefassung ' + r.name + ': title from the type code', title.startsWith(typeLabel));
      await checkPdf('Lesefassung ' + r.name, p2, expI, title, deep);
      pdfs++;
      void cur;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of failures.slice(0, 40)) console.log('FAIL ' + f);
  if (failures.length > 40) console.log('… ' + (failures.length - 40) + ' more');
  const versions = [['qpdf', '--version'], ['pdftotext', '-v']].map(([t, a]) => { const v = run(t, [a]); return ((v.stdout || '') + (v.stderr || '')).split('\n')[0].trim(); }).join(', ');
  console.log('readers: ' + versions + ', pdf.js ' + (pdfjs ? pdfjs.version : '-'));
  console.log('reports tests: ' + all.length + ' documents, ' + pdfs + ' PDFs, ' + attachments + ' attachments; ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
